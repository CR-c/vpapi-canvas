/**
 * 产品开关：fork 通过这里收敛上游的通用能力，而不是删除上游代码。
 *
 * 改动这些开关前先看 FORK.md，必要时同步更新本文件的注释与产品面板文案。
 */
export const PRODUCT_FLAGS = {
    /**
     * 只保留一个 vpapi 渠道：协议固定 vpapi、网关固定官方地址。
     * 关闭后设置页会重新暴露上游的渠道管理 / 协议切换 / 模型脚本入口。
     */
    lockGateway: true,
    /** 默认用浏览器内的内置 Agent（走 vpapi 的 chat/responses 接口）。 */
    builtinAgent: true,
    /** 是否仍允许切回上游的本地 CLI Agent（需要用户本机装 Codex / Claude Code）。 */
    allowLocalCliAgent: true,
} as const;
