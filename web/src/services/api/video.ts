import axios from "axios";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, resolveModelVideoSpec, videoSpecResolution, videoSpecSeconds, type AiConfig, type ChannelVideoSpec } from "@/stores/use-config-store";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
// [vpapi-canvas] fork：生成前按网关价格提示本次消耗。
import { generationCostNotice } from "@/product/vpapi/pricing";
import { useProductStore } from "@/product/store";

type VideoResponse = { id: string; status?: string; error?: { message?: string }; url?: string; result_url?: string; video_url?: string; metadata?: { url?: string; video_url?: string; result_url?: string } | null; content?: { video_url?: string; url?: string } | null };
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };
const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export const VIDEO_TASK_POLL_INTERVAL = 2500;
// Some providers (e.g. seedance) take 10+ minutes to render; keep polling for
// up to 30 minutes so a task is not reported as failed while it is still running.
export const VIDEO_TASK_TIMEOUT_MS = 30 * 60 * 1000;
// A poll that fails for a moment (network flap, gateway restart, rate limit) must
// not fail a generation the provider is still rendering, so keep retrying for about
// a minute before reporting the error.
const VIDEO_TASK_QUERY_RETRY_DELAYS = [2000, 4000, 8000, 16000, 30000];

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "plugin"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

type VideoMediaOptions = RequestOptions & { videos?: ReferenceVideo[]; audios?: ReferenceAudio[] };

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, options);
    const deadline = Date.now() + VIDEO_TASK_TIMEOUT_MS;
    while (Date.now() < deadline) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        await delay(VIDEO_TASK_POLL_INTERVAL, options?.signal);
    }
    throw new Error(apiText("videoTimeout", { provider: "" }));
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    notifyModelCost(selectedModel, { seconds: Number(config.videoSeconds), resolution: config.vquality, hasReferences: references.length > 0 });
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: apiText("pluginVideoExpired") };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    const spec = resolveModelVideoSpec(config, model);
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const videos = await Promise.all((options?.videos || []).map((video) => mediaToDataUrl(video.url)));
    const audios = await Promise.all((options?.audios || []).map((audio) => mediaToDataUrl(audio.url)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: adaptVideoSeconds(config.videoSeconds, model, spec),
                size: normalizeVideoSize(config.size),
                resolution: adaptVideoResolution(config.vquality, model, spec),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
                videos: videos.filter(Boolean),
                audios: audios.filter(Boolean),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error(apiText("scriptNoVideo"));
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    if (result.blob) return uploadMediaFile(result.blob, "video");
    if (result.url) {
        try {
            return await uploadMediaFile(result.url, "video");
        } catch {
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error(apiText("noPlayableVideo"));
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: VideoMediaOptions): Promise<VideoGenerationTask> {
    const modelName = modelOptionName(model);
    const spec = resolveModelVideoSpec(config, model);
    const body: Record<string, unknown> = {
        model: modelName,
        prompt,
        seconds: adaptVideoSeconds(config.videoSeconds, modelName, spec),
        ...(normalizeVideoSize(config.size) ? { size: normalizeVideoSize(config.size) } : {}),
        resolution: adaptVideoResolution(config.vquality, modelName, spec),
        preset: "normal",
    };
    // Send typed arrays so @图片N / @视频N / @音频N bind 1:1 on Seedance-style gateways.
    if (references.length) {
        body.images = await Promise.all(references.map((image) => imageToDataUrl(image)));
    }
    const videos = await Promise.all((options?.videos || []).map((video) => mediaToDataUrl(video.url)));
    const audios = await Promise.all((options?.audios || []).map((audio) => mediaToDataUrl(audio.url)));
    if (videos.length) body.videos = videos.filter(Boolean);
    if (audios.length) body.audios = audios.filter(Boolean);
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error(apiText("noVideoTaskId"));
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, apiText("videoTaskCreateFailed")));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    for (let retry = 0; ; retry += 1) {
        try {
            return await readOpenAIVideoTask(config, task, options);
        } catch (error) {
            if (retry < VIDEO_TASK_QUERY_RETRY_DELAYS.length && isTransientVideoQueryError(error)) {
                await delay(VIDEO_TASK_QUERY_RETRY_DELAYS[retry], options?.signal);
                continue;
            }
            throw new Error(readAxiosError(error, apiText("videoTaskQueryFailed")));
        }
    }
}

async function readOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
    const url = videoResultUrl(video);
    if (url) return { status: "completed", result: await videoResultFromUrl(config, task, url, options) };
    if (video.status === "completed") return { status: "completed", result: { blob: await fetchVideoContent(config, task, options) } };
    if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || apiText("videoGenerationFailed") };
    return { status: "pending" };
}

async function fetchVideoContent(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions) {
    const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
    await assertVideoBlob(content.data);
    return content.data;
}

/** Gateways that publish the result as a share URL (e.g. vpapi) may hand out a URL the browser cannot read itself, so fall back to the authenticated content endpoint. */
async function videoResultFromUrl(config: AiConfig, task: VideoGenerationTask, url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        try {
            return { blob: await fetchVideoContent(config, task, options) };
        } catch (fallbackError) {
            if (axios.isCancel(fallbackError) || options?.signal?.aborted) throw fallbackError;
            return { url, mimeType: "video/mp4" };
        }
    }
}

/** Network flaps, gateway hiccups and rate limits only mean "ask again"; auth and aborted requests must surface immediately. */
function isTransientVideoQueryError(error: unknown) {
    if (axios.isCancel(error)) return false;
    if (error instanceof DOMException && error.name === "AbortError") return false;
    if (!axios.isAxiosError(error)) return false;
    const status = error.response?.status;
    if (!status) return error.code === "ERR_NETWORK" || error.code === "ECONNABORTED" || error.code === "ETIMEDOUT";
    return status === 408 || status === 425 || status === 429 || status >= 500;
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error(apiText("videoModelRequired"));
    if (!config.baseUrl.trim()) throw new Error(apiText("baseUrlRequired"));
    if (!config.apiKey.trim()) throw new Error(apiText("apiKeyRequired"));
    if (config.apiFormat === "gemini") throw new Error(apiText("geminiVideoUnsupported"));
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium") return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    if (resolution === "2160") return "4k";
    if (resolution === "1440") return "2k";
    return `${resolution}p`;
}

/** Provider-specific video specs keyed by model name keywords; used to adapt defaults that the gateway validates strictly. */
const VIDEO_MODEL_SPECS: Array<{ match: RegExp; minSeconds: number; maxSeconds: number; fixedSeconds?: number; defaultResolution: string; resolutions: string[] }> = [
    { match: /minimax-h3-768p/i, minSeconds: 10, maxSeconds: 15, defaultResolution: "768p", resolutions: ["768p"] },
    { match: /seedance-2\.5-c1|seedance2\.5/i, minSeconds: 4, maxSeconds: 29, defaultResolution: "720p", resolutions: ["480p", "720p"] },
    { match: /videos_900_720p/i, minSeconds: 15, maxSeconds: 15, fixedSeconds: 15, defaultResolution: "720p", resolutions: ["720p"] },
    { match: /minimax-h3-d/i, minSeconds: 4, maxSeconds: 15, defaultResolution: "720p", resolutions: ["720p", "768p", "1080p", "2k"] },
    { match: /minimax-h3/i, minSeconds: 4, maxSeconds: 15, defaultResolution: "720p", resolutions: ["720p"] },
    { match: /seedance|dreamina/i, minSeconds: 4, maxSeconds: 30, defaultResolution: "720p", resolutions: ["480p", "720p", "1080p", "4k"] },
    { match: /sd_2\.5|sd-2-5/i, minSeconds: 4, maxSeconds: 30, defaultResolution: "720p", resolutions: ["480p", "720p", "1080p"] },
    { match: /sd-2-0/i, minSeconds: 4, maxSeconds: 15, defaultResolution: "720p", resolutions: ["480p", "720p", "1080p", "4k"] },
    { match: /wan-3/i, minSeconds: 5, maxSeconds: 30, defaultResolution: "720p", resolutions: ["720p"] },
];

function videoModelSpec(model: string) {
    return VIDEO_MODEL_SPECS.find((item) => item.match.test(model)) || { match: /.*/, minSeconds: 1, maxSeconds: 20, fixedSeconds: undefined, defaultResolution: "720p", resolutions: ["480p", "720p", "1080p", "2k", "4k"] };
}

function adaptVideoSeconds(value: string, model: string, spec?: ChannelVideoSpec) {
    const fromGateway = videoSpecSeconds(spec, value);
    if (fromGateway) return fromGateway;
    const resolved = videoModelSpec(model);
    if (resolved.fixedSeconds) return String(resolved.fixedSeconds);
    const seconds = Math.floor(Number(value) || resolved.minSeconds);
    return String(Math.max(resolved.minSeconds, Math.min(resolved.maxSeconds, seconds)));
}

function adaptVideoResolution(value: string, model: string, spec?: ChannelVideoSpec) {
    const fromGateway = videoSpecResolution(spec, value);
    if (fromGateway) return fromGateway;
    const resolved = videoModelSpec(model);
    const normalized = normalizeVideoResolution(value);
    if (resolved.resolutions.includes(normalized)) return normalized;
    return resolved.defaultResolution;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, apiText("noVideoTask"));
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0" && payload.code !== "success") throw new Error(readApiErrorMessage(payload) || apiText("requestFailed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse) {
    const candidates = [payload.video_url, payload.result_url, payload.url, payload.metadata?.video_url, payload.metadata?.result_url, payload.metadata?.url, payload.content?.video_url, payload.content?.url];
    return candidates.find((url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url))) || "";
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error may be a string or an object containing a message.
    const errorMsg =
        typeof payload.error === "string"
            ? payload.error
            : (payload.error as { message?: unknown })?.message;
    return (
        readApiErrorMessage(payload.msg) ||
        readApiErrorMessage(payload.message) ||
        readApiErrorMessage(errorMsg) ||
        readApiErrorMessage(payload.detail) ||
        ""
    );
}

function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return apiText("requestCanceled");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        if (!error.response && error.code === "ERR_NETWORK") return apiText("requestFailed");
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return apiText("requestCanceled");
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return apiText("authenticationFailed");
    if (status === 429) return apiText("rateLimited");
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (blob.type.includes("html")) throw new Error(apiText("videoDownloadFailed"));
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || apiText("videoDownloadFailed"));
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

async function mediaToDataUrl(url: string) {
    const value = (url || "").trim();
    if (!value) return "";
    if (value.startsWith("data:") || isPublicMediaUrl(value)) return value;
    const blob = await (await fetch(value)).blob();
    return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(reader.error || new Error("failed to read media"));
        reader.readAsDataURL(blob);
    });
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

/** [vpapi-canvas] fork：按网关价格目录提示本次预计消耗（拿不到价格时静默）。 */
function notifyModelCost(encodedModel: string, context: { seconds?: number; resolution?: string; hasReferences?: boolean }) {
    const notice = generationCostNotice(encodedModel, context);
    if (notice) useProductStore.getState().pushNotice(notice);
}
