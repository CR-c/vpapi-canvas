import axios from "axios";

import i18n from "@/i18n";
import { fetchChannelModels } from "@/services/api/image";
import { applyChannels, buildApiUrl, createModelChannel, useConfigStore, type AiConfig, type ChannelModel, type ModelChannel } from "@/stores/use-config-store";

import { GATEWAY_URL } from "../brand";
import { refreshModelEndpoints } from "./model-endpoints";
import { refreshModelPricing } from "./pricing";
import { channelsOfGroup, channelPriority, createGroupChannelId, groupChannelName, groupOfChannel, KEY_GROUPS, sortGroupChannels, type KeyGroup } from "./slots";

const text = (key: string, options?: Record<string, unknown>) => i18n.t(`product.connect.${key}`, options);

/** 官方网关地址：fork 只对接 vpapi，地址不接受用户输入。 */
export function gatewayUrl(config?: Pick<AiConfig, "baseUrl">) {
    return config?.baseUrl?.trim() || GATEWAY_URL;
}

/** 新建一把 Key 的渠道；id 默认按组生成随机后缀并保持不变，同组多把 Key 因此能各自区分模型来源。 */
export function createGatewayChannel(group: KeyGroup, apiKey: string, models: ChannelModel[] = [], id = createGroupChannelId(group)): ModelChannel {
    return createModelChannel({ id, name: groupChannelName(group, apiKey), baseUrl: GATEWAY_URL, apiFormat: "vpapi", apiKey: apiKey.trim(), models });
}

/** 参与提交的渠道：产品分组里真正接了 Key 或已有模型的渠道（占位空渠道不进配置）。 */
function liveChannels(config: AiConfig) {
    return config.channels.filter((channel) => groupOfChannel(channel.id) && (channel.apiKey.trim() || channel.models.length));
}

/** 把渠道列表写回配置：`applyChannels` 重算模型与默认模型，再逐字段更新（会经过 lockProductConfig）。 */
function commitChannels(config: AiConfig, channels: ModelChannel[]) {
    const sorted = sortGroupChannels(channels);
    const next = applyChannels({ ...config, channels: sorted }, sorted);
    const { updateConfig } = useConfigStore.getState();
    (Object.keys(next) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, next[key]));
}

/**
 * 读取网关模型目录（能力分类与视频约束由上游 `fetchChannelModels` 解析）。
 * 失败时重新探测一次响应，把 vpapi 的鉴权 / 分组 / 额度错误翻译成可操作的提示。
 */
export async function connectGateway(apiKey: string): Promise<ChannelModel[]> {
    const key = apiKey.trim();
    const channel = createGatewayChannel("text", key);
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

/** 该 Key 已经接在哪一组第几把（同一把 Key 只接一次）。 */
export function keyLocation(config: AiConfig, apiKey: string) {
    const key = apiKey.trim();
    if (!key) return null;
    const channel = config.channels.find((item) => item.apiKey.trim() === key && groupOfChannel(item.id));
    if (!channel) return null;
    return { channelId: channel.id, group: groupOfChannel(channel.id) as KeyGroup, priority: channelPriority(config, channel.id) };
}

function duplicateKeyError(config: AiConfig, apiKey: string) {
    const location = keyLocation(config, apiKey);
    if (!location) return null;
    return i18n.t("product.keys.duplicate", { group: i18n.t(`product.keys.${location.group}`), priority: location.priority });
}

/** 接一把新 Key 到某组末尾（优先级最低）。 */
export async function addGatewayKey(apiKey: string, group: KeyGroup): Promise<number> {
    const { config } = useConfigStore.getState();
    const key = apiKey.trim();
    const duplicate = duplicateKeyError(config, key);
    if (duplicate) throw new Error(duplicate);
    const models = await connectGateway(key);
    const channel = createGatewayChannel(group, key, models);
    commitChannels(config, [...liveChannels(config), channel]);
    // 端点能力用于助手挑选对话模型，价格目录用于生成前提示消耗；失败不影响接入本身。
    await refreshModelEndpoints(key, channel.id).catch(() => null);
    await refreshModelPricing(key, channel.id).catch(() => null);
    return models.length;
}

export type GroupConnectResult = { group: KeyGroup; ok: boolean; models?: number; error?: string };

/** 首启引导：每组最多接一把 Key（留空的跳过），某一组失败不影响另一组。 */
export async function applyGroupKeys(keys: Partial<Record<KeyGroup, string>>): Promise<GroupConnectResult[]> {
    const results: GroupConnectResult[] = [];
    const seen = new Set<string>();
    for (const group of KEY_GROUPS) {
        const apiKey = (keys[group] || "").trim();
        if (!apiKey) continue;
        if (seen.has(apiKey)) {
            results.push({ group, ok: false, error: i18n.t("product.keys.duplicateInForm") });
            continue;
        }
        seen.add(apiKey);
        try {
            results.push({ group, ok: true, models: await addGatewayKey(apiKey, group) });
        } catch (error) {
            results.push({ group, ok: false, error: error instanceof Error ? error.message : String(error) });
        }
    }
    return results;
}

/** 重新读取某把 Key 的模型目录；渠道 id 与优先级保持不变。 */
export async function reloadGatewayKey(channelId: string): Promise<number> {
    const { config } = useConfigStore.getState();
    const group = groupOfChannel(channelId);
    const channel = config.channels.find((item) => item.id === channelId);
    const apiKey = channel?.apiKey.trim();
    if (!group || !channel || !apiKey) throw new Error(text("missingKey"));
    const models = await connectGateway(apiKey);
    commitChannels(config, liveChannels(config).map((item) => (item.id === channelId ? createGatewayChannel(group, apiKey, models, channelId) : item)));
    await refreshModelEndpoints(apiKey, channelId).catch(() => null);
    await refreshModelPricing(apiKey, channelId).catch(() => null);
    return models.length;
}

/** 更换某把 Key：保留渠道 id 与优先级，用新 Key 重新读取模型。 */
export async function replaceGatewayKey(channelId: string, apiKey: string): Promise<number> {
    const { config } = useConfigStore.getState();
    const group = groupOfChannel(channelId);
    const channel = config.channels.find((item) => item.id === channelId);
    if (!group || !channel) throw new Error(text("missingKey"));
    const key = apiKey.trim();
    if (!key) throw new Error(text("missingKey"));
    if (key === channel.apiKey.trim()) return reloadGatewayKey(channelId);
    const duplicate = duplicateKeyError(config, key);
    if (duplicate) throw new Error(duplicate);
    const models = await connectGateway(key);
    commitChannels(config, liveChannels(config).map((item) => (item.id === channelId ? createGatewayChannel(group, key, models, channelId) : item)));
    await refreshModelEndpoints(key, channelId).catch(() => null);
    await refreshModelPricing(key, channelId).catch(() => null);
    return models.length;
}

/** 调整优先级：与相邻的同组 Key 交换顺序（顺序即优先级的唯一来源）。 */
export function moveGatewayKey(channelId: string, direction: -1 | 1) {
    const { config } = useConfigStore.getState();
    const group = groupOfChannel(channelId);
    if (!group) return;
    const groupChannels = channelsOfGroup(config, group).filter((channel) => channel.apiKey.trim());
    const index = groupChannels.findIndex((channel) => channel.id === channelId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= groupChannels.length) return;
    const reordered = [...groupChannels];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    commitChannels(config, [...liveChannels(config).filter((channel) => groupOfChannel(channel.id) !== group), ...reordered]);
}

/** 删除某把 Key：它带来的模型同时从选择器里消失。 */
export function removeGatewayKey(channelId: string) {
    const { config } = useConfigStore.getState();
    commitChannels(config, liveChannels(config).filter((channel) => channel.id !== channelId));
}

/** 断开接入：清空本地保存的 Key 与模型，保留其它偏好。 */
export function disconnectGateway() {
    const { config } = useConfigStore.getState();
    commitChannels(config, []);
}
