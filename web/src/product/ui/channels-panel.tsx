import { App, Button, Input, Tag, Tooltip } from "antd";
import { ArrowDown, ArrowUp, RefreshCw, Trash2, Unplug } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { LINKS } from "@/product/brand";
import { addGatewayKey, disconnectGateway, gatewayUrl, moveGatewayKey, reloadGatewayKey, removeGatewayKey, replaceGatewayKey } from "@/product/vpapi/client";
import { useQuotaStore } from "@/product/vpapi/quota-store";
import { channelsOfGroup, connectedChannels, KEY_GROUPS, maskApiKey, type KeyGroup } from "@/product/vpapi/slots";
import { modelOptionName, useConfigStore, type ChannelModel, type ModelCapability, type ModelChannel } from "@/stores/use-config-store";

import { ExternalLink } from "./connect-gate";

const CAPABILITIES: ModelCapability[] = ["image", "video", "text", "audio"];

function countByCapability(models: ChannelModel[]) {
    return CAPABILITIES.reduce<Record<ModelCapability, number>>(
        (counts, capability) => ({ ...counts, [capability]: models.filter((model) => model.capability === capability).length }),
        { image: 0, video: 0, text: 0, audio: 0 },
    );
}

/**
 * 设置页的 vpapi 面板：文生 / 媒体两组 Key。
 * 每组可接多把 Key，组内顺序就是优先级（可上移 / 下移）；协议与网关地址不可更改（见 product/flags.ts）。
 */
export function ChannelsPanel() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const connected = connectedChannels(config);
    const counts = useMemo(() => countByCapability(config.channels.flatMap((channel) => channel.models)), [config.channels]);

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

            {KEY_GROUPS.map((group) => (
                <KeyGroupSection key={group} group={group} />
            ))}

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

function KeyGroupSection({ group }: { group: KeyGroup }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const channels = channelsOfGroup(config, group).filter((channel) => channel.apiKey.trim());
    const [apiKey, setApiKey] = useState("");
    const [adding, setAdding] = useState(false);

    const add = async () => {
        const key = apiKey.trim();
        if (!key) {
            message.error(t("product.connect.missingKey"));
            return;
        }
        setAdding(true);
        try {
            const count = await addGatewayKey(key, group);
            setApiKey("");
            message.success(t("product.connect.connected", { count }));
            void useQuotaStore.getState().refresh(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setAdding(false);
        }
    };

    return (
        <div className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{t(`product.keys.${group}`)}</span>
                <span className="text-xs text-stone-500">{t(`product.keys.${group}Hint`)}</span>
                <Tag>{t("product.channels.keyCount", { count: channels.length })}</Tag>
            </div>
            <div className="mt-2 space-y-2">
                {channels.length ? (
                    channels.map((channel, index) => <KeyRow key={channel.id} channel={channel} priority={index + 1} total={channels.length} />)
                ) : (
                    <div className="text-xs text-stone-500">{t("product.channels.emptyGroup")}</div>
                )}
                <div className="flex flex-wrap items-center gap-2">
                    <Input.Password
                        className="max-w-[280px]"
                        value={apiKey}
                        name={`vpapi-key-${group}-new`}
                        autoComplete="new-password"
                        placeholder={t("product.channels.keyPlaceholder")}
                        onChange={(event) => setApiKey(event.target.value)}
                        onPressEnter={() => void add()}
                    />
                    <Button size="small" type="primary" loading={adding} onClick={() => void add()}>
                        {t("product.channels.addKey")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

function KeyRow({ channel, priority, total }: { channel: ModelChannel; priority: number; total: number }) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const [editing, setEditing] = useState(false);
    const [nextKey, setNextKey] = useState("");
    const [busy, setBusy] = useState<"reload" | "replace" | "">("");
    const counts = useMemo(() => countByCapability(channel.models), [channel.models]);

    const reload = async () => {
        setBusy("reload");
        try {
            const count = await reloadGatewayKey(channel.id);
            message.success(t("product.channels.reconnectDone", { count }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy("");
        }
    };

    const replace = async () => {
        setBusy("replace");
        try {
            const count = await replaceGatewayKey(channel.id, nextKey);
            setNextKey("");
            setEditing(false);
            message.success(t("product.channels.reconnectDone", { count }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : String(error));
        } finally {
            setBusy("");
        }
    };

    const remove = () => {
        modal.confirm({
            title: t("product.channels.deleteKey"),
            content: t("product.channels.deleteConfirm", { key: maskApiKey(channel.apiKey) }),
            okButtonProps: { danger: true },
            onOk: () => {
                removeGatewayKey(channel.id);
                useQuotaStore.setState({ status: "idle", updatedAt: 0, error: "" });
                message.success(t("product.channels.deleteDone"));
            },
        });
    };

    return (
        <div className="rounded-md border border-stone-200 px-3 py-2 dark:border-stone-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex size-5 shrink-0 items-center justify-center rounded bg-stone-100 text-xs dark:bg-stone-800">{priority}</span>
                    <span className="text-stone-500">{maskApiKey(channel.apiKey)}</span>
                    <span className="text-stone-500">{t("product.channels.modelSummary", { image: counts.image, video: counts.video, text: counts.text, audio: counts.audio })}</span>
                </div>
                <div className="flex items-center gap-1">
                    <Tooltip title={t("product.channels.moveUp")}>
                        <Button size="small" type="text" icon={<ArrowUp className="size-3.5" />} disabled={priority === 1} onClick={() => moveGatewayKey(channel.id, -1)} />
                    </Tooltip>
                    <Tooltip title={t("product.channels.moveDown")}>
                        <Button size="small" type="text" icon={<ArrowDown className="size-3.5" />} disabled={priority === total} onClick={() => moveGatewayKey(channel.id, 1)} />
                    </Tooltip>
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} loading={busy === "reload"} onClick={() => void reload()}>
                        {t("product.channels.reconnect")}
                    </Button>
                    <Button size="small" onClick={() => setEditing(true)}>
                        {t("product.channels.changeKey")}
                    </Button>
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={remove} />
                </div>
            </div>
            {editing ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Input.Password
                        className="max-w-[280px]"
                        value={nextKey}
                        name={`vpapi-key-replace-${channel.id}`}
                        autoComplete="new-password"
                        placeholder={t("product.channels.keyPlaceholder")}
                        onChange={(event) => setNextKey(event.target.value)}
                        onPressEnter={() => void replace()}
                    />
                    <Button size="small" type="primary" loading={busy === "replace"} onClick={() => void replace()}>
                        {t("product.channels.save")}
                    </Button>
                    <Button
                        size="small"
                        onClick={() => {
                            setEditing(false);
                            setNextKey("");
                        }}
                    >
                        {t("common.cancel")}
                    </Button>
                </div>
            ) : null}
        </div>
    );
}
