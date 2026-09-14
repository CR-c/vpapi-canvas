import axios from "axios";

import i18n from "@/i18n";
import { fetchChannelModels } from "@/services/api/image";
import { applyChannels, buildApiUrl, createModelChannel, useConfigStore, type AiConfig, type ChannelModel, type ModelChannel } from "@/stores/use-config-store";

import { GATEWAY_URL } from "../brand";
import { refreshModelEndpoints } from "./model-endpoints";
import { KEY_SLOTS, slotOfChannel, SLOT_CHANNEL_ID, type KeySlot } from "./slots";

const text = (key: string, options?: Record<string, unknown>) => i18n.t(`product.connect.${key}`, options);

/** 官方网关地址：fork 只对接 vpapi，地址不接受用户输入。 */
export function gatewayUrl(config?: Pick<AiConfig, "baseUrl">) {
    return config?.baseUrl?.trim() || GATEWAY_URL;
}

export function createGatewayChannel(apiKey: string, models: ChannelModel[] = [], slot: KeySlot = "text"): ModelChannel {
    return createModelChannel({ id: SLOT_CHANNEL_ID[slot], name: `vpapi · ${slot}`, baseUrl: GATEWAY_URL, apiFormat: "vpapi", apiKey: apiKey.trim(), models });
}

/** 按槽位顺序排列渠道，保证 applyChannels / 默认模型的第一顺位稳定。 */
function sortSlotChannels(channels: ModelChannel[]) {
    return [...channels].sort((a, b) => KEY_SLOTS.indexOf(slotOfChannel(a.id) || "text") - KEY_SLOTS.indexOf(slotOfChannel(b.id) || "text"));
}

/**
 * 读取网关模型目录（能力分类与视频约束由上游 `fetchChannelModels` 解析）。
 * 失败时重新探测一次响应，把 vpapi 的鉴权 / 分组 / 额度错误翻译成可操作的提示。
 */
export async function connectGateway(apiKey: string): Promise<ChannelModel[]> {
    const key = apiKey.trim();
    const channel = createGatewayChannel(key);
    try {
        const models = await fetchChannelModels(channel);
        if (!models.length) throw new Error(text("empty"));
        return models;
    } catch (error) {
        throw new Error(await describeGatewayFailure(error, key));
    }
}

export type GatewayQuota = {
    /** 总额度（含已用），单位由 `symbol` 决定。 */
    total: number;
    used: number;
    remaining: number;
    unlimited: boolean;
    /** 密钥到期时间（unix 秒），0 表示不过期。 */
    expiresAt: number;
    /** 货币符号；空字符串表示按 token 数展示。 */
    symbol: string;
    /** account = 账号总额度；key = 单把 Key 的额度（网关未提供账号口径时）。 */
    scope: "account" | "key";
};

/**
 * 额度：优先取账号总额度（vpapi 的 `/api/usage/user`，需要画布域名进入网关跨域白名单），
 * 拿不到时退回 OpenAI 兼容账单接口（`/v1/dashboard/billing/*`，sk- 可直接读，口径取决于网关设置）。
 */
export async function fetchGatewayQuota(config: AiConfig): Promise<GatewayQuota> {
    const apiKey = config.channels.map((channel) => channel.apiKey.trim()).find(Boolean) || "";
    const site = await fetchGatewaySiteInfo().catch(() => null);
    const symbol = site?.symbol ?? "";
    const account = await fetchAccountQuota(apiKey).catch(() => null);
    if (account) return { ...account, symbol, scope: "account" };

    const headers = { Authorization: `Bearer ${apiKey}` };
    const [subscription, usage] = await Promise.all([
        axios.get<{ soft_limit_usd?: number; hard_limit_usd?: number; access_until?: number }>(buildApiUrl(gatewayUrl(config), "/dashboard/billing/subscription"), { headers }),
        axios.get<{ total_usage?: number }>(buildApiUrl(gatewayUrl(config), "/dashboard/billing/usage"), { headers }),
    ]);
    const total = Number(subscription.data.soft_limit_usd || 0);
    const used = Number(usage.data.total_usage || 0) / 100;
    const unlimited = Number(subscription.data.hard_limit_usd || 0) >= 100000000;
    return {
        total,
        used,
        remaining: unlimited ? Number.POSITIVE_INFINITY : Math.max(0, total - used),
        unlimited,
        expiresAt: Number(subscription.data.access_until || 0),
        symbol,
        scope: "key",
    };
}

/** 账号总额度：vpapi 用 sk- 读取令牌所属账号的额度。 */
async function fetchAccountQuota(apiKey: string) {
    if (!apiKey) return null;
    const response = await axios.get<{ success?: boolean; data?: { total_granted?: number; total_used?: number; total_available?: number; unlimited_quota?: boolean; expires_at?: number } }>(`${GATEWAY_URL.replace(/\/+$/, "")}/api/usage/user`, {
        headers: { Authorization: `Bearer ${apiKey}` },
    });
    const data = response.data?.data;
    if (!data || typeof data.total_available !== "number") return null;
    const unlimited = Boolean(data.unlimited_quota);
    return {
        total: Number(data.total_granted || 0),
        used: Number(data.total_used || 0),
        remaining: unlimited ? Number.POSITIVE_INFINITY : Math.max(0, Number(data.total_available)),
        unlimited,
        expiresAt: Number(data.expires_at || 0),
    };
}

/** 站点展示设置（货币符号 / 展示单位）；vpapi 允许画布域名跨域读取，失败时按无符号数字展示。 */
async function fetchGatewaySiteInfo(): Promise<{ symbol: string }> {
    const response = await axios.get<{ quota_display_type?: string; display_in_currency?: boolean; custom_currency_symbol?: string; usd_exchange_rate?: number }>(`${GATEWAY_URL.replace(/\/+$/, "")}/api/status`);
    const data = response.data || {};
    if (data.quota_display_type === "TOKENS") return { symbol: "" };
    if (data.quota_display_type === "CUSTOM") return { symbol: data.custom_currency_symbol || "" };
    if (data.quota_display_type === "CNY") return { symbol: "¥" };
    if (data.quota_display_type === "USD") return { symbol: "$" };
    return { symbol: data.display_in_currency ? "$" : "" };
}

/** 把网关失败响应翻译成产品文案；无法归类时回落到上游给出的消息。 */
async function describeGatewayFailure(error: unknown, apiKey: string): Promise<string> {
    const probe = await probeGateway(apiKey);
    if (probe) return probe;
    if (axios.isAxiosError(error) && !error.response) return text("unreachable", { url: GATEWAY_URL });
    return error instanceof Error && error.message ? text("failed", { error: error.message }) : text("failed", { error: "" });
}

async function probeGateway(apiKey: string): Promise<string | null> {
    try {
        await axios.get(buildApiUrl(GATEWAY_URL, "/models"), { headers: { Authorization: `Bearer ${apiKey}` } });
        return null;
    } catch (error) {
        if (!axios.isAxiosError(error)) return null;
        if (!error.response) return text("unreachable", { url: GATEWAY_URL });
        const body = error.response.data as { error?: { message?: string; code?: string }; message?: string } | undefined;
        const code = body?.error?.code || "";
        const message = body?.error?.message || body?.message || "";
        if (error.response.status === 401) return text("invalidKey");
        if (code === "token_group_required" || /group is required/i.test(message)) return text("groupRequired");
        if (error.response.status === 402 || error.response.status === 429 || /quota|额度|余额|insufficient/i.test(message)) return text("quotaExhausted");
        return message ? text("failed", { error: message }) : null;
    }
}

/** 用一把 Key 接入某个能力槽位：读取模型目录并写入配置（配置写入会经过 lockProductConfig）。 */
export async function applyGatewayKey(apiKey: string, slot: KeySlot = "text"): Promise<number> {
    const { config, updateConfig } = useConfigStore.getState();
    const models = await connectGateway(apiKey);
    const channel = createGatewayChannel(apiKey, models, slot);
    const channels = sortSlotChannels([...config.channels.filter((item) => item.id !== channel.id), channel]);
    const next = applyChannels({ ...config, channels }, channels);
    (Object.keys(next) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, next[key]));
    // 端点能力用于助手挑选对话模型；失败不影响接入本身。
    await refreshModelEndpoints(apiKey, slot).catch(() => null);
    return models.length;
}

export type SlotConnectResult = { slot: KeySlot; ok: boolean; models?: number; error?: string };

/** 一次接入多个槽位的 Key（留空的跳过）；某个槽位失败不影响其它槽位。 */
export async function applyGatewayKeys(keys: Partial<Record<KeySlot, string>>): Promise<SlotConnectResult[]> {
    const results: SlotConnectResult[] = [];
    for (const slot of KEY_SLOTS) {
        const apiKey = (keys[slot] || "").trim();
        if (!apiKey) continue;
        try {
            results.push({ slot, ok: true, models: await applyGatewayKey(apiKey, slot) });
        } catch (error) {
            results.push({ slot, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return results;
}

/** 重新读取某个槽位（或全部槽位）的模型目录。 */
export async function reloadGatewayModels(slot?: KeySlot): Promise<number> {
    const { config, updateConfig } = useConfigStore.getState();
    const targets = slot ? [slot] : KEY_SLOTS;
    const channels = [...config.channels];
    let imported = 0;
    let connected = 0;
    for (const item of targets) {
        const index = channels.findIndex((channel) => channel.id === SLOT_CHANNEL_ID[item]);
        const apiKey = channels[index]?.apiKey?.trim();
        if (index < 0 || !apiKey) continue;
        connected += 1;
        const models = await connectGateway(apiKey);
        channels[index] = createGatewayChannel(apiKey, models, item);
        imported += models.length;
        await refreshModelEndpoints(apiKey, item).catch(() => null);
    }
    if (!connected) throw new Error(text("missingKey"));
    updateConfig("channels", sortSlotChannels(channels));
    return imported;
}

/** 断开某个槽位（或全部槽位）：清空本地保存的 Key 与模型列表，保留其它偏好。 */
export function disconnectGateway(slot?: KeySlot) {
    const { config, updateConfig } = useConfigStore.getState();
    const targets = slot ? [slot] : KEY_SLOTS;
    const channels = config.channels.map((channel) => {
        const channelSlot = slotOfChannel(channel.id);
        return channelSlot && targets.includes(channelSlot) ? createGatewayChannel("", [], channelSlot) : channel;
    });
    updateConfig("channels", sortSlotChannels(channels));
}
