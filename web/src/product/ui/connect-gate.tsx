import { Alert, App, Input, Modal } from "antd";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LINKS } from "@/product/brand";
import { useProductStore } from "@/product/store";
import { applyGatewayKey, gatewayUrl } from "@/product/vpapi/client";
import { useQuotaStore } from "@/product/vpapi/quota-store";

/**
 * 接入引导：新用户只需要一把 vpapi API Key。
 *
 * 未接入时由 `useProductBootstrap` 自动打开；用户也可以「稍后再说」先逛画布，
 * 真正发起生成时上游的配置检查会再次提示。
 */
export function ConnectGate() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const open = useProductStore((state) => state.connectOpen);
    const closeConnect = useProductStore((state) => state.closeConnect);
    const [apiKey, setApiKey] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const connect = async () => {
        const key = apiKey.trim();
        if (!key) {
            setError(t("product.connect.missingKey"));
            return;
        }
        setLoading(true);
        setError("");
        try {
            const count = await applyGatewayKey(key);
            setApiKey("");
            closeConnect();
            message.success(t("product.connect.connected", { count }));
            void useQuotaStore.getState().refresh(true);
            if (window.location.pathname === "/") window.location.assign("/canvas");
        } catch (connectError) {
            setError(connectError instanceof Error ? connectError.message : String(connectError));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            open={open}
            onCancel={closeConnect}
            onOk={() => void connect()}
            okText={t("product.connect.connect")}
            cancelText={t("product.connect.skip")}
            confirmLoading={loading}
            maskClosable={false}
            width={480}
            title={
                <span className="flex items-center gap-2">
                    <KeyRound className="size-4" />
                    {t("product.connect.title")}
                </span>
            }
        >
            <div className="space-y-3">
                <div className="text-sm text-stone-500">{t("product.connect.subtitle")}</div>
                <Input.Password
                    autoFocus
                    value={apiKey}
                    autoComplete="off"
                    placeholder={t("product.connect.keyPlaceholder")}
                    onChange={(event) => setApiKey(event.target.value)}
                    onPressEnter={() => void connect()}
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
                    <span>
                        {t("product.connect.gateway")}：<code>{gatewayUrl()}</code>
                    </span>
                </div>
                {error ? <Alert type="error" message={error} showIcon /> : null}
                <div className="text-xs text-stone-500">{t("product.connect.hint")}</div>
                <div className="flex flex-wrap gap-3 text-xs">
                    <ExternalLink href={LINKS.keys} label={t("product.connect.getKey")} />
                    <ExternalLink href={LINKS.wallet} label={t("product.connect.recharge")} />
                    <ExternalLink href={LINKS.docs} label={t("product.connect.doc")} />
                </div>
            </div>
        </Modal>
    );
}

export function ExternalLink({ href, label }: { href: string; label: string }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-stone-600 underline-offset-2 hover:underline dark:text-stone-300">
            {label}
            <ArrowUpRight className="size-3" />
        </a>
    );
}
