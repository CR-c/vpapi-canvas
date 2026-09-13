import { create } from "zustand";

import { useConfigStore } from "@/stores/use-config-store";

import { fetchGatewayQuota } from "./client";

/** 同一把 Key 的额度在短时间内不重复请求（生成批量提交时尤其明显）。 */
const REFRESH_INTERVAL_MS = 15000;

type QuotaState = {
    status: "idle" | "loading" | "ready" | "error";
    total: number;
    used: number;
    remaining: number;
    unlimited: boolean;
    expiresAt: number;
    symbol: string;
    updatedAt: number;
    error: string;
    /** 拉取当前 Key 的额度；`force` 用于用户手动刷新。 */
    refresh: (force?: boolean) => Promise<void>;
    /** 生成完成后触发，避免每次生成都打接口。 */
    touch: () => void;
};

export const useQuotaStore = create<QuotaState>()((set, get) => ({
    status: "idle",
    total: 0,
    used: 0,
    remaining: 0,
    unlimited: false,
    expiresAt: 0,
    symbol: "",
    updatedAt: 0,
    error: "",
    refresh: async (force = false) => {
        const { config } = useConfigStore.getState();
        if (!config.apiKey.trim()) {
            set({ status: "idle", error: "" });
            return;
        }
        if (get().status === "loading") return;
        if (!force && Date.now() - get().updatedAt < REFRESH_INTERVAL_MS) return;
        set({ status: "loading" });
        try {
            const quota = await fetchGatewayQuota(config);
            set({ ...quota, status: "ready", updatedAt: Date.now(), error: "" });
        } catch (error) {
            set({ status: "error", error: error instanceof Error ? error.message : String(error) });
        }
    },
    touch: () => {
        if (!get().updatedAt) return;
        void get().refresh(true);
    },
}));
