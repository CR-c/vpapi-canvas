import { App, Button, Input, Tag } from "antd";
import { RefreshCw, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { LINKS } from "@/product/brand";
import { applyGatewayKey, disconnectGateway, gatewayUrl, reloadGatewayModels } from "@/product/vpapi/client";
import { useQuotaStore } from "@/product/vpapi/quota-store";
import { modelOptionName, useConfigStore, type ChannelModel, type ModelCapability } from "@/stores/use-config-store";

import { ExternalLink } from "./connect-gate";

const CAPABILITIES: ModelCapability[] = ["image", "video", "text", "audio"];

function maskKey(key: string) {
    const value = key.trim();
    if (value.length <= 8) return value ? "••••" : "";
    return `${value.slice(0, 4)}••••${value.slice(-4)}`;
}

function countByCapability(models: ChannelModel[]) {
    return CAPABILITIES.reduce<Record<ModelCapability, number>>(
        (counts, capability) => ({ ...counts, [capability]: models.filter((model) => model.capability === capability).length }),
        { image: 0, video: 0, text: 0, audio: 0 },
    );
}

/**
 * 设置页的 vpapi 面板，替换上游的渠道管理：
 * 只展示接入状态、模型概览与默认模型，协议与网关地址不可更改（见 product/flags.ts）。
 */
export function ChannelsPanel() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const [apiKey, setApiKey] = useState("");
    const [busy, setBusy] = useState<"connect" | "reload" | "">("");
    const models = config.channels[0]?.models || [];
    const counts = useMemo(() => countByCapability(models), [models]);
    const connected = Boolean(config.apiKey.trim());

    const save = async () => {
        const key = apiKey.trim();
        if (!key) {
            message.error(t("product.connect.missingKey"));
            return;
        }
        setBusy("connect");
        try {
            const count = await applyGatewayKey(key);
            setApiKey("");
            message.success(t("product.connect.connected", { count }));
            void useQuotaStore.getState().refresh(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy("");
        }
    };

    const reload = async () => {
        setBusy("reload");
        try {
            const count = await reloadGatewayModels();
            message.success(t("product.channels.reconnectDone", { count }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy("");
        }
    };

    const disconnect = () => {
        modal.confirm({
            title: t("product.channels.disconnect"),
            content: t("product.channels.disconnectConfirm"),
            okButtonProps: { danger: true },
            onOk: () => {
                disconnectGateway();
                useQuotaStore.setState({ status: "idle", updatedAt: 0, error: "" });
                message.success(t("product.channels.disconnectedDone"));
            },
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{t("product.channels.title")}</span>
                    <Tag color={connected ? "green" : "default"}>{t(connected ? "product.channels.connected" : "product.channels.disconnected")}</Tag>
                </div>
                <div className="flex flex-wrap gap-3 text-xs">
                    <ExternalLink href={LINKS.keys} label={t("product.connect.getKey")} />
                    <ExternalLink href={LINKS.wallet} label={t("product.connect.recharge")} />
                </div>
            </div>

            <div className="rounded-lg border border-stone-200 px-4 py-3 text-xs dark:border-stone-800">
                <div className="flex justify-between gap-3">
                    <span className="text-stone-500">{t("product.channels.gateway")}</span>
                    <code className="truncate">{gatewayUrl(config)}</code>
                </div>
                <div className="mt-2 flex justify-between gap-3">
                    <span className="text-stone-500">{t("product.channels.key")}</span>
                    <span className="truncate">{maskKey(config.apiKey) || "—"}</span>
                </div>
                <div className="mt-2 flex justify-between gap-3">
                    <span className="text-stone-500">{t("product.channels.models")}</span>
                    <span>
                        {models.length
                            ? t("product.channels.modelSummary", { image: counts.image, video: counts.video, text: counts.text, audio: counts.audio })
                            : "—"}
                    </span>
                </div>
                <div className="mt-2 flex justify-between gap-3">
                    <span className="text-stone-500">{t("product.channels.defaults")}</span>
                    <span className="truncate">
                        {[config.imageModel, config.videoModel, config.textModel, config.audioModel]
                            .map((value) => modelOptionName(value))
                            .filter(Boolean)
                            .join(" · ") || "—"}
                    </span>
                </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Input.Password
                    className="min-w-[220px] flex-1"
                    value={apiKey}
                    autoComplete="off"
                    placeholder={connected ? t("product.channels.changeKey") : t("product.channels.keyPlaceholder")}
                    onChange={(event) => setApiKey(event.target.value)}
                    onPressEnter={() => void save()}
                />
                <Button type="primary" loading={busy === "connect"} onClick={() => void save()}>
                    {t(connected ? "product.channels.save" : "product.connect.connect")}
                </Button>
                <Button icon={<RefreshCw className="size-3.5" />} disabled={!connected} loading={busy === "reload"} onClick={() => void reload()}>
                    {t("product.channels.reconnect")}
                </Button>
                <Button danger icon={<Unplug className="size-3.5" />} disabled={!connected} onClick={disconnect}>
                    {t("product.channels.disconnect")}
                </Button>
            </div>

            <div className="text-xs text-stone-500">{t("product.channels.lockedHint")}</div>
        </div>
    );
}
