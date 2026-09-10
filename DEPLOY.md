# 部署指南

无限画布是**纯静态前端**：部署它只是把一个网页跑起来，不需要数据库、不需要后端。
模型请求由访问者浏览器直连 vpapi（`https://api.zkki.net`），API Key 只存在访问者自己的浏览器里。

## 30 秒部署（Docker，推荐）

```bash
docker run -d --name infinite-canvas -p 3000:3000 --restart unless-stopped \
  ghcr.io/cr-c/vpapi-canvas:latest
```

打开 `http://服务器IP:3000` 即可。

## 用 AI 部署（把下面这段发给 Codex / Claude Code / Cursor）

```text
请帮我在当前机器上部署 infinite-canvas：
1. 用 Docker 运行 ghcr.io/cr-c/vpapi-canvas:latest，映射端口 3000，容器名 infinite-canvas，重启策略 unless-stopped。
2. 如果机器上已有 nginx/Caddy，帮我把域名反代到 127.0.0.1:3000 并配置 HTTPS。
3. 部署完成后执行 curl -I http://127.0.0.1:3000 确认返回 200，并告诉我访问地址。
```

AI 需要知道的边界：

- 只需要 80/443/3000 端口，不需要数据库、Redis、对象存储。
- 静态站点没有服务端环境变量，**不要**把 API Key 写进任何配置文件。
- 如果服务器在墙内需要加速镜像拉取，可改用自己构建：`docker build -t infinite-canvas . && docker run -d -p 3000:3000 infinite-canvas`。
- 本仓库基于 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT）；这里发布的镜像 `ghcr.io/cr-c/vpapi-canvas` 内置了 vpapi 协议与一键接入。

## 云平台部署

| 平台 | 做法 |
| --- | --- |
| Render | 用仓库根目录的 `render.yaml`，选择 Docker 环境即可，无需任何环境变量 |
| Vercel | 导入仓库，根目录 `vercel.json` 会自动构建 `web/` |
| 任意静态托管 | `cd web && bun install && bun run build`，把 `web/dist` 传上去 |

## 本地开发

```bash
cd web
bun install
bun run dev
```

访问 `http://localhost:3000`。

## 部署完成后：填一次 Key

1. 打开页面右上角**配置**。
2. 在「一步接入 vpapi」里粘贴你的 API Key，点「接入并拉取模型」。
3. 画布会自动导入该 Key 下的全部模型，并按网关发布的能力标签识别生图 / 视频 / 文本，自动设为默认模型。

之后就能直接用了：文生图、图生图、文生视频、图生视频、对话助手。

## 常见问题

**浏览器提示跨域失败？**
vpapi 的 `/v1` 路径对所有来源开放跨域，正常不会失败。若你自建反向代理，请放行 `Origin`、`Authorization`、`Content-Type`、`Prefer` 这几个请求头。

**图片/视频生成很慢或超时？**
画布已按 vpapi 的推荐使用异步契约：图片提交后轮询 `GET /v1/images/generations/{task_id}`，视频轮询 `GET /v1/videos/{task_id}`。如果前面挂了 Cloudflare，请注意不要让反代把长请求掐断。

**想换成别的网关？**
配置里可以新增任意渠道，协议选 OpenAI 或 Gemini 兼容即可；vpapi 渠道只是预置好的一个。
