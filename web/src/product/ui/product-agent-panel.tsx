import { Dropdown, Select, Tooltip } from "antd";
import { Bot, History, MonitorSmartphone, Plus, Settings2, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { AgentChatTimeline } from "@/components/agent/agent-chat";
import { AgentChatComposer } from "@/components/agent/agent-chat-composer";
import { canvasThemes } from "@/lib/canvas-theme";
import { productAgentModels, useProductAgentStore } from "@/product/agent/store";
import { PRODUCT_FLAGS } from "@/product/flags";
import { useProductStore } from "@/product/store";
import { readModelEndpoints, refreshModelEndpoints, isToolsModel } from "@/product/vpapi/model-endpoints";
import { useAgentStore } from "@/stores/use-agent-store";
import { modelOptionName, useConfigStore } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";

/** 内置 Agent 面板：走 vpapi 的文本模型，工具直接在浏览器里操作画布。 */
export function ProductAgentPanel() {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const openConnect = useProductStore((state) => state.openConnect);
    const setUseLocalAgent = useProductStore((state) => state.setUseLocalAgent);
    const [prompt, setPrompt] = useState("");
    const running = useProductAgentStore((state) => state.running);
    const pendingTool = useProductAgentStore((state) => state.pendingTool);
    const model = useProductAgentStore((state) => state.model);
    const confirmTools = useProductAgentStore((state) => state.confirmTools);
    const threads = useProductAgentStore((state) => state.threads);
    const messages = useAgentStore((state) => state.messages);
    const canvasReady = Boolean(useAgentStore((state) => state.canvasContext));
    const connected = Boolean(config.apiKey.trim());
    const [agentModels, setAgentModels] = useState(() => productAgentModels());
    const currentModel = model || config.textModel || agentModels[0]?.value || "";

    // 端点能力缓存用于挑选支持对话的模型；缺失时补一次并刷新列表。
    useEffect(() => {
        if (!connected) {
            setAgentModels(productAgentModels());
            return;
        }
        if (Object.keys(readModelEndpoints()).length) {
            setAgentModels(productAgentModels());
            return;
        }
        void refreshModelEndpoints(config.apiKey)
            .then(() => setAgentModels(productAgentModels()))
            .catch(() => null);
    }, [connected, config.apiKey]);

    const submit = () => {
        const text = prompt.trim();
        if (!text || running) return;
        setPrompt("");
        void useProductAgentStore.getState().send(text, navigate);
    };

    return (
        <div className="flex h-full min-h-0 flex-col" data-canvas-shortcuts-ignore>
            <header className="flex shrink-0 items-center justify-between gap-2 px-4 pb-2 pt-4">
                <div className="flex min-w-0 items-center gap-2">
                    <Bot className="size-4 shrink-0" style={{ color: theme.node.text }} />
                    <span className="truncate text-sm font-semibold" style={{ color: theme.node.text }}>
                        {t("product.agent.title")}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton theme={theme} label={t("product.agent.newChat")} onClick={() => useProductAgentStore.getState().newThread()}>
                        <Plus className="size-4" />
                    </IconButton>
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                            items: threads.length
                                ? threads.map((thread) => ({
                                      key: thread.id,
                                      label: (
                                          <div className="flex items-center justify-between gap-4">
                                              <span className="max-w-52 truncate text-xs">{thread.title || t("product.agent.newChat")}</span>
                                              <Trash2
                                                  className="size-3.5 opacity-60 hover:opacity-100"
                                                  onClick={(event) => {
                                                      event.stopPropagation();
                                                      useProductAgentStore.getState().removeThread(thread.id);
                                                  }}
                                              />
                                          </div>
                                      ),
                                      onClick: () => useProductAgentStore.getState().selectThread(thread.id),
                                  }))
                                : [{ key: "empty", label: t("product.agent.empty"), disabled: true }],
                        }}
                    >
                        <IconButton theme={theme} label={t("product.agent.history")}>
                            <History className="size-4" />
                        </IconButton>
                    </Dropdown>
                    {PRODUCT_FLAGS.allowLocalCliAgent ? (
                        <IconButton theme={theme} label={t("product.agent.useLocal")} onClick={() => setUseLocalAgent(true)}>
                            <MonitorSmartphone className="size-4" />
                        </IconButton>
                    ) : null}
                </div>
            </header>

            <div className="shrink-0 px-4 pb-2 text-xs" style={{ color: theme.node.muted }}>
                {connected ? `${currentModel || t("product.agent.modelRequired")}${canvasReady ? "" : ` · ${t("product.agent.canvasHint")}`}` : t("product.connect.title")}
                {connected && isToolsModel(modelOptionName(currentModel)) === false ? <div className="mt-0.5">{t("product.agent.noTools")}</div> : null}
            </div>

            {messages.length ? (
                <AgentChatTimeline
                    theme={theme}
                    pendingTool={pendingTool}
                    pendingApprovals={[]}
                    sending={running}
                    waiting={false}
                    onRejectTool={() => useProductAgentStore.getState().resolvePendingTool(false)}
                    onApproveTool={() => useProductAgentStore.getState().resolvePendingTool(true)}
                    onApprovalDecision={() => undefined}
                />
            ) : (
                <div className="min-h-0 flex-1 px-4 text-sm leading-6" style={{ color: theme.node.muted }}>
                    <div>{t("product.agent.subtitle")}</div>
                    <div className="mt-2 opacity-80">{t("product.agent.empty")}</div>
                </div>
            )}

            <div className="shrink-0">
                {!connected ? (
                    <div className="px-4 pb-2">
                        <button type="button" className="w-full rounded-lg border px-3 py-2 text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }} onClick={openConnect}>
                            {t("product.connect.title")}
                        </button>
                    </div>
                ) : null}
                <AgentChatComposer
                    prompt={prompt}
                    sending={running}
                    placeholder={t("product.agent.placeholder")}
                    theme={theme}
                    onPromptChange={setPrompt}
                    onSubmit={submit}
                    onStop={() => useProductAgentStore.getState().stop()}
                    confirmTools={confirmTools}
                    onConfirmToolsChange={(value) => useProductAgentStore.getState().setConfirmTools(value)}
                    left={
                        <span className="flex min-w-0 items-center gap-1">
                            <Select
                                size="small"
                                variant="borderless"
                                className="max-w-56"
                                value={currentModel || undefined}
                                placeholder={t("product.agent.modelRequired")}
                                options={agentModels}
                                popupMatchSelectWidth={false}
                                onChange={(value) => useProductAgentStore.getState().setModel(value)}
                            />
                            <IconButton theme={theme} label={t("navigation.config")} onClick={() => openConfigDialog(false, "preferences")}>
                                <Settings2 className="size-4" />
                            </IconButton>
                        </span>
                    }
                />
            </div>
        </div>
    );
}

function IconButton({ theme, label, onClick, children }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes]; label: string; onClick?: () => void; children: ReactNode }) {
    return (
        <Tooltip title={label}>
            <button type="button" className="inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-black/5 dark:hover:bg-white/10" style={{ color: theme.node.text }} onClick={onClick} aria-label={label}>
                {children}
            </button>
        </Tooltip>
    );
}
