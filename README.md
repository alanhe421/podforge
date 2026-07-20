# PodForge

PodForge 采用前后端分离的 npm workspaces，并作为一个 Cloudflare Worker 统一部署：

```text
apps/web     React + Vite 响应式前端，构建后作为 Worker Static Assets 发布
apps/worker  Cloudflare Worker API + Queue consumer，绑定 D1、R2 和 MiniMax
```

前端只负责页面和任务轮询；上传、资料解析、MiniMax 脚本/TTS、状态持久化及音频访问全部在 Worker。生产环境下页面和 `/api/*` 同源，MiniMax Key 不进入前端构建环境。

## 本地开发

```bash
npm install
npm run dev:worker
npm run dev:web
```

Vite 在本地把 `/api` 代理到 `http://localhost:8787`。首次运行 Worker 前创建资源，并把 D1 ID 写入 `apps/worker/wrangler.jsonc`：

```bash
npx wrangler d1 create podforge
npx wrangler r2 bucket create podforge-files
npx wrangler r2 bucket create podforge-files-preview
npx wrangler queues create podforge-jobs
npx wrangler queues create podforge-jobs-dlq
npm run cf-typegen -w @podforge/worker
npx wrangler d1 migrations apply podforge --local --config apps/worker/wrangler.jsonc
```

## 自动部署

推送到 `main` 后，GitHub Actions 会根据变更路径选择发布范围：

- 只有 `apps/worker` 变化时，执行 Worker 类型检查、测试、dry run、远程 D1 migration，并发布 Worker。
- 只有 `apps/web` 变化时，只构建并发布前端静态资源。
- 前后端同时变化、根依赖变化或手动触发时，执行完整检查并统一发布一次。

前端使用 Worker Static Assets 托管，不依赖单独的 Cloudflare Pages 项目。Worker 发布前仍需构建当前前端，以满足静态资源绑定目录要求；后端单独变化时，Cloudflare 不会重复上传内容未变化的前端资源。

在 GitHub 仓库的 Actions secrets 中配置：

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Cloudflare API Token 应限制在当前账号，并授予部署 Worker、读取绑定资源和执行 D1 migration 所需的权限。MiniMax 中国站 Token Plan Subscription Key 仍以 `MINIMAX_API_KEY` 配置为 Worker Secret；API Base 使用 `https://api.minimaxi.com/v1`，文本脚本使用 OpenAI-Compatible `/chat/completions` 和 `MiniMax-M3`，语音继续使用 T2A：

```bash
cd apps/worker
npx wrangler secret put MINIMAX_API_KEY
# 仅当账号仍要求 GroupId 时配置
npx wrangler secret put MINIMAX_GROUP_ID
```

Turnstile site key 配置为 GitHub Actions secret `TURNSTILE_SITE_KEY`，服务端 secret 配置为 Worker Secret `TURNSTILE_SECRET`。WAF 限速和 R2 原始资料生命周期的生产配置见 [生产环境安全配置](docs/production-security.md)。

也可以手动执行同一套生产部署步骤：

```bash
npm run typecheck
npm test
npm run build -w @podforge/web
npm run build -w @podforge/worker
npx wrangler d1 migrations apply podforge --remote --config apps/worker/wrangler.jsonc
npm run deploy:worker
```

生产构建不要设置 `VITE_API_BASE_URL`，前端会直接请求同域的 `/api/*`。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

生产发布前需按 [生产环境安全配置](docs/production-security.md) 完成 Cloudflare 账号侧配置，并使用实际 MiniMax 账号确认两个系统音色可用。
