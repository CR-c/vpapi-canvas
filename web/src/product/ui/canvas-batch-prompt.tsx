import { useEffect, useState } from "react";
import { ArrowUp, LoaderCircle, Square } from "lucide-react";
import { Button } from "antd";
import { useTranslation } from "react-i18next";

import { ModelPicker } from "@/components/model-picker";
import { CanvasImageSettingsPopover } from "@/components/canvas/canvas-image-settings-popover";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";

/**
 * 多张图片共用一条提示词。框选两张及以上有内容的图片后浮在画布底部，
 * 点一次生成，每张图各自出一张结果。
 */
export function CanvasBatchPrompt({ count, running, onGenerate, onStop }: { count: number; running: boolean; onGenerate: (prompt: string, config: AiConfig) => void; onStop: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const [prompt, setPrompt] = useState("");
    const text = prompt.trim();

    useEffect(() => {
        const media = window.matchMedia("(max-width: 767px)");
        const release = () => {
            if (!media.matches) return;
            const store = useCanvasSidePanelStore.getState();
            if (store.panelOpen) store.closePanel();
        };
        release();
        media.addEventListener("change", release);
        return () => media.removeEventListener("change", release);
    }, []);
    // 批量固定每张图出一张，张数不写回全局配置。
    const imageConfig = { ...config, model: config.imageModel || config.model, count: "1" };

    return (
        <div
            data-canvas-no-zoom
            className="absolute bottom-[92px] left-1/2 z-[75] w-[min(640px,calc(100%-24px))] -translate-x-1/2 rounded-2xl border p-3 shadow-2xl backdrop-blur max-md:fixed max-md:bottom-3 max-md:left-3 max-md:right-3 max-md:z-[80] max-md:w-auto max-md:translate-x-0"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            <div className="mb-2 text-xs font-medium" style={{ color: theme.node.muted }}>
                {t("product.batch.title", { count })}
            </div>
            <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                        event.preventDefault();
                        if (text && !running) onGenerate(text, imageConfig);
                    }
                }}
                placeholder={t("product.batch.placeholder")}
                className="thin-scrollbar h-20 w-full resize-none rounded-xl bg-transparent px-3 py-2 text-sm leading-5 outline-none max-md:h-16"
                style={{ color: theme.node.text }}
            />
            <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <ModelPicker config={imageConfig} value={imageConfig.model} onChange={(model) => updateConfig("imageModel", model)} capability="image" onMissingConfig={() => openConfigDialog(true)} className="max-w-[190px]" />
                    <CanvasImageSettingsPopover config={imageConfig} placement="topLeft" buttonClassName="!h-10 !max-w-[170px] !justify-start !rounded-full !px-3" onConfigChange={(key, value) => { if (key !== "count") updateConfig(key, value); }} onMissingConfig={() => openConfigDialog(true)} />
                </div>
                <Button type="primary" className="!h-10 !min-w-16 shrink-0 !rounded-full !px-3" danger={running} disabled={!running && !text} onClick={() => (running ? onStop() : onGenerate(text, imageConfig))} aria-label={t(running ? "product.batch.stop" : "product.batch.generate")}>
                    <span className="flex items-center gap-1.5">
                        {running ? (
                            <>
                                <LoaderCircle className="size-4 animate-spin" />
                                <Square className="size-3.5 fill-current" />
                            </>
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </span>
                </Button>
            </div>
        </div>
    );
}
