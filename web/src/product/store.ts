import { create } from "zustand";
import { persist } from "zustand/middleware";
import { nanoid } from "nanoid";

type ProductStore = {
    /** 接入引导（首启 / 未接入时自动打开）。 */
    connectOpen: boolean;
    openConnect: () => void;
    closeConnect: () => void;
    /** true = 沿用上游的本地 CLI Agent；false = 内置浏览器助手。 */
    useLocalAgent: boolean;
    setUseLocalAgent: (value: boolean) => void;
    /** 轻量提示队列（例如生成前的额度提示），由 ProductNotices 渲染。 */
    notice: { id: string; text: string } | null;
    pushNotice: (text: string) => void;
    clearNotice: () => void;
};

export const PRODUCT_STORE_KEY = "vpapi-canvas:product";

export const useProductStore = create<ProductStore>()(
    persist(
        (set) => ({
            connectOpen: false,
            openConnect: () => set({ connectOpen: true }),
            closeConnect: () => set({ connectOpen: false }),
            useLocalAgent: false,
            setUseLocalAgent: (useLocalAgent) => set({ useLocalAgent }),
            notice: null,
            pushNotice: (text) => {
                const value = text.trim();
                if (!value) return;
                // 批量生成会并发触发同一句提示，去重避免刷屏。
                const now = Date.now();
                if (value === lastNoticeText && now - lastNoticeAt < 2000) return;
                lastNoticeText = value;
                lastNoticeAt = now;
                set({ notice: { id: nanoid(), text: value } });
            },
            clearNotice: () => set({ notice: null }),
        }),
        {
            name: PRODUCT_STORE_KEY,
            partialize: (state) => ({ useLocalAgent: state.useLocalAgent }),
        },
    ),
);

let lastNoticeText = "";
let lastNoticeAt = 0;
