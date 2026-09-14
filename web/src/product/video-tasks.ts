import localforage from "localforage";

import "@/lib/localforage-storage";

/**
 * 未完成的画布视频任务：生成开始时记下来，页面刷新（或崩溃）后据此继续查询结果，
 * 避免「实际还在渲染、画布却显示失败」。
 */
const STORAGE_KEY = "vpapi-canvas:pending-video-tasks";

export type PendingVideoTask = {
    id: string;
    projectId: string;
    nodeId: string;
    provider: "openai" | "plugin";
    taskId: string;
    model: string;
    createdAt: number;
};

async function read(): Promise<PendingVideoTask[]> {
    try {
        const items = await localforage.getItem<PendingVideoTask[]>(STORAGE_KEY);
        return Array.isArray(items) ? items : [];
    } catch {
        return [];
    }
}

async function write(items: PendingVideoTask[]) {
    try {
        await localforage.setItem(STORAGE_KEY, items);
    } catch {
        /* 忽略存储失败：只影响刷新后的恢复 */
    }
}

export async function rememberVideoTask(task: PendingVideoTask) {
    const items = await read();
    await write([...items.filter((item) => item.id !== task.id && item.taskId !== task.taskId), task]);
}

export async function listVideoTasks() {
    return read();
}

export async function forgetVideoTask(id: string) {
    const items = await read();
    await write(items.filter((item) => item.id !== id));
}
