import { useEffect, useRef } from "react";

import i18n from "@/i18n";
import { videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { fitNodeSize } from "@/lib/canvas/canvas-node-size";
import { storeGeneratedVideo, pollVideoGenerationTask, VIDEO_TASK_HARD_TIMEOUT_MS, VIDEO_TASK_SLOW_POLL_INTERVAL } from "@/services/api/video";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useConfigStore } from "@/stores/use-config-store";
import type { CanvasNodeMetadata } from "@/types/canvas";

import { forgetVideoTask, listVideoTasks, type PendingVideoTask } from "./video-tasks";

const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;

/**
 * 页面刷新后继续查询未完成的视频任务：
 * 原来任务只在内存里轮询，刷新后节点会被上游标成「生成中断」，
 * 但网关可能再过十几分钟才出片。这里按持久化的任务记录接着查，完成后回填原节点。
 */
export function useVideoTaskResume() {
    useEffect(() => {
        let finished = false;
        const attempt = () => {
            if (finished) return;
            // 画布数据在 localforage 里异步加载，列表为空说明还没就绪。
            if (!useCanvasStore.getState().projects.length) return;
            finished = true;
            void resumePendingVideoTasks().catch((error) => {
                console.warn("[vpapi-canvas] 恢复视频任务失败", error);
            });
        };
        attempt();
        const unsubscribe = useCanvasStore.subscribe(attempt);
        // 兜底：项目列表为空（例如只剩待恢复任务）时也尝试一次。
        const timer = setTimeout(() => {
            if (finished) return;
            finished = true;
            void resumePendingVideoTasks().catch((error) => {
                console.warn("[vpapi-canvas] 恢复视频任务失败", error);
            });
        }, 10000);
        return () => {
            unsubscribe();
            clearTimeout(timer);
        };
    }, []);
    return null;
}

async function resumePendingVideoTasks() {
    const tasks = await listVideoTasks();
    if (!tasks.length) return;
    for (const task of tasks) void resumeVideoTask(task);
}

function updateNode(task: PendingVideoTask, patch: CanvasNodeMetadata) {
    const store = useCanvasStore.getState();
    const project = store.projects.find((item) => item.id === task.projectId);
    if (!project) return;
    store.updateProject(task.projectId, {
        nodes: project.nodes.map((node) => (node.id === task.nodeId ? { ...node, metadata: { ...node.metadata, ...patch } } : node)),
    });
}

async function resizeNode(task: PendingVideoTask, video: { width?: number; height?: number }) {
    const store = useCanvasStore.getState();
    const project = store.projects.find((item) => item.id === task.projectId);
    const node = project?.nodes.find((item) => item.id === task.nodeId);
    if (!project || !node || !video.width || !video.height) return;
    // 与画布节点创建时一致（project.tsx 的 VIDEO_NODE_MAX_*）
    const size = fitNodeSize(video.width, video.height, 420, 420);
    store.updateProject(task.projectId, {
        nodes: project.nodes.map((item) =>
            item.id === task.nodeId
                ? {
                      ...item,
                      width: size.width,
                      height: size.height,
                      position: { x: item.position.x + item.width / 2 - size.width / 2, y: item.position.y + item.height / 2 - size.height / 2 },
                  }
                : item,
        ),
    });
}

async function resumeVideoTask(task: PendingVideoTask) {
    const store = useCanvasStore.getState();
    const project = store.projects.find((item) => item.id === task.projectId);
    if (!project || !project.nodes.some((node) => node.id === task.nodeId)) {
        await forgetVideoTask(task.id);
        return;
    }
    if (task.provider !== "openai") {
        updateNode(task, { status: NODE_STATUS_ERROR, errorDetails: i18n.t("product.videoResume.unsupported") });
        await forgetVideoTask(task.id);
        return;
    }
    updateNode(task, { status: NODE_STATUS_LOADING, errorDetails: undefined });
    const config = useConfigStore.getState().config;
    const deadline = task.createdAt + VIDEO_TASK_HARD_TIMEOUT_MS;
    let failures = 0;
    while (Date.now() < deadline) {
        let state: Awaited<ReturnType<typeof pollVideoGenerationTask>> | null = null;
        try {
            state = await pollVideoGenerationTask(config, { id: task.taskId, provider: "openai", model: task.model });
            failures = 0;
        } catch (error) {
            // 查询失败（网络抖动、Key 被换过）先重试几次；连续失败才判失败。
            failures += 1;
            if (failures >= 5) {
                updateNode(task, { status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : String(error) });
                await forgetVideoTask(task.id);
                return;
            }
        }
        if (state?.status === "completed") {
            try {
                const stored = await storeGeneratedVideo(state.result);
                updateNode(task, { ...videoMetadata(stored), status: NODE_STATUS_SUCCESS, errorDetails: undefined });
                await resizeNode(task, stored);
            } catch (error) {
                updateNode(task, { status: NODE_STATUS_ERROR, errorDetails: error instanceof Error ? error.message : String(error) });
            }
            await forgetVideoTask(task.id);
            return;
        }
        if (state?.status === "failed") {
            updateNode(task, { status: NODE_STATUS_ERROR, errorDetails: state.error });
            await forgetVideoTask(task.id);
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, VIDEO_TASK_SLOW_POLL_INTERVAL));
    }
    updateNode(task, { status: NODE_STATUS_ERROR, errorDetails: i18n.t("apiErrors.videoTimeout", { provider: "" }) });
    await forgetVideoTask(task.id);
}
