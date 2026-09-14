import { App, Button, Input, Tag } from "antd";
import { RefreshCw, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { LINKS } from "@/product/brand";
import { applyGatewayKey, disconnectGateway, gatewayUrl, reloadGatewayModels } from "@/product/vpapi/client";
import { useQuotaStore } from "@/product/vpapi/quota-store";
import { KEY_SLOTS, SLOT_CHANNEL_ID, type KeySlot } from "@/product/vpapi/slots";
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
 * 设置页的 vpapi 面板：按能力槽位管理各自的 API Key。
 * 协议与网关地址不可更改（见 product/flags.ts）。
 */
export function ChannelsPanel() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const connected = config.channels.filter((channel) => channel.apiKey.trim());
    const counts = useMemo(() => countByCapability(config.channels.flatMap((channel) => channel.models)), [config.channels]);

    const disconnect = (slot?: KeySlot) => {
        modal.confirm({
            title: slot ? t("product.channels.disconnectSlot", { slot: t(`product.keys.${slot}`) }) : t("product.channels.disconnect"),
            content: t("product.channels.disconnectConfirm"),
            okButtonProps: { danger: true },
            onOk: () => {
                disconnectGateway(slot);
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
                    <Tag color={connected.length ? "green" : "default"}>{t(connected.length ? "product.channels.connected" : "product.channels.disconnected")}</Tag>
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
                    <span className="text-stone-500">{t("product.channels.models")}</span>
                    <span>{t("product.channels.modelSummary", { image: counts.image, video: counts.video, text: counts.text, audio: counts.audio })}</span>
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

            <div className="space-y-2">
                {KEY_SLOTS.map((slot) => (
                    <SlotRow key={slot} slot={slot} />
                ))}
            </div>

            <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-stone-500">{t("product.channels.lockedHint")}</div>
                {connected.length ? (
                    <Button danger size="small" icon={<Unplug className="size-3.5" />} onClick={() => disconnect()}>
                        {t("product.channels.disconnect")}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function SlotRow({ slot }: { slot: KeySlot }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const channel = useConfigStore((state) => state.config.channels.find((item) => item.id === SLOT_CHANNEL_ID[slot]));
    const [apiKey, setApiKey] = useState("");
    const [busy, setBusy] = useState<"connect" | "reload" | "">("");
    const models = channel?.models || [];
    const counts = useMemo(() => countByCapability(models), [models]);
    const isConnected = Boolean(channel?.apiKey.trim());

    const connect = async () => {
        const key = apiKey.trim();
        if (!key) {
            message.error(t("product.connect.missingKey"));
            return;
        }
        setBusy("connect");
        try {
            const count = await applyGatewayKey(key, slot);
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
            const count = await reloadGatewayModels(slot);
            message.success(t("product.channels.reconnectDone", { count }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy("");
        }
    };

    return (
        <div className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium">{t(`product.keys.${slot}`)}</span>
                    <Tag color={isConnected ? "green" : "default"}>{t(isConnected ? "product.channels.connected" : "product.channels.disconnected")}</Tag>
                    {isConnected ? (
                        <span className="text-xs text-stone-500">{t("product.channels.modelSummary", { image: counts.image, video: counts.video, text: counts.text, audio: counts.audio })}</span>
                    ) : null}
                </div>
                {isConnected ? (
                    <div className="flex items-center gap-2">
                        <span className="text-xs text-stone-500">{maskKey(channel?.apiKey || "")}</span>
                        <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={busy === "reload"} onClick={() => void reload()}>
                            {t("product.channels.reconnect")}
                        </Button>
                        <Button size="small" danger icon={<Unplug className="size-3.5" />} onClick={() => disconnectGateway(slot)}>
                            {t("product.channels.disconnect")}
                        </Button>
                    </div>
                ) : (
                    <div className="flex min-w-[260px] flex-1 items-center justify-end gap-2">
                        <Input.Password
                            className="max-w-[260px]"
                            value={apiKey}
                            autoComplete="off"
                            placeholder={t("product.channels.keyPlaceholder")}
                            onChange={(event) => setApiKey(event.target.value)}
                            onPressEnter={() => void connect()}
                        />
                        <Button size="small" type="primary" loading={busy === "connect"} onClick={() => void connect()}>
                            {t("product.connect.connect")}
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
