import { App } from "antd";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

import { applyProductI18nOverrides } from "@/product/i18n-overrides";
import { useProductStore } from "@/product/store";
import { ConnectGate } from "@/product/ui/connect-gate";
import { addGatewayKey } from "@/product/vpapi/client";
import { hasGatewayKey } from "@/product/vpapi/slots";
import { useConfigStore } from "@/stores/use-config-store";
import { useVideoTaskResume } from "./video-resume";

/** 一键接入链接里允许出现的参数；导入后立即从地址栏清除，避免 Key 留在历史记录里。 */
const CONFIG_PARAM_KEYS = ["apiKey", "apikey", "baseUrl", "baseurl"];

// 在 React 首次渲染前覆盖品牌文案，避免首屏仍是上游站点名。
applyProductI18nOverrides();

/**
 * fork 的启动钩子（挂在 ClientRootInit 上）：
 * 1. 处理 vpapi 跳转过来的一键接入链接（`?apiKey=sk-...`）；
 * 2. 没有接入时自动打开接入引导。
 */
export function useProductBootstrap() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const handled = useRef(false);

    useEffect(() => {
        applyProductI18nOverrides();
        if (handled.current) return;
        handled.current = true;

        const params = new URLSearchParams(window.location.search);
        const apiKey = (params.get("apiKey") || params.get("apikey") || "").trim();
        if (apiKey) {
            if (CONFIG_PARAM_KEYS.some((key) => params.has(key))) {
                CONFIG_PARAM_KEYS.forEach((key) => params.delete(key));
                window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}${window.location.hash}`);
            }
            void (async () => {
                try {
                    // 一键接入的 Key 默认当作文生 Key（第一把），媒体 Key 可在引导 / 设置里补。
                    const count = await addGatewayKey(apiKey, "text");
                    message.success(t("product.connect.connected", { count }));
                } catch (error) {
                    message.error(error instanceof Error ? error.message : String(error));
                    useProductStore.getState().openConnect();
                }
            })();
            return;
        }

        if (!hasGatewayKey(useConfigStore.getState().config)) useProductStore.getState().openConnect();
    }, [message, t]);
}

/** fork 的全局浮层（接入引导 + 轻量提示 + 视频任务恢复）。 */
export function ProductOverlays() {
    // 刷新后继续查询未完成的视频任务（网关可能还在渲染）。
    useVideoTaskResume();
    return (
        <>
            <ConnectGate />
            <ProductNotices />
        </>
    );
}

/** 把产品层的提示交给 antd message 渲染。 */
export function ProductNotices() {
    const { message } = App.useApp();
    const notice = useProductStore((state) => state.notice);
    useEffect(() => {
        if (!notice) return;
        message.info({ content: notice.text, key: notice.id });
        useProductStore.getState().clearNotice();
    }, [message, notice]);
    return null;
}
