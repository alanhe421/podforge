# PodForge

PodForge 采用前后端分离的 npm workspaces：

```text
apps/web     React + Vite 响应式前端，部署到 Cloudflare Pages
apps/worker  Cloudflare Worker API + Queue consumer，绑定 D1、R2 和 MiniMax
```

前端只负责页面和任务轮询；上传、资料解析、MiniMax 脚本/TTS、状态持久化及音频访问全部在 Worker。MiniMax Key 不进入 Pages 构建环境。

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

## 部署 Worker

在 `apps/worker/wrangler.jsonc` 中将 `WEB_ORIGIN` 改为 Pages 正式域名，并配置服务端 Secret：

```bash
cd apps/worker
npx wrangler secret put MINIMAX_API_KEY
# 仅当账号仍要求 GroupId 时配置
npx wrangler secret put MINIMAX_GROUP_ID
npx wrangler d1 migrations apply podforge --remote
npm run deploy
```

## 部署 Pages

在 Cloudflare Pages 创建 `podforge-web` 项目：

- Root directory: `apps/web`
- Build command: `npm run build`
- Output directory: `dist`
- 环境变量 `VITE_API_BASE_URL`: Worker 的 HTTPS 地址，例如 `https://podforge-api.example.workers.dev`

也可从仓库根目录运行 `npm run deploy:web`。注意 `VITE_API_BASE_URL` 是公开 API 地址，不得在 Pages 环境中配置 MiniMax Key。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

生产环境建议增加 Cloudflare Turnstile/WAF 限速规则，并为 R2 原始资料配置生命周期删除策略。正式发布前需使用实际 MiniMax 账号确认两个系统音色可用。
