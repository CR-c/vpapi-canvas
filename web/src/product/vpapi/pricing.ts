import axios from "axios";
import i18n from "@/i18n";

import { GATEWAY_URL } from "../brand";
import { SLOT_CHANNEL_ID, type KeySlot } from "./slots";

/**
 * 模型价格缓存：接入 / 重新读取模型时顺带拉一次网关的价格目录，
 * 生成前用它提示本次预计消耗的额度。
 *
 * 缓存以「槽位渠道 id::模型名」为键，与端点能力缓存一致。
 */
const STORAGE_KEY = "vpapi-canvas:model-pricing";

export type ModelPrice = {
    /** 计费方式：按次 / 按秒 / 按 token */
    unit: "call" | "second" | "million_tokens";
    /** 按次单价（unit=call） */
    amount: number;
    /** 每秒单价（unit=second / million_tokens 的多数视频模型会给） */
    perSecond?: number;
    currency: string;
};

type CatalogPrice = { currency?: string; unit_price?: number; per_second_cost?: number };
type CatalogTier = { cost_tier?: string; resolution?: string; prices?: Record<string, CatalogPrice> };
type CatalogModel = { model_name?: string; billing_unit?: string; tiers?: CatalogTier[] };
type Catalog = { groups?: Record<string, { currency?: string }>; models?: CatalogModel[] };

export function readModelPricing(): Record<string, ModelPrice> {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? (parsed as Record<string, ModelPrice>) : {};
    } catch {
        return {};
    }
}

function writeModelPricing(map: Record<string, ModelPrice>) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        /* 忽略存储失败：只影响消耗提示 */
    }
}

/** 拉取该槽位 Key 可见分组的价格目录并合并进缓存；失败不影响接入。 */
export async function refreshModelPricing(apiKey: string, slot: KeySlot, baseUrl = GATEWAY_URL): Promise<void> {
    const response = await axios.get<{ success?: boolean; data?: Catalog }>(`${baseUrl.replace(/\/+$/, "")}/api/usage/pricing`, {
        headers: { Authorization: `Bearer ${apiKey.trim()}` },
    });
    const catalog = response.data?.data;
    if (!catalog?.models?.length) return;
    const prefix = `${SLOT_CHANNEL_ID[slot]}::`;
    const next = Object.fromEntries(Object.entries(readModelPricing()).filter(([key]) => !key.startsWith(prefix)));
    for (const model of catalog.models) {
        const name = (model.model_name || "").trim();
        const price = readCatalogPrice(model);
        if (name && price) next[`${prefix}${name}`] = price;
    }
    writeModelPricing(next);
}

/** 取第一个带价格的档位（多档位模型取第一档，够用来做预估值）。 */
function readCatalogPrice(model: CatalogModel): ModelPrice | undefined {
    const unit = model.billing_unit === "second" ? "second" : model.billing_unit === "call" ? "call" : model.billing_unit === "million_tokens" ? "million_tokens" : undefined;
    if (!unit) return undefined;
    for (const tier of model.tiers || []) {
        const price = Object.values(tier.prices || {})[0];
        if (!price) continue;
        const currency = price.currency || "CNY";
        if (unit === "call") {
            const amount = Number(price.unit_price ?? 0);
            if (amount > 0) return { unit, amount, currency };
            continue;
        }
        const perSecond = Number(price.per_second_cost ?? 0);
        if (perSecond > 0) return { unit, amount: Number(price.unit_price ?? 0), perSecond, currency };
    }
    return undefined;
}

function currencySymbol(currency: string) {
    if (currency === "CNY") return "¥";
    if (currency === "USD") return "$";
    return `${currency} `;
}

function formatAmount(value: number, currency: string) {
    return `${currencySymbol(currency)}${value.toFixed(2)}`;
}

/** 生成前提示文案；拿不到价格时返回空串（不打扰用户）。 */
export function generationCostNotice(encodedModel: string, options: { count?: number; seconds?: number } = {}) {
    const price = readModelPricing()[encodedModel];
    if (!price) return "";
    const count = Math.max(1, Math.floor(options.count || 1));
    if (price.unit === "call") {
        return i18n.t("product.cost.notice", { amount: formatAmount(price.amount * count, price.currency) });
    }
    const seconds = Math.max(1, Math.floor(options.seconds || 0));
    if (!price.perSecond || !seconds) return "";
    const amount = formatAmount(price.perSecond * seconds, price.currency);
    return i18n.t("product.cost.noticeByTime", { amount, seconds, rate: formatAmount(price.perSecond, price.currency) });
}

/** 模型价格摘要（设置面板展示用）。 */
export function modelPriceSummary(encodedModel: string) {
    const price = readModelPricing()[encodedModel];
    if (!price) return "";
    if (price.unit === "call") return i18n.t("product.cost.perCall", { amount: formatAmount(price.amount, price.currency) });
    if (price.perSecond) return i18n.t("product.cost.perSecond", { amount: formatAmount(price.perSecond, price.currency) });
    return "";
}
