import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
// [vpapi-canvas] fork 专用：网关地址与接入分组来自产品层，避免在多处硬编码。
import { GATEWAY_URL } from "@/product/brand";
import { EMPTY_GROUP_CHANNEL_ID, groupOfChannel, primaryGatewayChannel, sortGroupChannels } from "@/product/vpapi/slots";

export type ApiCallFormat = "openai" | "gemini" | "vpapi";
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";

/** Video constraints published by the vpapi gateway per model. */
export type ChannelVideoSpec = {
    durations: number[];
    defaultDuration?: number;
    resolutions: string[];
    aspectRatios: string[];
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
    supportsSmartDuration?: boolean;
    supportsFirstLastFrames?: boolean;
    supportsGenerateAudio?: boolean;
    supportsWatermark?: boolean;
};

export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    script?: string;
    video?: ChannelVideoSpec;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    count: string;
    canvasImageCount: string;
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "preferences" | "prompt-sources" | "webdav" | "local-storage";

export const CONFIG_STORE_KEY = "infinite-canvas:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = "https://api.openai.com";
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com";
/** Public gateway that speaks the vpapi protocol; users only need to paste their key. */
export const VPAPI_BASE_URL = GATEWAY_URL;
export const VPAPI_CHANNEL_ID = "vpapi";

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: VPAPI_BASE_URL,
    apiKey: "",
    apiFormat: "vpapi",
    channels: [
        {
            id: VPAPI_CHANNEL_ID,
            name: "vpapi",
            baseUrl: VPAPI_BASE_URL,
            apiKey: "",
            apiFormat: "vpapi",
            models: [],
        },
    ],
    model: "",
    imageModel: "",
    videoModel: "",
    textModel: "",
    audioModel: "",
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [],
    quality: "auto",
    size: "1:1",
    background: "",
    count: "1",
    canvasImageCount: "3",
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "infinite-canvas",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["video", "sora", "veo", "kling", "wan", "hailuo", "seedance", "minimax", "pixverse", "runway", "luma", "mochi", "cogvideo", "hunyuan-video", "sd-2", "sd_2", "sd2", "videos_"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney", "picasso", "aura", "recraft", "nova", "hidream"];

export function boolConfig(value: string, fallback: boolean) {
    return value ? value === "true" : fallback;
}
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "music", "sound"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

/** Capability from the endpoint types the gateway advertises for a model; undefined when the gateway does not publish them. */
export function capabilityFromEndpointTypes(types: string[] | undefined): ModelCapability | undefined {
    if (!types?.length) return undefined;
    if (types.includes("openai-video")) return "video";
    if (types.includes("image-generation")) return "image";
    if (types.some((type) => type === "openai" || type === "openai-response" || type === "anthropic" || type === "gemini")) return "text";
    return undefined;
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

/** Video constraints the gateway published for a model; undefined when the channel has none. */
export function resolveModelVideoSpec(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.video;
}

// [vpapi-canvas] fork：网关有的写 "4k"/"2k"，有的写像素值，两边都折算成像素值再比较。
const RESOLUTION_ALIASES: Record<string, string> = { "1k": "1024", "2k": "1440", "4k": "2160" };

/** Compare resolutions across the gateway's labels ("4k", "2K", "768P") and the legacy numeric scale ("2160"). */
function resolutionKey(value: string) {
    const normalized = value.trim().toLowerCase().replace(/p$/, "");
    return RESOLUTION_ALIASES[normalized] || normalized;
}

/** Snap a duration onto the durations the gateway accepts; undefined when the model publishes none. */
export function videoSpecSeconds(spec: ChannelVideoSpec | undefined, value: string) {
    if (!spec?.durations.length) return undefined;
    const durations = [...spec.durations].sort((a, b) => a - b);
    const requested = Math.floor(Number(value) || durations[0]);
    return String(durations.reduce((best, item) => (Math.abs(item - requested) < Math.abs(best - requested) ? item : best)));
}

// [vpapi-canvas] fork：面板没明确选过时写入的通用值（配置默认档与 auto 语义），拿不到匹配才吸附到网关挡位。
const IMPLICIT_VIDEO_RESOLUTIONS = new Set(["", "auto", "low", "medium", "high", "720"]);

/**
 * Snap a resolution onto the labels the gateway accepts; undefined when the model publishes none.
 *
 * [vpapi-canvas] fork：网关没公布的挡位按「用户手填」处理，原样按标签返回（网关不支持时会明确报错，
 * 例如 seedance-2.0-mini-XG 公布 720p、用户坚持用 480p），不再静默改成第一档。
 */
export function videoSpecResolution(spec: ChannelVideoSpec | undefined, value: string) {
    if (!spec?.resolutions.length) return undefined;
    const requested = resolutionKey(value);
    const matched = spec.resolutions.find((item) => resolutionKey(item) === requested);
    if (matched) return matched;
    if (/^\d+$/.test(requested) && !IMPLICIT_VIDEO_RESOLUTIONS.has(requested)) return `${requested}p`;
    return spec.resolutions[0];
}

/** [vpapi-canvas] fork：面板的数值输入框展示用（"720p" -> "720"、"4k" -> "2160"）。 */
export function videoResolutionNumber(value: string) {
    const key = resolutionKey(value);
    return /^\d+$/.test(key) ? key : value.trim().replace(/p$/i, "");
}

function isAiConfigReady(config: AiConfig, model: string) {
    const channel = resolveModelChannel(config, model);
    return Boolean(model.trim() && channel.baseUrl.trim() && channel.apiKey.trim());
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: lockProductConfig({
                        ...state.config,
                        [key]: value,
                    }),
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            version: 5,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            migrate: (persistedState, version) => {
                const persisted = (persistedState || {}) as Partial<ConfigStore>;
                // v5 起默认渠道改为 vpapi 协议；更早的版本内置了固定的第三方渠道与密钥，一律重置。
                if (version >= 5) return persisted as { config: AiConfig; webdav: WebdavSyncConfig };
                return { config: { ...defaultConfig }, webdav: persisted.webdav || defaultWebdavSyncConfig };
            },
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                const config = { ...defaultConfig, ...persistedConfig };
                if (!Array.isArray(persistedConfig.channels)) config.channels = [];
                const channels = normalizeChannels(config);
                const models = modelOptionsFromChannels(channels);
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: lockProductConfig({
                        ...config,
                        channelMode: "local",
                        apiFormat: normalizeApiFormat(config.apiFormat),
                        channels,
                        models,
                        imageModel: normalizeModelOptionValue(config.imageModel || config.model, channels),
                        videoModel: normalizeModelOptionValue(config.videoModel, channels),
                        textModel: normalizeModelOptionValue(config.textModel || config.model, channels),
                        audioModel: normalizeModelOptionValue(config.audioModel || defaultConfig.audioModel, channels),
                        audioVoice: config.audioVoice || defaultConfig.audioVoice,
                        audioFormat: config.audioFormat || defaultConfig.audioFormat,
                        audioSpeed: config.audioSpeed || defaultConfig.audioSpeed,
                        audioInstructions: config.audioInstructions || "",
                        reasoningEffort: config.reasoningEffort || "auto",
                        videoSeconds: config.videoSeconds || "6",
                        vquality: config.vquality || "720",
                        videoGenerateAudio: config.videoGenerateAudio || "true",
                        videoWatermark: config.videoWatermark || "false",
                        canvasImageCount: config.canvasImageCount || "3",
                    }),
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        result.push({ name, capability, script, ...(typeof item === "string" || !item.video ? {} : { video: item.video }) });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || i18n.t("config.channels.newName"),
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        models: normalizeChannelModels(channel?.models),
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : model;
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    return matched || config.channels[0] || createModelChannel({ id: "default", name: i18n.t("config.channels.defaultName"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) });
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    return {
        ...config,
        model: modelOptionName(value || config.model),
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const channels = persistedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? i18n.t("config.channels.defaultName") : i18n.t("config.channels.indexedName", { index: index + 1 })),
            models: normalizeChannelModels(channel.models),
        }),
    );
    if (!channels.length) {
        channels.push(
            createModelChannel({
                id: "default",
                name: i18n.t("config.channels.defaultName"),
                baseUrl: config.baseUrl || defaultConfig.baseUrl,
                apiKey: config.apiKey || "",
                apiFormat: config.apiFormat || defaultConfig.apiFormat,
                models: normalizeChannelModels([config.model, config.imageModel, config.videoModel, config.textModel, config.audioModel].map(modelOptionName)),
            }),
        );
    }
    return channels;
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    if (apiFormat === "gemini") return GEMINI_BASE_URL;
    if (apiFormat === "vpapi") return VPAPI_BASE_URL;
    return OPENAI_BASE_URL;
}

/** Replace the channel list and re-derive the model options plus one default model per capability. */
export function applyChannels(config: AiConfig, channels: ModelChannel[]): AiConfig {
    // [vpapi-canvas] fork：顶层 apiKey / baseUrl 取第一把非空 Key（文生组优先），不再固定取第一个渠道。
    const primary = primaryGatewayChannel(channels);
    const next: AiConfig = {
        ...config,
        channels,
        models: modelOptionsFromChannels(channels),
        baseUrl: primary?.baseUrl || config.baseUrl,
        apiKey: primary?.apiKey || config.apiKey,
        apiFormat: primary?.apiFormat || config.apiFormat,
    };
    return {
        ...next,
        imageModel: pickDefaultModel(next, "image", config.imageModel),
        videoModel: pickDefaultModel(next, "video", config.videoModel),
        textModel: pickDefaultModel(next, "text", config.textModel),
        audioModel: pickDefaultModel(next, "audio", config.audioModel),
    };
}

function pickDefaultModel(config: AiConfig, capability: ModelCapability, current: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(current, config.channels);
    return options.includes(normalized) ? normalized : options[0] || "";
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    if (apiFormat === "gemini" || apiFormat === "vpapi") return apiFormat;
    return "openai";
}

/**
 * [vpapi-canvas] fork：默认模型必须与槽位能力一致。
 *
 * 网关的能力标签（`supported_endpoint_types`）是「生图 / 视频」的唯一来源，
 * 视频模型一旦混进生图槽位（例如助手按文字指定模型），生成会走图片端点，
 * 所以这里对不匹配的值直接清空，让用户重新选。
 */
function pickCapabilityModel(config: AiConfig, capability: ModelCapability, value: string) {
    const options = selectableModelsByCapability(config, capability);
    const normalized = normalizeModelOptionValue(value, config.channels);
    return options.includes(normalized) ? normalized : "";
}

/**
 * [vpapi-canvas] fork 专用：画布只对接 vpapi。
 *
 * 把配置收敛成「文生 / 媒体两组渠道（每组可接多把 Key，组内顺序即优先级）+ 官方网关 + vpapi 协议」，
 * 模型与默认模型随之重算；不带分组前缀的渠道（上游渠道、旧的单槽位渠道）会被丢弃。
 * 上游的渠道管理、协议切换与模型脚本入口因此不会生效（界面入口也已隐藏），但上游代码保持原样，方便同步。
 */
function lockProductConfig(config: AiConfig): AiConfig {
    const kept = sortGroupChannels(config.channels.filter((channel) => groupOfChannel(channel.id) && (channel.apiKey.trim() || channel.models.length))).map((channel) =>
        createModelChannel({ ...channel, baseUrl: VPAPI_BASE_URL, apiFormat: "vpapi" }),
    );
    // 一把 Key 都没有时保留固定 id 的占位渠道，让「是否已接入」与默认模型仍有落点。
    const channels = kept.length ? kept : [createModelChannel({ id: EMPTY_GROUP_CHANNEL_ID, name: "vpapi · text", baseUrl: VPAPI_BASE_URL, apiFormat: "vpapi" })];
    const primary = primaryGatewayChannel(channels) as ModelChannel;
    const locked: AiConfig = {
        ...config,
        channels,
        baseUrl: primary.baseUrl,
        apiKey: primary.apiKey,
        apiFormat: "vpapi",
        models: modelOptionsFromChannels(channels),
    };
    return {
        ...locked,
        imageModel: pickCapabilityModel(locked, "image", config.imageModel || config.model),
        videoModel: pickCapabilityModel(locked, "video", config.videoModel),
        textModel: pickCapabilityModel(locked, "text", config.textModel || config.model),
        audioModel: pickCapabilityModel(locked, "audio", config.audioModel || defaultConfig.audioModel),
    };
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    const normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}
