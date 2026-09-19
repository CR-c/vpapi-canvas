# vpapi 画布（fork 说明）

本项目是 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas) 的 fork，改造成 **vpapi 专用创作画布**：用户填一个 vpapi API Key 就能生图、生视频、用内置助手创作，全部消耗 vpapi 额度。

fork 的第一目标是「既要专用，又要随时能合上游」——上游每次发版都能快速 pull 过来用，所以改造遵循覆盖层原则，而不是把上游代码删干净。

## 远程约定

| 远程 | 仓库 | 用途 |
| --- | --- | --- |
| `origin` | `basketikun/infinite-canvas` | **上游**，只读同步源 |
| `vpapi` | `CR-c/vpapi-canvas` | **本 fork 的发布仓库**，本地 `main` 跟踪它并默认推送 |
| `private` | `CR-c/infinite-canvas` | 旧镜像仓库，保留备用 |

日常开发：本地改 → 提交 → `git push`（默认推到 `vpapi`）。上游更新走下面的同步流程。

## 改造原则

1. **新功能一律放新目录** `web/src/product/**`，不改上游业务文件。
2. 必须改上游文件时，只允许「补丁点」清单里的文件，并用 `// [vpapi-canvas]` 注释包住改动，方便合并时定位。
3. **不物理删除上游能力**（Gemini 协议、协议切换、模型脚本、渠道管理都保留在代码里），只通过产品层让入口不可达。
4. 品牌文案**不改**上游 i18n 文件（`zh-CN.ts` / `en-US.ts`），改为运行时覆盖。
5. 同步永远用 `git merge`，不要 `git rebase` 到上游（补丁点保持可见，冲突范围可控）。

## 补丁点清单

改动上游文件时必须同步更新本表。每条都用 `[vpapi-canvas]` 注释标记。

| 上游文件 | 改动 | 原因 |
| --- | --- | --- |
| `web/src/stores/use-config-store.ts` | 默认配置、`merge`、协议规范化统一过 `lockProductConfig()`；接入渠道按「文生 / 媒体」两组归一化（组内顺序即优先级）；默认模型按能力校验；视频分辨率挡位吸附规则 | 锁定 vpapi 协议与官方网关地址；网关能力标签是模型分类的唯一来源，网关没公布的挡位按用户手填发送 |
| `web/src/components/layout/client-root-init.tsx` | 挂载 `useProductBootstrap()` 与产品浮层 | 首启引导、`?apiKey=` 一键接入、品牌文案注入、生成消耗提示 |
| `web/src/components/layout/app-config-modal.tsx` | 渠道页渲染 `ProductChannelsPanel` | 替换渠道管理 / 协议下拉 / 模型脚本入口 |
| `web/src/components/layout/app-top-nav.tsx` | 插入 `QuotaChip` | 展示 Key 剩余额度 |
| `web/src/components/agent/agent-panel.tsx` | 默认渲染内置 Agent，可切回本地 CLI Agent | 让 vpapi 用户直接用上助手 |
| `web/src/components/layout/github-link.tsx`、`web/src/hooks/use-version-check.ts` | 指向 fork 仓库 / 关闭上游更新检查 | 品牌与更新源 |
| `web/index.html`、`web/public/logo.svg` | 站点标题、图标 | 品牌 |
| `web/src/services/api/video.ts` | `metadata.url` 结果链接、瞬时错误重试、取回降级链；产品层判定任务终态并发送已公布的音轨 / 水印参数 | 生成结果可靠性（上游未含） |
| `web/src/services/api/image.ts` | vpapi 异步图像任务；模型目录读取回调与原始错误透传 | 一次模型读取同时更新端点缓存，保留鉴权 / 限流错误分类 |
| `web/src/components/video-settings-panel.tsx` | 分辨率输入框按像素值展示当前挡位 | 网关挡位带 `p` / `4k` 后缀，数字输入框无法解析会显示为空 |
| `web/src/components/model-picker.tsx` | 选项按接入 Key 分组渲染，条目改为「模型名 + 单价」两行排版并加宽弹层 | 模型名 + 价格拼在一行时过长，弹层里经常被裁切遮挡；分组后才能先看到 Key 再选模型 |

除此之外的上游文件应保持原样。发现需要新补丁点时，先在本表登记再改。

## 同步上游

### 本地

```bash
./scripts/sync-upstream.sh          # fetch + merge 上游 main，冲突时列出文件
cd web && npm run typecheck && npm run build
git push                            # 推到 vpapi
```

### 自动（GitHub Actions）

`.github/workflows/upstream-sync.yml` 每天定时把上游 `main` 合进 `chore/sync-upstream` 分支：

- 合并成功 → 跑 `npm ci && npm run build` → 开 PR 等你复核（复核重点是补丁点是否仍在）。
- 出现冲突 → 不合并，创建 / 更新 `upstream-sync` issue 列出冲突文件，按下面的手册在本地处理。

### 冲突处理手册

| 冲突文件 | 处理方式 |
| --- | --- |
| 上文补丁点清单里的文件 | 保留上游新逻辑，再把 `[vpapi-canvas]` 的那几行重新贴回；不要反过来丢弃上游改动 |
| `CHANGELOG.md`、`docs/content/docs/progress/pending-test*.mdx` | 两边的条目都保留（上游条目在上、fork 条目在下） |
| 上游新增文件 / 与 fork 无关的改动 | 一律接受上游版本 |
| `web/src/product/**`、`FORK.md`、`scripts/sync-upstream.sh` | fork 独有，上游不会改，正常不会冲突 |

解决冲突后务必跑一次 `cd web && npm run typecheck && npm run build`，再确认画布能正常接入 vpapi。

## 发布

- 版本号在根目录 `VERSION`，变更记录在 `CHANGELOG.md`。
- 打 tag（`v*`）会触发 `.github/workflows/docker-image.yml` 构建并推送多架构镜像 `ghcr.io/cr-c/vpapi-canvas`。
- 用户部署方式见 `DEPLOY.md` / `README.md`。
