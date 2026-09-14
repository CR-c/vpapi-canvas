import axios from "axios";
import i18n from "@/i18n";

import { GATEWAY_URL } from "../brand";
import { SLOT_CHANNEL_ID, type KeySlot } from "./slots";

/**
 * 模型价格缓存：接入 / 重新读取模型时顺带拉一次网关的价格目录，
 * 用于三处：
 * 1. 模型选择器里显示单价（modelOptionLabel 会带上）；
 * 2. 生成前提示本次预计消耗；
 * 3. 后台设置面板展示。
 *
 * 缓存以「槽位渠道 id::模型名」为键，保存**全部档位**，
 * 生成时再按用户选的分辨率 / 时长 / 是否有参考图匹配档位，避免接入时锁死价格。
 */
const STORAGE_KEY = "vpapi-canvas:model-pricing";

export type ModelPriceTier = {
    /** 档位标识，如 480p_no_ref / gt_236w */
    costTier: string;
    /** 分辨率，如 480p / 2K */
    resolution: string;
    /** 按次单价（按次计费模型） */
    unitPrice: number;
    /** 每秒单价（按秒 / token 计费的视频模型） */
    perSecond?: number;
};

export type ModelPrice = {
    /** 计费方式：按次 / 按秒 / 按 token */
    unit: "call" | "second" | "million_tokens";
    currency: string;
    tiers: ModelPriceTier[];
};

type CatalogPrice = { currency?: string; unit_price?: number; per_second_cost?: number };
type CatalogTier = { cost_tier?: string; resolution?: string; prices?: Record<string, CatalogPrice> };
type CatalogModel = { model_name?: string; billing_unit?: string; tiers?: CatalogTier[] };
type Catalog = { models?: CatalogModel[] };

let cache: Record<string, ModelPrice> | null = null;

export function readModelPricing(): Record<string, ModelPrice> {
    if (cache) return cache;
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        cache = parsed && typeof parsed === "object" ? (parsed as Record<string, ModelPrice>) : {};
    } catch {
        cache = {};
    }
    return cache;
}

function writeModelPricing(map: Record<string, ModelPrice>) {
    cache = map;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        /* 忽略存储失败：只影响价格展示 */
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
        const price = readCatalogModel(model);
        if (name && price) next[`${prefix}${name}`] = price;
    }
    writeModelPricing(next);
}

function readCatalogModel(model: CatalogModel): ModelPrice | undefined {
    const unit = model.billing_unit === "second" ? "second" : model.billing_unit === "call" ? "call" : model.billing_unit === "million_tokens" ? "million_tokens" : undefined;
    if (!unit) return undefined;
    const tiers: ModelPriceTier[] = [];
    let currency = "";
    for (const tier of model.tiers || []) {
        const price = Object.values(tier.prices || {})[0];
        if (!price) continue;
        currency = currency || price.currency || "CNY";
        const unitPrice = Number(price.unit_price ?? 0);
        const perSecond = Number(price.per_second_cost ?? 0);
        if (!unitPrice && !perSecond) continue;
        tiers.push({
            costTier: (tier.cost_tier || "").trim(),
            resolution: (tier.resolution || "").trim(),
            unitPrice,
            ...(perSecond > 0 ? { perSecond } : {}),
        });
    }
    if (!tiers.length) return undefined;
    return { unit, currency: currency || "CNY", tiers };
}

/** 兼容两种入参：编码值（`渠道id::模型名`）或纯模型名。 */
function lookupPrice(value: string): ModelPrice | undefined {
    const key = (value || "").trim();
    if (!key) return undefined;
    const map = readModelPricing();
    if (map[key]) return map[key];
    const name = key.includes("::") ? key.slice(key.lastIndexOf("::") + 2) : key;
    const matched = Object.keys(map).find((item) => (item.includes("::") ? item.slice(item.lastIndexOf("::") + 2) : item) === name);
    return matched ? map[matched] : undefined;
}

/** 分辨率归一：去掉 p、统一大小写，并把像素值折算成档位名。 */
function resolutionKey(value: string) {
    const normalized = (value || "").trim().toLowerCase().replace(/p$/, "");
    if (normalized === "2160") return "4k";
    if (normalized === "1440") return "2k";
    if (normalized === "1024") return "1k";
    return normalized;
}

export type PriceContext = {
    /** 生成张数（按次计费） */
    count?: number;
    /** 视频时长（按秒计费） */
    seconds?: number;
    /** 选中的分辨率，如 720 / 720p / 2k */
    resolution?: string;
    /** 图片质量档（如 gt_236w / high） */
    quality?: string;
    /** 是否带参考图 */
    hasReferences?: boolean;
};

/** 按分辨率 / 质量 / 参考图挑最贴近的一档；匹配不到时用第一档。 */
function pickTier(price: ModelPrice, context: PriceContext): ModelPriceTier {
    const resolution = resolutionKey(context.resolution || "");
    const quality = (context.quality || "").trim().toLowerCase();
    let best = price.tiers[0];
    let bestScore = -Infinity;
    for (const tier of price.tiers) {
        const tierResolution = resolutionKey(tier.resolution || tier.costTier);
        const tierTier = (tier.costTier || "").toLowerCase();
        let score = 0;
        if (resolution && tierResolution === resolution) score += 4;
        if (quality && (tierTier === quality || tierResolution === quality)) score += 4;
        if (context.hasReferences === true) score += tierTier.includes("with_ref") ? 2 : tierTier.includes("no_ref") ? -2 : 0;
        if (context.hasReferences === false) score += tierTier.includes("no_ref") ? 1 : tierTier.includes("with_ref") ? -1 : 0;
        if (score > bestScore) {
            bestScore = score;
            best = tier;
        }
    }
    return best;
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
export function generationCostNotice(encodedModel: string, context: PriceContext = {}) {
    const price = lookupPrice(encodedModel);
    if (!price) return "";
    const tier = pickTier(price, context);
    if (price.unit === "call") {
        const count = Math.max(1, Math.floor(context.count || 1));
        return i18n.t("product.cost.notice", { amount: formatAmount(tier.unitPrice * count, price.currency) });
    }
    const seconds = Math.max(1, Math.floor(context.seconds || 0));
    if (!tier.perSecond || !seconds) return "";
    return i18n.t("product.cost.noticeByTime", {
        amount: formatAmount(tier.perSecond * seconds, price.currency),
        seconds,
        rate: formatAmount(tier.perSecond, price.currency),
    });
}

function priceValues(price: ModelPrice) {
    if (price.unit === "call") return price.tiers.map((tier) => tier.unitPrice).filter((value) => value > 0);
    return price.tiers.map((tier) => tier.perSecond || 0).filter((value) => value > 0);
}

/** 模型单价摘要（模型选择器 / 设置面板展示用）：多档位时标「起」。 */
export function modelPriceSummary(encodedModel: string) {
    const price = lookupPrice(encodedModel);
    if (!price) return "";
    const values = priceValues(price);
    if (!values.length) return "";
    const cheapest = Math.min(...values);
    const amount = formatAmount(cheapest, price.currency);
    const multiple = new Set(values.map((value) => value.toFixed(4))).size > 1;
    if (price.unit === "call") return multiple ? i18n.t("product.cost.perCallFrom", { amount }) : i18n.t("product.cost.perCall", { amount });
    return multiple ? i18n.t("product.cost.perSecondFrom", { amount }) : i18n.t("product.cost.perSecond", { amount });
}
