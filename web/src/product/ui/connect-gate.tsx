import { Alert, App, Input, Modal } from "antd";
import { ArrowUpRight, KeyRound } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { LINKS } from "@/product/brand";
import { useProductStore } from "@/product/store";
import { applyGatewayKeys, gatewayUrl } from "@/product/vpapi/client";
import { useQuotaStore } from "@/product/vpapi/quota-store";
import { KEY_SLOTS, type KeySlot } from "@/product/vpapi/slots";

const emptyKeys: Record<KeySlot, string> = { text: "", image: "", video: "", audio: "" };

/**
 * 接入引导：按能力填 API Key。
 *
 * vpapi 的令牌按分组暴露不同模型，所以文本 / 生图 / 视频可以分别填不同的 Key；
 * 一把 Key 覆盖多个能力时填在任意一行即可，模型会按网关公布的能力标签自动归类。
 */
export function ConnectGate() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const open = useProductStore((state) => state.connectOpen);
    const closeConnect = useProductStore((state) => state.closeConnect);
    const [keys, setKeys] = useState(emptyKeys);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");

    const connect = async () => {
        if (!KEY_SLOTS.some((slot) => keys[slot].trim())) {
            setError(t("product.connect.missingKey"));
            return;
        }
        setLoading(true);
        setError("");
        try {
            const results = await applyGatewayKeys(keys);
            const failed = results.filter((result) => !result.ok);
            const succeeded = results.filter((result) => result.ok);
            if (!succeeded.length) {
                setError(failed.map((result) => `${t(`product.keys.${result.slot}`)}：${result.error}`).join("；"));
                return;
            }
            const count = succeeded.reduce((sum, result) => sum + (result.models || 0), 0);
            setKeys(emptyKeys);
            closeConnect();
            message.success(t("product.connect.connected", { count }));
            if (failed.length) message.warning(failed.map((result) => `${t(`product.keys.${result.slot}`)}：${result.error}`).join("；"));
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
            width={520}
            title={
                <span className="flex items-center gap-2">
                    <KeyRound className="size-4" />
                    {t("product.connect.title")}
                </span>
            }
        >
            <div className="space-y-3">
                <div className="text-sm text-stone-500">{t("product.connect.subtitle")}</div>
                <div className="space-y-2">
                    {KEY_SLOTS.map((slot) => (
                        <div key={slot} className="flex items-center gap-2">
                            <span className="w-24 shrink-0 text-xs text-stone-500">{t(`product.keys.${slot}`)}</span>
                            <Input.Password
                                value={keys[slot]}
                                autoComplete="off"
                                placeholder={slot === "text" ? t("product.connect.keyPlaceholder") : t("product.keys.optional")}
                                onChange={(event) => setKeys((current) => ({ ...current, [slot]: event.target.value }))}
                                onPressEnter={() => void connect()}
                            />
                        </div>
                    ))}
                </div>
                <div className="text-xs text-stone-500">{t("product.connect.slotHint")}</div>
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
