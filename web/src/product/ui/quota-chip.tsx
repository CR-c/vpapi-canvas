import { Popover, Tooltip } from "antd";
import { Wallet } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import { LINKS } from "@/product/brand";
import { useQuotaStore } from "@/product/vpapi/quota-store";
import { useConfigStore } from "@/stores/use-config-store";

const REFRESH_INTERVAL_MS = 60000;

function formatAmount(value: number, symbol: string) {
    if (!Number.isFinite(value)) return "∞";
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    return `${symbol}${value.toFixed(digits)}`;
}

function formatExpiry(value: number) {
    if (!value) return "—";
    return new Date(value * 1000).toLocaleDateString();
}

/**
 * 顶栏额度：显示当前 API Key 的剩余额度（vpapi 的 sk- 可直接读账单接口）。
 *
 * 未接入时不占位；已接入时每 60 秒静默刷新一次，点击可看用量明细与充值入口。
 */
export function QuotaChip() {
    const { t } = useTranslation();
    const apiKey = useConfigStore((state) => state.config.apiKey);
    const status = useQuotaStore((state) => state.status);
    const remaining = useQuotaStore((state) => state.remaining);
    const used = useQuotaStore((state) => state.used);
    const symbol = useQuotaStore((state) => state.symbol);
    const expiresAt = useQuotaStore((state) => state.expiresAt);
    const unlimited = useQuotaStore((state) => state.unlimited);
    const updatedAt = useQuotaStore((state) => state.updatedAt);
    const connected = Boolean(apiKey.trim());

    useEffect(() => {
        if (!connected) return;
        const refresh = () => void useQuotaStore.getState().refresh();
        refresh();
        const timer = setInterval(() => {
            if (document.visibilityState === "visible") refresh();
        }, REFRESH_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [connected]);

    if (!connected) return null;

    const label = status === "error" || status === "idle" ? t("product.quota.unknown") : unlimited ? t("product.quota.unlimited") : formatAmount(remaining, symbol);

    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            content={
                <div className="w-56 space-y-2 text-xs">
                    <div className="flex justify-between gap-3">
                        <span className="text-stone-500">{t("product.quota.title")}</span>
                        <span className="font-medium">{unlimited ? t("product.quota.unlimited") : formatAmount(remaining, symbol)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                        <span className="text-stone-500">{t("product.quota.used")}</span>
                        <span>{formatAmount(used, symbol)}</span>
                    </div>
                    <div className="flex justify-between gap-3">
                        <span className="text-stone-500">{t("product.quota.expires")}</span>
                        <span>{formatExpiry(expiresAt)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 pt-1">
                        <button type="button" className="text-stone-500 underline-offset-2 hover:underline" onClick={() => void useQuotaStore.getState().refresh(true)}>
                            {t("product.quota.refresh")}
                        </button>
                        <a href={LINKS.wallet} target="_blank" rel="noopener noreferrer" className="text-stone-600 underline-offset-2 hover:underline dark:text-stone-300">
                            {t("product.quota.recharge")}
                        </a>
                    </div>
                    {updatedAt ? <div className="text-[11px] text-stone-400">{t("product.quota.updatedAt", { time: new Date(updatedAt).toLocaleTimeString() })}</div> : null}
                </div>
            }
        >
            <Tooltip title={t("product.quota.title")} mouseEnterDelay={0.3}>
                <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-stone-600 transition-colors hover:bg-black/5 hover:text-stone-950 dark:text-stone-300 dark:hover:bg-white/10 dark:hover:text-white"
                    aria-label={t("product.quota.title")}
                >
                    <Wallet className="size-4" />
                    <span className="tabular-nums">{label}</span>
                </button>
            </Tooltip>
        </Popover>
    );
}
