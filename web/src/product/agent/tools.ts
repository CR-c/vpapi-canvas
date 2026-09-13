import type { NavigateFunction } from "react-router-dom";
import { nanoid } from "nanoid";

import i18n from "@/i18n";
import { summarizeCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { isSiteTool, SITE_TOOL_NAMES, runSiteTool } from "@/lib/agent/agent-site-tools";
import { useConfigStore } from "@/stores/use-config-store";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";
import type { AgentCanvasContext } from "@/stores/use-agent-store";

/** 需要用户确认才会执行的写操作（生成会消耗额度）。 */
export const WRITE_TOOLS = new Set(["canvas_apply_ops", "canvas_generate_image", "canvas_generate_video", "workbench_image_generate", "workbench_video_generate"]);

export type ProductToolName = "canvas_get_state" | "canvas_apply_ops" | "canvas_generate_image" | "canvas_generate_video" | "site_navigate" | (typeof SITE_TOOL_NAMES)[number];

export type ToolSchema = { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };

const CAPABILITY_ENUM = ["image", "video", "text", "audio"];

const OP_SCHEMA = {
    type: "object",
    properties: {
        type: { type: "string", enum: ["add_node", "update_node", "delete_node", "delete_connections", "connect_nodes", "set_viewport", "select_nodes", "run_generation"] },
        id: { type: "string" },
        ids: { type: "array", items: { type: "string" } },
        nodeType: { type: "string" },
        title: { type: "string" },
        x: { type: "number" },
        y: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
        metadata: { type: "object" },
        patch: { type: "object" },
        fromNodeId: { type: "string" },
        toNodeId: { type: "string" },
        viewport: { type: "object" },
        nodeId: { type: "string" },
        mode: { type: "string", enum: CAPABILITY_ENUM },
        prompt: { type: "string" },
    },
    required: ["type"],
};

/** 暴露给模型的工具（画布操作 + 站点工具），与 JSON Schema 一一对应。 */
export function productToolSchemas(): ToolSchema[] {
    const tools: ToolSchema[] = [
        {
            type: "function",
            function: {
                name: "canvas_get_state",
                description: "读取当前画布：节点、连线、选中项与视图。任何改动前先读一次。",
                parameters: { type: "object", properties: {} },
            },
        },
        {
            type: "function",
            function: {
                name: "canvas_apply_ops",
                description: "对当前画布执行一批操作：新增/修改/删除节点、连线、断开连线、移动视图、选中节点、触发生成。",
                parameters: {
                    type: "object",
                    properties: {
                        summary: { type: "string", description: "一句话说明这批操作" },
                        ops: { type: "array", items: OP_SCHEMA },
                    },
                    required: ["ops"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "canvas_generate_image",
                description: "在当前画布上新建生成配置节点并开始生图（消耗额度）。要带参考图时把画布上已有图片节点的 id 放进 referenceNodeIds。",
                parameters: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "画面描述，尽量保留用户的原话" },
                        model: { type: "string", description: "可选，默认用画布设置的图片模型" },
                        size: { type: "string" },
                        quality: { type: "string" },
                        count: { type: "number" },
                        referenceNodeIds: { type: "array", items: { type: "string" } },
                    },
                    required: ["prompt"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "canvas_generate_video",
                description: "在当前画布上新建生成配置节点并开始生成视频（消耗额度）。要带参考图 / 参考视频时传 referenceNodeIds。",
                parameters: {
                    type: "object",
                    properties: {
                        prompt: { type: "string", description: "镜头与画面描述，尽量保留用户的原话" },
                        model: { type: "string", description: "可选，默认用画布设置的视频模型" },
                        size: { type: "string" },
                        seconds: { type: "string" },
                        resolution: { type: "string" },
                        referenceNodeIds: { type: "array", items: { type: "string" } },
                    },
                    required: ["prompt"],
                },
            },
        },
        {
            type: "function",
            function: {
                name: "site_navigate",
                description: "切换页面，例如 /canvas、/image、/video、/assets、/prompts。",
                parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
            },
        },
        siteTool("canvas_list_projects", "列出本地的画布项目。", { keyword: { type: "string" }, page: { type: "number" }, pageSize: { type: "number" } }),
        siteTool("generation_get_status", "查询生成任务状态（画布节点与创作台）。", {
            scope: { type: "string", enum: ["all", "canvas", "image", "video"] },
            taskId: { type: "string" },
            nodeIds: { type: "array", items: { type: "string" } },
            limit: { type: "number" },
        }),
        siteTool("workbench_image_generate", "在图片创作台设置参数并开始生图（会消耗额度）。", {
            prompt: { type: "string" },
            model: { type: "string" },
            size: { type: "string" },
            quality: { type: "string" },
            count: { type: "number" },
            run: { type: "boolean", description: "false 表示只改参数不生成" },
        }),
        siteTool("workbench_video_generate", "在视频创作台设置参数并开始生成视频（会消耗额度）。", {
            prompt: { type: "string" },
            model: { type: "string" },
            size: { type: "string" },
            seconds: { type: "string" },
            resolution: { type: "string" },
            generateAudio: { type: "boolean" },
            watermark: { type: "boolean" },
            run: { type: "boolean", description: "false 表示只改参数不生成" },
        }),
        siteTool("prompts_search", "搜索提示词中心。", { keyword: { type: "string" }, category: { type: "string" }, tags: { type: "array", items: { type: "string" } }, page: { type: "number" }, pageSize: { type: "number" } }),
        siteTool("assets_list", "列出我的素材。", { kind: { type: "string", enum: ["all", "text", "image", "video"] }, keyword: { type: "string" }, page: { type: "number" }, pageSize: { type: "number" } }),
        siteTool("assets_add", "把文本或图片保存到我的素材。", {
            kind: { type: "string", enum: ["text", "image"] },
            title: { type: "string" },
            content: { type: "string", description: "kind=text 时的正文" },
            imageUrl: { type: "string", description: "kind=image 时的图片地址" },
            tags: { type: "array", items: { type: "string" } },
            note: { type: "string" },
        }),
    ];
    return tools;
}

function siteTool(name: (typeof SITE_TOOL_NAMES)[number], description: string, properties: Record<string, unknown>): ToolSchema {
    return { type: "function", function: { name, description, parameters: { type: "object", properties } } };
}

export function isProductTool(name: string): name is ProductToolName {
    return name === "canvas_get_state" || name === "canvas_apply_ops" || name === "canvas_generate_image" || name === "canvas_generate_video" || name === "site_navigate" || isSiteTool(name);
}

export type ProductToolContext = {
    navigate: NavigateFunction;
    canvas: AgentCanvasContext | null;
};

/** 执行工具并把结果压成适合回填给模型的紧凑 JSON。 */
export async function runProductTool(name: string, input: Record<string, unknown>, context: ProductToolContext): Promise<unknown> {
    if (name === "canvas_get_state") return compactCanvasState(requireCanvas(context).snapshot);
    if (name === "canvas_apply_ops") {
        const canvas = requireCanvas(context);
        const ops = Array.isArray(input.ops) ? (input.ops as CanvasAgentOp[]) : [];
        if (!ops.length) return { ok: false, reason: "ops is empty" };
        const snapshot = canvas.applyOps(ops);
        return { ok: true, summary: summarizeCanvasAgentOps(ops), nodes: snapshot.nodes.length, connections: snapshot.connections.length };
    }
    if (name === "canvas_generate_image" || name === "canvas_generate_video") return runCanvasGeneration(name === "canvas_generate_image" ? "image" : "video", input, context);
    if (name === "site_navigate") {
        const path = typeof input.path === "string" ? input.path.trim() : "";
        if (!path.startsWith("/")) throw new Error(i18n.t("product.agent.requestFailed", { error: path }));
        context.navigate(path);
        return { ok: true, path };
    }
    if (isSiteTool(name)) {
        const snapshot = context.canvas?.snapshot || null;
        return runSiteTool(name, input, context.navigate, { canvasSnapshot: snapshot });
    }
    throw new Error(`unknown tool: ${name}`);
}

function requireCanvas(context: ProductToolContext): AgentCanvasContext {
    if (!context.canvas) throw new Error(i18n.t("product.agent.canvasRequired"));
    return context.canvas;
}

/** 在画布上建一个生成配置节点、接上参考节点并开始生成。 */
function runCanvasGeneration(mode: "image" | "video", input: Record<string, unknown>, context: ProductToolContext) {
    const canvas = requireCanvas(context);
    const config = useConfigStore.getState().config;
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt) throw new Error(i18n.t("product.agent.promptRequired"));
    const nodes = canvas.snapshot.nodes;
    const nodeId = `config-${nanoid()}`;
    const text = (key: string) => (typeof input[key] === "string" ? (input[key] as string).trim() : "");
    const metadata: CanvasNodeMetadata =
        mode === "image"
            ? {
                  generationMode: "image",
                  prompt,
                  composerContent: prompt,
                  model: text("model") || config.imageModel || config.model,
                  size: text("size") || config.size,
                  count: Math.max(1, Math.floor(Number(input.count) || Number(config.canvasImageCount) || 1)),
                  ...(text("quality") ? { quality: text("quality") } : {}),
              }
            : {
                  generationMode: "video",
                  prompt,
                  composerContent: prompt,
                  model: text("model") || config.videoModel || config.model,
                  size: text("size") || config.size,
                  seconds: text("seconds") || config.videoSeconds,
                  vquality: text("resolution") || config.vquality,
                  generateAudio: config.videoGenerateAudio,
                  watermark: config.videoWatermark,
              };
    const references = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string" && nodes.some((node) => node.id === id)) : [];
    const ops: CanvasAgentOp[] = [
        { type: "add_node", id: nodeId, nodeType: "config", title: prompt.slice(0, 24), position: nextNodePosition(nodes), metadata },
        ...references.map((id) => ({ type: "connect_nodes" as const, fromNodeId: id, toNodeId: nodeId })),
        { type: "run_generation", nodeId, mode, prompt },
    ];
    const snapshot = canvas.applyOps(ops);
    return { ok: true, nodeId, mode, references: references.length, nodes: snapshot.nodes.length };
}

/** 新节点放在现有节点右侧，空画布从原点开始。 */
function nextNodePosition(nodes: CanvasNodeData[]) {
    if (!nodes.length) return { x: 0, y: 0 };
    const right = Math.max(...nodes.map((node) => node.position.x + node.width));
    const top = Math.min(...nodes.map((node) => node.position.y));
    return { x: right + 120, y: top };
}

/** 画布快照的紧凑版：只保留模型决策需要的字段。 */
function compactCanvasState(snapshot: CanvasAgentSnapshot) {
    return {
        projectId: snapshot.projectId,
        title: snapshot.title,
        selectedNodeIds: snapshot.selectedNodeIds,
        viewport: snapshot.viewport,
        nodes: snapshot.nodes.map((node) => ({
            id: node.id,
            type: node.type,
            title: node.title,
            position: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
            size: { width: Math.round(node.width), height: Math.round(node.height) },
            status: node.metadata?.status,
            model: node.metadata?.model,
            prompt: truncate(node.metadata?.prompt || node.metadata?.composerContent, 200),
            hasContent: Boolean(node.metadata?.content || node.metadata?.storageKey || node.metadata?.images?.length),
        })),
        connections: snapshot.connections.map((connection) => ({ id: connection.id, from: connection.fromNodeId, to: connection.toNodeId })),
    };
}

function truncate(value: unknown, max: number) {
    const text = typeof value === "string" ? value.trim() : "";
    return text ? (text.length > max ? `${text.slice(0, max)}…` : text) : undefined;
}
