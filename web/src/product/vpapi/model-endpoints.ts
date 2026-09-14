import axios from "axios";

import { buildApiUrl } from "@/stores/use-config-store";

import { GATEWAY_URL } from "../brand";
import { SLOT_CHANNEL_ID, type KeySlot } from "./slots";

/**
 * 每个模型在网关上公布的 `supported_endpoint_types` 缓存。
 *
 * 画布上游只按「生成能力」把模型归为 图片/视频/文本/音频，模型同时支持对话端点
 * （例如 Gemini / GPT 的 image 系列也带 `openai`）时会被归到图片类，
 * 导致这类 Key 在画布上没有可选的文本模型。助手需要按端点能力挑对话模型，所以单独缓存这份数据。
 *
 * 缓存以「槽位渠道 id::模型名」为键，避免不同 Key 下同名模型互相覆盖。
 */
const STORAGE_KEY = "vpapi-canvas:model-endpoints";

type EndpointMap = Record<string, string[]>;

const CHAT_ENDPOINTS = ["openai", "openai-response", "anthropic", "gemini"];

export function modelKey(slot: KeySlot, model: string) {
    return `${SLOT_CHANNEL_ID[slot]}::${model}`;
}

export function readModelEndpoints(): EndpointMap {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
        return parsed && typeof parsed === "object" ? (parsed as EndpointMap) : {};
    } catch {
        return {};
    }
}

function writeModelEndpoints(map: EndpointMap) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch {
        /* 忽略存储失败：只影响助手模型列表 */
    }
}

/** 拉取某个槽位 Key 的模型端点能力并合并进缓存。 */
export async function refreshModelEndpoints(apiKey: string, slot: KeySlot, baseUrl = GATEWAY_URL): Promise<EndpointMap> {
    const response = await axios.get<{ data?: Array<{ id?: string; supported_endpoint_types?: string[] }> }>(buildApiUrl(baseUrl, "/models"), { headers: { Authorization: `Bearer ${apiKey.trim()}` } });
    const prefix = `${SLOT_CHANNEL_ID[slot]}::`;
    const next = Object.fromEntries(Object.entries(readModelEndpoints()).filter(([key]) => !key.startsWith(prefix)));
    (response.data?.data || []).forEach((model) => {
        if (!model?.id) return;
        const types = Array.isArray(model.supported_endpoint_types) ? model.supported_endpoint_types.filter((type): type is string => typeof type === "string") : [];
        if (types.length) next[modelKey(slot, model.id)] = types;
    });
    writeModelEndpoints(next);
    return next;
}

/** 该模型（编码值）是否支持对话类端点。 */
export function isChatModel(encodedModel: string, map = readModelEndpoints()) {
    const types = map[encodedModel];
    if (!types?.length) return false;
    return types.some((type) => CHAT_ENDPOINTS.includes(type.toLowerCase()));
}

/** 对话协议偏好：只支持 Responses 的模型（如 Codex 渠道）走 /v1/responses。 */
export function preferredAgentProtocol(encodedModel: string, map = readModelEndpoints()): "chat" | "responses" | null {
    const types = (map[encodedModel] || []).map((type) => type.toLowerCase());
    if (!types.length) return null;
    if (types.includes("openai") || types.includes("anthropic") || types.includes("gemini")) return "chat";
    if (types.includes("openai-response")) return "responses";
    return null;
}

/**
 * 模型是否支持 function calling。
 *
 * 网关不会公布这个能力，只能在实际调用后记住结论：不支持时助手退化为纯对话。
 */
const TOOLS_KEY = "vpapi-canvas:agent-model-tools";

type ToolSupport = Record<string, boolean>;

export function readToolSupport(): ToolSupport {
    try {
        const parsed = JSON.parse(localStorage.getItem(TOOLS_KEY) || "{}");
        return parsed && typeof parsed === "object" ? (parsed as ToolSupport) : {};
    } catch {
        return {};
    }
}

/** true = 已确认支持、false = 已确认不支持、undefined = 未知。 */
export function isToolsModel(encodedModel: string): boolean | undefined {
    return readToolSupport()[encodedModel];
}

export function rememberToolSupport(encodedModel: string, supported: boolean) {
    try {
        localStorage.setItem(TOOLS_KEY, JSON.stringify({ ...readToolSupport(), [encodedModel]: supported }));
    } catch {
        /* 忽略存储失败 */
    }
}

/** 网关明确表示该模型没开 function calling。 */
export function isFunctionCallingUnsupported(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /function calling is not enabled|does not support (function|tool)|tools? (are )?not (supported|enabled)|不支持(工具|函数)调用/i.test(message);
}
