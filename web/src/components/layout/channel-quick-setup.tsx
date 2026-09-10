import { App, Button, Input } from "antd";
import { Zap } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { fetchChannelModels } from "@/services/api/image";
import { applyChannels, createModelChannel, defaultConfig, useConfigStore, VPAPI_BASE_URL, VPAPI_CHANNEL_ID } from "@/stores/use-config-store";

/**
 * First-run shortcut: the vpapi protocol publishes both the model list and each
 * model's capability, so a key is the only thing a new user has to supply.
 */
export function ChannelQuickSetup() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const preset = config.channels.find((channel) => channel.id === VPAPI_CHANNEL_ID);
    const [baseUrl, setBaseUrl] = useState(preset?.baseUrl || VPAPI_BASE_URL);
    const [apiKey, setApiKey] = useState(preset?.apiKey || "");
    const [loading, setLoading] = useState(false);
    const ready = Boolean(apiKey.trim() && baseUrl.trim() && preset?.models.length);

    if (ready) return null;

    const connect = async () => {
        if (!apiKey.trim()) {
            message.error(t("config.quickSetup.missingKey"));
            return;
        }
        const channel = createModelChannel({ ...(preset || defaultConfig.channels[0]), id: VPAPI_CHANNEL_ID, name: "vpapi", apiFormat: "vpapi", baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), models: [] });
        setLoading(true);
        try {
            const models = await fetchChannelModels(channel);
            if (!models.length) {
                message.error(t("config.quickSetup.empty"));
                return;
            }
            const next = applyChannels(config, [{ ...channel, models }, ...config.channels.filter((item) => item.id !== VPAPI_CHANNEL_ID)]);
            (Object.keys(next) as Array<keyof typeof next>).forEach((key) => updateConfig(key, next[key]));
            message.success(t("config.quickSetup.connected", { count: models.length }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.quickSetup.failed"));
        } finally {
            setLoading(false);
        }
    };

    return (
        <section className="mb-4 rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
            <div className="flex items-center gap-2 text-sm font-semibold">
                <Zap className="size-4" />
                {t("config.quickSetup.title")}
            </div>
            <div className="mt-1 text-xs text-stone-500">{t("config.quickSetup.description")}</div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input.Password className="min-w-[220px] flex-1" value={apiKey} autoComplete="off" placeholder={t("config.quickSetup.keyPlaceholder")} onChange={(event) => setApiKey(event.target.value)} onPressEnter={() => void connect()} />
                <Button type="primary" loading={loading} onClick={() => void connect()}>
                    {t("config.quickSetup.connect")}
                </Button>
            </div>
            <Input className="mt-2" value={baseUrl} placeholder={VPAPI_BASE_URL} onChange={(event) => setBaseUrl(event.target.value)} />
        </section>
    );
}
