import axios from "axios";

import i18n from "@/i18n";
import { fetchChannelModels } from "@/services/api/image";
import { applyChannels, buildApiUrl, createModelChannel, useConfigStore, VPAPI_CHANNEL_ID, type AiConfig, type ChannelModel, type ModelChannel } from "@/stores/use-config-store";

import { GATEWAY_URL } from "../brand";
import { refreshModelEndpoints } from "./model-endpoints";

const text = (key: string, options?: Record<string, unknown>) => i18n.t(`product.connect.${key}`, options);

/** 官方网关地址：fork 只对接 vpapi，地址不接受用户输入。 */
export function gatewayUrl(config?: Pick<AiConfig, "baseUrl">) {
    return config?.baseUrl?.trim() || GATEWAY_URL;
}

export function createGatewayChannel(apiKey: string, models: ChannelModel[] = []): ModelChannel {
    return createModelChannel({ id: VPAPI_CHANNEL_ID, name: "vpapi", baseUrl: GATEWAY_URL, apiFormat: "vpapi", apiKey: apiKey.trim(), models });
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
};

/** 当前 Key 的额度：vpapi 的 OpenAI 兼容账单接口，sk- 可直接读，无需登录。 */
export async function fetchGatewayQuota(config: AiConfig): Promise<GatewayQuota> {
    const headers = { Authorization: `Bearer ${config.apiKey.trim()}` };
    const [subscription, usage, site] = await Promise.all([
        axios.get<{ soft_limit_usd?: number; hard_limit_usd?: number; access_until?: number }>(buildApiUrl(gatewayUrl(config), "/dashboard/billing/subscription"), { headers }),
        axios.get<{ total_usage?: number }>(buildApiUrl(gatewayUrl(config), "/dashboard/billing/usage"), { headers }),
        fetchGatewaySiteInfo().catch(() => null),
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
        symbol: site?.symbol ?? "",
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

/** 用一把 Key 完成接入：读取模型目录并写入配置（配置写入会经过 lockProductConfig）。 */
export async function applyGatewayKey(apiKey: string): Promise<number> {
    const { config, updateConfig } = useConfigStore.getState();
    const models = await connectGateway(apiKey);
    const channel = createGatewayChannel(apiKey, models);
    const next = applyChannels({ ...config, channels: [channel] }, [channel]);
    (Object.keys(next) as Array<keyof AiConfig>).forEach((key) => updateConfig(key, next[key]));
    // 端点能力用于助手挑选对话模型；失败不影响接入本身。
    await refreshModelEndpoints(apiKey).catch(() => null);
    return models.length;
}

/** 重新读取当前 Key 的模型目录（换模型 / 网关新增模型后使用）。 */
export async function reloadGatewayModels(): Promise<number> {
    const { config, updateConfig } = useConfigStore.getState();
    const apiKey = config.apiKey.trim();
    if (!apiKey) throw new Error(text("missingKey"));
    const models = await connectGateway(apiKey);
    updateConfig("channels", [createGatewayChannel(apiKey, models)]);
    await refreshModelEndpoints(apiKey).catch(() => null);
    return models.length;
}

/** 断开接入：清空本地保存的 Key 与模型列表，保留其它偏好。 */
export function disconnectGateway() {
    const { updateConfig } = useConfigStore.getState();
    updateConfig("channels", [createGatewayChannel("", [])]);
}
