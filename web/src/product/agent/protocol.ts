import { isFunctionCallingUnsupported, isToolsModel, preferredAgentProtocol, rememberToolSupport } from "@/product/vpapi/model-endpoints";

import type { ToolSchema } from "./tools";

/** 中立的会话消息：两种协议各自的线格式由这里转换。 */
export type TurnMessage =
    | { role: "user"; text: string }
    | { role: "assistant"; text: string; toolCalls?: AgentToolCall[] }
    | { role: "tool"; callId: string; name: string; output: string };

export type AgentToolCall = { id: string; name: string; arguments: string };

export type AgentTurnResult = { text: string; reasoning: string; toolCalls: AgentToolCall[]; degradedTools?: boolean };

export type AgentStreamHandlers = { onText?: (delta: string) => void; onReasoning?: (delta: string) => void };

export type AgentRequest = {
    baseUrl: string;
    apiKey: string;
    model: string;
    /** 画布内部编码的模型标识（`渠道id::模型名`），用于查端点能力与工具支持。 */
    modelKey: string;
    instructions: string;
    messages: TurnMessage[];
    tools: ToolSchema[];
    signal: AbortSignal;
    onText?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
};

/** 网关侧错误：保留状态码与响应体，便于判断是否需要换协议或给出可读提示。 */
export class AgentHttpError extends Error {
    constructor(
        readonly status: number,
        readonly body: string,
    ) {
        super(body || `HTTP ${status}`);
    }
}

const PROTOCOL_CACHE_KEY = "vpapi-canvas:agent-protocol";

/** 用哪种协议：网关公布的端点能力优先，其次用运行时记住的偏好（默认 chat）。 */
export function agentProtocolFor(model: string): "chat" | "responses" {
    const preferred = preferredAgentProtocol(model);
    if (preferred) return preferred;
    try {
        const cache = JSON.parse(localStorage.getItem(PROTOCOL_CACHE_KEY) || "{}") as Record<string, string>;
        return cache[model] === "responses" ? "responses" : "chat";
    } catch {
        return "chat";
    }
}

function rememberProtocol(model: string, protocol: "chat" | "responses") {
    try {
        const cache = JSON.parse(localStorage.getItem(PROTOCOL_CACHE_KEY) || "{}") as Record<string, string>;
        localStorage.setItem(PROTOCOL_CACHE_KEY, JSON.stringify({ ...cache, [model]: protocol }));
    } catch {
        /* 忽略存储失败 */
    }
}

/** 该模型是不是只支持 Responses（例如 vpapi 的 Codex 渠道）。 */
export function isResponsesOnlyError(error: unknown) {
    if (!(error instanceof AgentHttpError)) return false;
    if (![400, 404, 405, 415, 500, 501].includes(error.status)) return false;
    return /responses|not support|unsupported|invalid[\s_]*endpoint|codex|only support/i.test(error.body);
}

/** 按协议发起一轮流式请求，返回文本、推理摘要与工具调用。 */
export async function streamAgentTurn(request: AgentRequest, protocol: "chat" | "responses"): Promise<AgentTurnResult> {
    return protocol === "responses" ? streamResponsesTurn(request) : streamChatTurn(request);
}

export async function runAgentTurnWithFallback(request: AgentRequest): Promise<AgentTurnResult> {
    const protocol = agentProtocolFor(request.modelKey);
    if (protocol === "responses") return streamWithToolsFallback(request, "responses");
    try {
        return await streamWithToolsFallback(request, "chat");
    } catch (error) {
        if (!isResponsesOnlyError(error)) throw error;
        rememberProtocol(request.modelKey, "responses");
        return streamWithToolsFallback(request, "responses");
    }
}

/** 模型没开 function calling（或带工具的请求被上游拒绝）时退化为纯对话，让助手仍能回答问题、写提示词。 */
async function streamWithToolsFallback(request: AgentRequest, protocol: "chat" | "responses"): Promise<AgentTurnResult> {
    const chatOnly = async (degraded: boolean): Promise<AgentTurnResult> => {
        const result = await streamAgentTurn({ ...request, tools: [], instructions: chatOnlyInstructions(request.instructions) }, protocol);
        return degraded ? { ...result, degradedTools: true } : result;
    };
    const tools = isToolsModel(request.modelKey) === false ? [] : request.tools;
    if (!tools.length) return chatOnly(request.tools.length > 0);

    for (let attempt = 0; attempt < TOOL_ATTEMPT_LIMIT; attempt += 1) {
        try {
            const result = await streamAgentTurn({ ...request, tools }, protocol);
            rememberToolSupport(request.modelKey, true);
            return result;
        } catch (error) {
            // 上游偶尔会因为 tools 报 invalid argument，重试一次通常就好了。
            if (attempt < TOOL_ATTEMPT_LIMIT - 1 && isProviderFlake(error)) {
                await delay(1200 * (attempt + 1), request.signal);
                continue;
            }
            if (isFunctionCallingUnsupported(error)) rememberToolSupport(request.modelKey, false);
            if (!isFunctionCallingUnsupported(error) && !isProviderFlake(error)) throw error;
            return chatOnly(true);
        }
    }
    return chatOnly(true);
}

const TOOL_ATTEMPT_LIMIT = 3;

function delay(ms: number, signal: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

/** 上游/provider 抖动：不是鉴权或额度问题，重试或降级都能救回来。 */
function isProviderFlake(error: unknown) {
    if (error instanceof AgentHttpError) {
        const body = error.body || "";
        if (/ERR_PROVIDER|invalid argument|upstream|上游|请稍后重试|temporarily|server_error|internal error/i.test(body)) return true;
        return error.status >= 500 || error.status === 408 || error.status === 429;
    }
    return false;
}

function chatOnlyInstructions(instructions: string) {
    return `${instructions}\n\n当前模型不支持工具调用：不要尝试操作画布，只给出文字建议、提示词或方案。`;
}

function apiUrl(baseUrl: string, path: string) {
    const normalized = baseUrl.trim().replace(/\/+$/, "");
    const base = normalized.toLowerCase().endsWith("/v1") ? normalized : `${normalized}/v1`;
    return `${base}${path}`;
}

async function postStream(url: string, apiKey: string, body: unknown, signal: AbortSignal) {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        signal,
    });
    if (!response.ok) throw new AgentHttpError(response.status, await safeText(response));
    if (!response.body) throw new AgentHttpError(response.status, "empty response body");
    return response.body;
}

async function safeText(response: Response) {
    try {
        return await response.text();
    } catch {
        return "";
    }
}

/** 逐行解析 SSE，把 data: 负载交给回调。 */
async function readSse(body: ReadableStream<Uint8Array>, onEvent: (payload: string, event: string) => void) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
            if (line.startsWith("event:")) {
                event = line.slice(6).trim();
                continue;
            }
            if (!line.startsWith("data:")) {
                if (!line.trim()) event = "";
                continue;
            }
            const payload = line.slice(5).trim();
            if (payload) onEvent(payload, event);
            event = "";
        }
    }
    if (buffer.trim()) {
        const payload = buffer.replace(/^data:\s*/, "").trim();
        if (payload && payload !== "[DONE]") onEvent(payload, event);
    }
}

/** OpenAI Chat Completions：delta.content + delta.tool_calls。 */
async function streamChatTurn(request: AgentRequest): Promise<AgentTurnResult> {
    const body = {
        model: request.model,
        stream: true,
        stream_options: { include_usage: false },
        messages: [{ role: "system", content: request.instructions }, ...toChatMessages(request.messages)],
        tools: request.tools,
        tool_choice: "auto",
    };
    const stream = await postStream(apiUrl(request.baseUrl, "/chat/completions"), request.apiKey, body, request.signal);
    const result: AgentTurnResult = { text: "", reasoning: "", toolCalls: [] };
    const partial = new Map<number, AgentToolCall>();
    await readSse(stream, (payload) => {
        if (payload === "[DONE]") return;
        let chunk: { choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> } }>; error?: { message?: string } };
        try {
            chunk = JSON.parse(payload);
        } catch {
            return;
        }
        if (chunk.error?.message) throw new AgentHttpError(200, chunk.error.message);
        const delta = chunk.choices?.[0]?.delta;
        if (!delta) return;
        const text = typeof delta.content === "string" ? delta.content : "";
        if (text) {
            result.text += text;
            request.onText?.(text);
        }
        const reasoning = typeof delta.reasoning_content === "string" ? delta.reasoning_content : typeof delta.reasoning === "string" ? delta.reasoning : "";
        if (reasoning) {
            result.reasoning += reasoning;
            request.onReasoning?.(reasoning);
        }
        (delta.tool_calls || []).forEach((call, index) => {
            const key = typeof call.index === "number" ? call.index : index;
            const current = partial.get(key) || { id: "", name: "", arguments: "" };
            partial.set(key, {
                id: call.id || current.id || `call_${key}`,
                name: call.function?.name || current.name,
                arguments: current.arguments + (call.function?.arguments || ""),
            });
        });
    });
    result.toolCalls = [...partial.entries()].sort(([a], [b]) => a - b).map(([, call]) => call).filter((call) => call.name);
    return result;
}

function toChatMessages(messages: TurnMessage[]) {
    return messages.map((message) => {
        if (message.role === "user") return { role: "user", content: message.text };
        if (message.role === "tool") return { role: "tool", tool_call_id: message.callId, content: message.output };
        return {
            role: "assistant",
            content: message.text || null,
            ...(message.toolCalls?.length
                ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })) }
                : {}),
        };
    });
}

/** OpenAI Responses：output_text.delta / function_call_arguments.delta。 */
async function streamResponsesTurn(request: AgentRequest): Promise<AgentTurnResult> {
    const body = {
        model: request.model,
        stream: true,
        store: false,
        instructions: request.instructions,
        input: toResponsesInput(request.messages),
        tools: request.tools.map((tool) => ({ type: "function", name: tool.function.name, description: tool.function.description, parameters: tool.function.parameters, strict: false })),
        tool_choice: "auto",
    };
    const stream = await postStream(apiUrl(request.baseUrl, "/responses"), request.apiKey, body, request.signal);
    const result: AgentTurnResult = { text: "", reasoning: "", toolCalls: [] };
    const calls = new Map<string, AgentToolCall>();
    await readSse(stream, (payload, event) => {
        if (payload === "[DONE]") return;
        let data: Record<string, unknown>;
        try {
            data = JSON.parse(payload) as Record<string, unknown>;
        } catch {
            return;
        }
        const type = String(data.type || event || "");
        const delta = typeof data.delta === "string" ? data.delta : "";
        if (type === "response.output_text.delta" && delta) {
            result.text += delta;
            request.onText?.(delta);
            return;
        }
        if ((type === "response.reasoning_summary_text.delta" || type === "response.reasoning_text.delta") && delta) {
            result.reasoning += delta;
            request.onReasoning?.(delta);
            return;
        }
        if (type === "response.output_item.added") {
            const item = data.item as { type?: string; id?: string; call_id?: string; name?: string; arguments?: string } | undefined;
            if (item?.type === "function_call") {
                const id = item.call_id || item.id || `call_${calls.size}`;
                calls.set(id, { id, name: item.name || "", arguments: item.arguments || "" });
            }
            return;
        }
        if (type === "response.function_call_arguments.delta") {
            const id = String(data.item_id || "");
            const call = calls.get(id);
            if (call && delta) call.arguments += delta;
            return;
        }
        if (type === "response.function_call_arguments.done") {
            const id = String(data.item_id || "");
            const call = calls.get(id);
            if (call && typeof data.arguments === "string" && !call.arguments) call.arguments = data.arguments;
            return;
        }
        if (type === "response.completed") {
            const response = data.response as { output?: Array<{ type?: string; call_id?: string; id?: string; name?: string; arguments?: string }> } | undefined;
            (response?.output || []).forEach((item) => {
                if (item.type !== "function_call" || !item.name) return;
                const id = item.call_id || item.id || "";
                if (id && !calls.has(id)) calls.set(id, { id, name: item.name, arguments: item.arguments || "{}" });
            });
            return;
        }
        if (type === "response.failed" || type === "error") {
            const error = (data.error || (data.response as { error?: unknown } | undefined)?.error) as { message?: string } | undefined;
            throw new AgentHttpError(200, error?.message || "response failed");
        }
    });
    result.toolCalls = [...calls.values()].filter((call) => call.name);
    return result;
}

function toResponsesInput(messages: TurnMessage[]) {
    return messages.flatMap((message) => {
        if (message.role === "user") return [{ role: "user", content: [{ type: "input_text", text: message.text }] }];
        if (message.role === "tool") return [{ type: "function_call_output", call_id: message.callId, output: message.output }];
        const items: Array<Record<string, unknown>> = [];
        if (message.text) items.push({ role: "assistant", content: [{ type: "output_text", text: message.text }] });
        (message.toolCalls || []).forEach((call) => items.push({ type: "function_call", call_id: call.id, name: call.name, arguments: call.arguments || "{}" }));
        return items;
    });
}
