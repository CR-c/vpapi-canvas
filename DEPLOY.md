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

首次打开画布会**自动弹出接入引导**：

1. 按能力粘贴你的 vpapi API Key（在 <https://vp.zkki.net/keys> 创建；注意别用渠道系统密钥）：
   - **文本 / 助手**：给内置助手用的对话模型 Key；
   - **生图**、**视频**：可以分别是别的分组的 Key；
   - **音频（可选）**。
   只填一行也能覆盖全部能力（模型会按网关公布的能力标签自动归类），留空的行不会导入任何模型。
2. 点「接入」——画布会按每个 Key 拉取模型、识别生图 / 视频 / 文本 / 音频并设好默认模型。
3. 顶栏会常驻显示**账号总额度**（网关提供 `/api/usage/user` 时）或当前 Key 额度，点开可看已用额度、到期时间和充值入口。

之后就能直接用了：文生图、图生图、文生视频、图生视频，以及右侧的**内置助手**（用 vpapi 的文本模型对话，并可直接改动画布、触发生成）。

> 从 vpapi 站点跳转过来时也可以带 `?apiKey=sk-...` 一键接入，画布导入后会立即把参数从地址栏清掉。

## 常见问题

**浏览器提示跨域失败？**
vpapi 的 `/v1` 路径对所有来源开放跨域，正常不会失败。若你自建反向代理，请放行 `Origin`、`Authorization`、`Content-Type`、`Prefer` 这几个请求头。

**额度显示只有数字、没有货币符号？**
画布会顺带读取 vpapi 的 `/api/status` 获取展示货币（`$` / `¥` / tokens）。如果画布域名不在 vpapi 的 `CORS_ALLOWED_ORIGINS` 里，这一步会被浏览器拦掉，此时只显示纯数字，不影响其它功能。把画布域名加进该环境变量即可显示正确单位。

**想显示账号总额度而不是单把 Key 的额度？**
旧版网关没有账号口径的接口，画布会退回显示当前 Key 的额度并在弹层里标注。vpapi 侧加上 `GET /api/usage/user`（用 sk- 读取令牌所属账号的余额）后，画布会自动改显示账号总额度；也可以用 vpapi 系统设置里的 `Display Token Statistics` 开关切换账单接口的口径。

**图片/视频生成很慢或超时？**
画布已按 vpapi 的推荐使用异步契约：图片提交后轮询 `GET /v1/images/generations/{task_id}`，视频轮询 `GET /v1/videos/{task_id}`（最长等 30 分钟）。如果前面挂了 Cloudflare，请注意不要让反代把长请求掐断。

**想换成别的网关？**
本 fork 的产品定位是 vpapi 专用画布，网关与协议已锁定。要接别的网关请用上游的 [infinite-canvas](https://github.com/basketikun/infinite-canvas)。
