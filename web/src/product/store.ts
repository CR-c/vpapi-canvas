import { create } from "zustand";
import { persist } from "zustand/middleware";

type ProductStore = {
    /** 接入引导（首启 / 未接入时自动打开）。 */
    connectOpen: boolean;
    openConnect: () => void;
    closeConnect: () => void;
    /** true = 沿用上游的本地 CLI Agent；false = 内置浏览器助手。 */
    useLocalAgent: boolean;
    setUseLocalAgent: (value: boolean) => void;
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
        }),
        {
            name: PRODUCT_STORE_KEY,
            partialize: (state) => ({ useLocalAgent: state.useLocalAgent }),
        },
    ),
);
