<p align="center">
  <img src="web/public/logo.svg" width="96" alt="vpapi canvas logo">
</p>

<h1 align="center">vpapi 画布</h1>

<p align="center">
  <b>专供 vpapi 的无限画布创作前端</b>：一个 API Key 快速接入，生图、生视频、内置助手创作，全程消耗 vpapi 额度。
</p>

<p align="center">
  <a href="https://github.com/CR-c/vpapi-canvas"><img src="https://img.shields.io/github/stars/CR-c/vpapi-canvas?style=flat-square&logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/CR-c/vpapi-canvas/tags"><img src="https://img.shields.io/github/v/tag/CR-c/vpapi-canvas?style=flat-square&label=version" alt="Version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-f97316?style=flat-square" alt="License"></a>
  <a href="https://vite.dev/"><img src="https://img.shields.io/badge/Vite-7-646cff?style=flat-square&logo=vite&logoColor=white" alt="Vite"></a>
</p>

<p align="center">
  <a href="DEPLOY.md">部署指南</a> · <a href="FORK.md">fork 说明与上游同步</a> · <a href="docs/content/docs/overview/features.mdx">功能介绍</a> · <a href="plugins/infinite-canvas">Codex app 插件</a>
</p>

本项目是 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的 fork，改造为 **vpapi 专用创作画布**：网关地址与协议固定，用户只需要一把 vpapi API Key。

## 用户怎么用

1. 在 vpapi 站点注册并创建一个 API Key（<https://vp.zkki.net/keys>）。
2. 打开画布，按能力粘贴 Key —— 文本 / 助手、生图、视频可以分别填不同分组的 Key，只填一把也能覆盖全部能力；画布会自动按网关公布的能力导入模型并设好默认项。
3. 直接在无限画布上生图、生视频，或用右侧内置助手对话创作；顶栏实时显示账号额度。

> 完整、带 AI 部署提示词的小白指南见 **[DEPLOY.md](DEPLOY.md)**；fork 与上游同步方式见 **[FORK.md](FORK.md)**。

```bash
# 纯静态、无数据库、无后端。一条命令即可启动：
docker run -d --name vpapi-canvas -p 3000:3000 --restart unless-stopped ghcr.io/cr-c/vpapi-canvas:latest
```

> [!CAUTION]
> 项目目前处于开发阶段，不保证历史数据兼容。各种本地存储格式都可能直接调整，欢迎关注后续更新。
>
> 二次开发与 PR 请保留原作者信息与前端页面标识；本 fork 的新功能请按 [FORK.md](FORK.md) 的约定写在 `web/src/product/` 下。

## 与上游的关系

- 上游：<https://github.com/basketikun/infinite-canvas>（`origin`），本项目会持续同步上游更新。
- 上游原版的通用能力（多渠道、协议切换、模型脚本等）代码仍然保留，只是在本产品里不再暴露入口。
- 同步方式、补丁点清单和冲突处理见 [FORK.md](FORK.md)。

## 赞助商

<table>
  <tr>
    <td width="190" align="center">
      <a href="https://www.atlascloud.ai/zh?utm_source=github&utm_medium=link&utm_campaign=infinite-canvas" target="_blank" rel="noopener noreferrer"><img src="assets/atlascloud.svg" width="163" alt="Atlas Cloud"></a>
    </td>
    <td>
      <a href="https://www.atlascloud.ai/zh?utm_source=github&utm_medium=link&utm_campaign=infinite-canvas" target="_blank" rel="noopener noreferrer">Atlas Cloud</a> is a full-modal AI inference platform that gives developers a single AI API to access video generation, image generation, and LLM APIs. Instead of managing multiple vendor integrations, you connect once and get unified access to 300+ curated models across all modalities. Check out <a href="https://www.atlascloud.ai/console/coding-plan" target="_blank" rel="noopener noreferrer">Atlas Cloud's new coding plan promotion</a> for more budget-friendly API access.
    </td>
  </tr>
  <tr>
    <td width="190" align="center">
      <a href="https://metaso.cn/minimax-h3/?s=inf" target="_blank" rel="noopener noreferrer"><img src="assets/metaso.jpg" width="163" alt="秘塔科技"></a>
    </td>
    <td>
      <strong>MiniMax H3 视频生成 API｜秘塔科技</strong> 秘塔科技提供高性价比的 MiniMax H3 视频生成服务：<strong>768P 仅 0.09 元/秒，2K 仅 0.15 元/秒</strong>。支持原生 2K、音画同步，API 兼容 <strong>OpenAI 协议</strong>，同时支持 <strong>ComfyUI</strong>，无需自行部署 GPU。 🎁 通过 <a href="https://metaso.cn/minimax-h3/?s=inf" target="_blank" rel="noopener noreferrer">无限画布专属链接注册</a>，即可领取赠送额度及专属优惠。
    </td>
  </tr>
  <tr>
    <td width="190" align="center">
      <a href="https://www.infistar.cc/register?aff=4X3V9NA9&ref_source=link" target="_blank" rel="noopener noreferrer"><img src="assets/infistar.png" width="163" alt="Infistar.ai 无限星河"></a>
    </td>
    <td>
      <strong>无限画布 × Infistar.ai 无限星河｜内置原生画布 · 全能多模态 API</strong> 💡 原生集成，即点即用： Infistar.ai 已原生上架无限画布！同时提供低至官方 1 折的稳定 API 中转服务，模型倍率与调用明细全程透明。 🎨 多模态生图/生视频： 完美适配 Seedance、FLUX、Midjourney、Sora、Runway、Luma、可灵（Kling）等顶级图片与视频大模型。 🧠 全系语言模型： 覆盖 OpenAI、Claude、Gemini、Grok、DeepSeek、Qwen、GLM 等国内外主流模型，兼容 OpenAI 标准接口。 ⚡ 动态调度： 多路供应保障高可用，拒绝断连。 🎁 专属福利： 通过 <a href="https://infistar.ai/register?aff=4X3V9NA9&ref_source=link" target="_blank" rel="noopener noreferrer">专属链接</a> 注册，立享赠送额度/专属折扣/首充权益！
    </td>
  </tr>
</table>

## 核心功能

- 无限画布：多画布项目、节点拖拽缩放、连线、小地图、撤销重做、导入导出。
- AI 创作：浏览器前台直连你配置的 OpenAI 兼容接口，支持文生图、图生图、参考图编辑、文本问答、音频和视频生成。
- 画布助手：围绕选中节点和上游节点对话、生图，并把结果插回画布。
- 本地 Agent：通过本机 Canvas Agent 连接 Codex / Claude Code，让 Agent 通过 MCP 操作当前画布；
- Codex App 插件：提供 Codex app 插件，安装后会自动注册 MCP 并尝试拉起本地 Agent。
- 插件系统：支持通过 URL 动态安装 / 启用 / 更新 / 卸载远程节点插件，并提供 TypeScript SDK 自行开发画布节点插件。
- 自定义接口调用：可自定义生图 / 视频接口的调用方式，灵活适配各类中转站与自建服务。
- 提示词库：内置 7 个开源提示词来源并支持自定义标准 JSON 来源，由浏览器前端直连并缓存到 IndexedDB。

完整功能说明见 [功能介绍](docs/content/docs/overview/features.mdx)。

如果你在为担心没有合适的生图API来发愁，可以查看该免费生图项目：[chatgpt2api](https://github.com/basketikun/chatgpt2api)

## 快速开始

AI API Key、Base URL、画布、素材和生成记录默认保存在浏览器本地。

### 本地开发

```bash
git clone git@github.com:basketikun/infinite-canvas.git
cd infinite-canvas
cd web
bun install
bun run dev
```

### Docker 运行

```bash
git clone git@github.com:basketikun/infinite-canvas.git
cd infinite-canvas
docker compose up -d
```

运行后默认端口3000，可访问 `http://localhost:3000`。

首次打开后进入右上角配置，填入自己的 OpenAI 兼容 `Base URL` 和 `API Key`。

如果默认的OpenAI接口调用方式与您的API不同，可自定义生图/视频脚本调用。

## 效果展示

<table width="100%">
  <tr>
    <td width="50%"><img src="https://i.ibb.co/TDFvGWDT/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/zVwJq3YS/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/PvY3qhhK/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/7D04LwN/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/bj30FtS5/5.png" alt="5" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/hxRvjw51/image.png" alt="image" border="0"></td>
  </tr>
  <tr>
    <td width="50%"><img src="https://i.ibb.co/jkWsF8q1/image.png" alt="image" border="0"></td>
    <td width="50%"><img src="https://i.ibb.co/XrnfXHx7/image.png" alt="image" border="0"></td>
  </tr>
</table>

## 联系方式

项目定制二次开发需求 / 生图 API 需求可联系。

邮箱：1844025705@qq.com · QQ：1844025705

## 赞助支持

本项目长期开放广告赞助合作，欢迎品牌 / 产品投放，你的支持是持续更新的动力！

有广告赞助意向请通过上方联系方式沟通。

## 社区支持

学 AI，上 L 站：[LinuxDO](https://linux.do/)

点击链接加入群聊【AI开源交流】：https://qm.qq.com/q/DFnKzZ807u

## 开源协议

本项目使用 [MIT License](LICENSE)。任何人都可以免费使用、复制、修改、分发、再授权和商业使用本项目，也可以用于闭源产品。

## Star History

<a href="https://www.star-history.com/?repos=basketikun%2Finfinite-canvas&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=basketikun/infinite-canvas&type=date&legend=top-left" />
 </picture>
</a>
