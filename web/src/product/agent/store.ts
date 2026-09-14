import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import type { NavigateFunction } from "react-router-dom";

import i18n from "@/i18n";
import { localForageStorage } from "@/lib/localforage-storage";
import { modelOptionLabel, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, useConfigStore } from "@/stores/use-config-store";
import { useAgentStore, type AgentChatItem, type AgentPendingToolCall } from "@/stores/use-agent-store";

import { PRODUCT_AGENT_PROMPT } from "./prompt";
import { runAgentTurnWithFallback, type AgentToolCall, type TurnMessage } from "./protocol";
import { isProductTool, productToolSchemas, runProductTool, WRITE_TOOLS } from "./tools";
import { isChatModel, isToolsModel, readModelEndpoints } from "@/product/vpapi/model-endpoints";

const MAX_STEPS = 8;
const MAX_TOOL_OUTPUT = 8000;

export type ProductAgentThread = { id: string; title: string; messages: TurnMessage[]; createdAt: number; updatedAt: number };

type ProductAgentStore = {
    threads: ProductAgentThread[];
    activeThreadId: string;
    model: string;
    confirmTools: boolean;
    running: boolean;
    error: string;
    pendingTool: AgentPendingToolCall | null;
    hydrated: boolean;
    setModel: (model: string) => void;
    setConfirmTools: (confirmTools: boolean) => void;
    newThread: () => void;
    selectThread: (id: string) => void;
    removeThread: (id: string) => void;
    send: (text: string, navigate: NavigateFunction) => Promise<void>;
    stop: () => void;
    resolvePendingTool: (approved: boolean) => void;
};

let controller: AbortController | null = null;
let pendingDecision: ((approved: boolean) => void) | null = null;
let displayItems: AgentChatItem[] = [];

export const useProductAgentStore = create<ProductAgentStore>()(
    persist(
        (set, get) => ({
            threads: [],
            activeThreadId: "",
            model: "",
            confirmTools: true,
            running: false,
            error: "",
            pendingTool: null,
            hydrated: false,
            setModel: (model) => set({ model }),
            setConfirmTools: (confirmTools) => set({ confirmTools }),
            newThread: () => {
                const thread: ProductAgentThread = { id: nanoid(), title: "", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
                resetDisplay([]);
                set({ threads: [thread, ...get().threads], activeThreadId: thread.id, error: "" });
            },
            selectThread: (id) => {
                const thread = get().threads.find((item) => item.id === id);
                if (!thread) return;
                resetDisplay(toDisplayItems(thread));
                set({ activeThreadId: id, error: "" });
            },
            removeThread: (id) => {
                const threads = get().threads.filter((thread) => thread.id !== id);
                const activeThreadId = get().activeThreadId === id ? threads[0]?.id || "" : get().activeThreadId;
                resetDisplay(toDisplayItems(threads.find((thread) => thread.id === activeThreadId)));
                set({ threads, activeThreadId });
            },
            send: async (text, navigate) => {
                const prompt = text.trim();
                if (!prompt || get().running) return;
                const request = resolveRequest(get().model);
                if (!request) {
                    set({ error: i18n.t("product.agent.modelRequired") });
                    return;
                }
                const thread = ensureThread(get, set);
                thread.messages.push({ role: "user", text: prompt });
                thread.updatedAt = Date.now();
                if (!thread.title) thread.title = prompt.slice(0, 40);
                pushDisplay({ id: nanoid(), role: "user", text: prompt });
                const local = new AbortController();
                controller = local;
                set({ running: true, error: "" });
                try {
                    await runLoop({ thread, request, navigate, signal: local.signal });
                } catch (error) {
                    if (!local.signal.aborted) {
                        const message = error instanceof Error ? error.message : String(error);
                        set({ error: message });
                        pushDisplay({ id: nanoid(), role: "error", text: i18n.t("product.agent.requestFailed", { error: message }) });
                    }
                } finally {
                    controller = null;
                    pendingDecision = null;
                    set({ running: false, pendingTool: null });
                    useAgentStore.getState().setAgentState({ pendingTool: null });
                }
            },
            stop: () => {
                controller?.abort();
                pendingDecision?.(false);
                pendingDecision = null;
                set({ running: false, pendingTool: null });
                useAgentStore.getState().setAgentState({ pendingTool: null });
            },
            resolvePendingTool: (approved) => {
                pendingDecision?.(approved);
                pendingDecision = null;
                set({ pendingTool: null });
                useAgentStore.getState().setAgentState({ pendingTool: null });
            },
        }),
        {
            name: "vpapi-canvas:agent",
            storage: createJSONStorage(() => localForageStorage),
            partialize: (state) => ({ threads: state.threads, activeThreadId: state.activeThreadId, model: state.model, confirmTools: state.confirmTools }),
            onRehydrateStorage: () => (state) => {
                if (!state) return;
                const thread = state.threads.find((item) => item.id === state.activeThreadId) || state.threads[0];
                resetDisplay(toDisplayItems(thread));
                useProductAgentStore.setState({ hydrated: true, activeThreadId: thread?.id || state.activeThreadId, running: false });
            },
        },
    ),
);

/** 助手可用的模型：优先取支持对话端点的模型（含被判为图片/视频但同样支持 chat 的模型），支持工具调用的排在前面。 */
export function productAgentModels() {
    const { config } = useConfigStore.getState();
    const map = readModelEndpoints();
    const chatModels = selectableModelsByCapability(config).filter((value) => isChatModel(value, map));
    const values = chatModels.length ? chatModels : selectableModelsByCapability(config, "text");
    const rank = (value: string) => {
        const support = isToolsModel(value);
        return support === true ? 0 : support === undefined ? 1 : 2;
    };
    return [...values].sort((a, b) => rank(a) - rank(b)).map((value) => ({ value, label: modelOptionLabel(config, value) }));
}

async function runLoop({ thread, request, navigate, signal }: { thread: ProductAgentThread; request: { baseUrl: string; apiKey: string; model: string; modelKey: string }; navigate: NavigateFunction; signal: AbortSignal }) {
    for (let step = 0; step < MAX_STEPS; step += 1) {
        const itemId = nanoid();
        let text = "";
        let reasoning = "";
        pushDisplay({ id: itemId, role: "assistant", text: "", streamId: itemId });
        const result = await runAgentTurnWithFallback({
            baseUrl: request.baseUrl,
            apiKey: request.apiKey,
            model: request.model,
            modelKey: request.modelKey,
            instructions: PRODUCT_AGENT_PROMPT,
            messages: thread.messages,
            tools: productToolSchemas(),
            signal,
            onText: (delta) => {
                text += delta;
                patchDisplay(itemId, { text });
            },
            onReasoning: (delta) => {
                reasoning += delta;
                patchDisplay(itemId, { detail: { kind: "reasoning", text: reasoning } });
            },
        });
        patchDisplay(itemId, { text: result.text || text, streamId: undefined });
        if (!(result.text || text).trim()) removeDisplay(itemId);
        if (result.degradedTools) pushDisplay({ id: nanoid(), role: "system", text: i18n.t("product.agent.degraded") });
        thread.messages.push({ role: "assistant", text: result.text, ...(result.toolCalls.length ? { toolCalls: result.toolCalls } : {}) });
        syncDisplay();
        if (!result.toolCalls.length) {
            thread.updatedAt = Date.now();
            return;
        }
        for (const call of result.toolCalls) {
            const output = await executeTool(call, navigate, signal);
            thread.messages.push({ role: "tool", callId: call.id, name: call.name, output: truncate(output) });
            thread.updatedAt = Date.now();
        }
    }
    pushDisplay({ id: nanoid(), role: "error", text: i18n.t("product.agent.stepLimit") });
}

async function executeTool(call: AgentToolCall, navigate: NavigateFunction, signal: AbortSignal) {
    const args = parseArgs(call.arguments);
    const itemId = nanoid();
    if (signal.aborted) return JSON.stringify({ aborted: true });
    if (!isProductTool(call.name)) {
        pushDisplay({ id: itemId, role: "tool", title: call.name, text: summarizeArgs(args), detail: { kind: "tool", status: "failed", input: args, output: i18n.t("product.agent.unknownTool", { name: call.name }) } });
        return JSON.stringify({ error: `unknown tool: ${call.name}` });
    }
    const store = useProductAgentStore.getState();
    if (store.confirmTools && WRITE_TOOLS.has(call.name)) {
        const pending = { requestId: call.id, name: call.name, input: args };
        useProductAgentStore.setState({ pendingTool: pending });
        const approved = await new Promise<boolean>((resolve) => {
            pendingDecision = resolve;
        });
        if (!approved) {
            pushDisplay({ id: itemId, role: "tool", title: call.name, text: summarizeArgs(args), detail: { kind: "tool", status: "skipped", input: args, output: i18n.t("product.agent.denied") } });
            return JSON.stringify({ skipped: true, reason: "user declined" });
        }
    }
    pushDisplay({ id: itemId, role: "tool", title: call.name, text: summarizeArgs(args), detail: { kind: "tool", status: "running", input: args } });
    try {
        const result = await runProductTool(call.name, args, { navigate, canvas: useAgentStore.getState().canvasContext });
        const output = JSON.stringify(result);
        patchDisplay(itemId, { detail: { kind: "tool", status: "done", input: args, output: truncate(output, 2000) } });
        return output;
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        patchDisplay(itemId, { detail: { kind: "tool", status: "failed", input: args, output: message } });
        return JSON.stringify({ error: message });
    }
}

function resolveRequest(selected: string) {
    const { config } = useConfigStore.getState();
    const fallback = productAgentModels()[0]?.value || "";
    const modelKey = selected || config.textModel || fallback;
    const requestConfig = resolveModelRequestConfig(config, modelKey);
    if (!requestConfig.model || !requestConfig.apiKey.trim()) return null;
    return { baseUrl: requestConfig.baseUrl, apiKey: requestConfig.apiKey, model: requestConfig.model, modelKey };
}

function ensureThread(get: () => ProductAgentStore, set: (patch: Partial<ProductAgentStore>) => void) {
    const current = get().threads.find((thread) => thread.id === get().activeThreadId);
    if (current) return current;
    const thread: ProductAgentThread = { id: nanoid(), title: "", messages: [], createdAt: Date.now(), updatedAt: Date.now() };
    resetDisplay([]);
    set({ threads: [thread, ...get().threads], activeThreadId: thread.id });
    return thread;
}

function pushDisplay(item: AgentChatItem) {
    displayItems = [...displayItems, item];
    syncDisplay();
}

/** 消息对象必须整体替换：上游消息组件是 memo 的，原地修改不会触发重渲染。 */
function patchDisplay(id: string, patch: Partial<AgentChatItem>) {
    displayItems = displayItems.map((item) => (item.id === id ? { ...item, ...patch } : item));
    syncDisplay();
}

function removeDisplay(id: string) {
    displayItems = displayItems.filter((item) => item.id !== id);
    syncDisplay();
}

function syncDisplay() {
    useAgentStore.getState().setAgentState({ messages: [...displayItems] });
}

function resetDisplay(items: AgentChatItem[]) {
    displayItems = [...items];
    syncDisplay();
}

function toDisplayItems(thread?: ProductAgentThread) {
    if (!thread) return [];
    const outputs = new Map<string, string>();
    thread.messages.forEach((message) => {
        if (message.role === "tool") outputs.set(message.callId, message.output);
    });
    const items: AgentChatItem[] = [];
    thread.messages.forEach((message, index) => {
        if (message.role === "user") {
            items.push({ id: `u-${index}`, role: "user", text: message.text });
            return;
        }
        if (message.role !== "assistant") return;
        if (message.text) items.push({ id: `a-${index}`, role: "assistant", text: message.text });
        (message.toolCalls || []).forEach((call, callIndex) => {
            const args = parseArgs(call.arguments);
            items.push({ id: `t-${index}-${callIndex}`, role: "tool", title: call.name, text: summarizeArgs(args), detail: { kind: "tool", status: "done", input: args, output: truncate(outputs.get(call.id) || "", 2000) } });
        });
    });
    return items;
}

function parseArgs(value: string) {
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

function summarizeArgs(args: Record<string, unknown>) {
    for (const key of ["summary", "prompt", "path", "keyword", "title", "kind"]) {
        const value = args[key];
        if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
    }
    const keys = Object.keys(args);
    return keys.length ? keys.join(", ") : "";
}

function truncate(value: string, max = MAX_TOOL_OUTPUT) {
    return value.length > max ? `${value.slice(0, max)}…` : value;
}
