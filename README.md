# PodForge

PodForge 是部署在 Cloudflare Workers 上的响应式播客生成 MVP：上传 PDF、TXT 或 Markdown 后，Queue 消费者调用 MiniMax 生成双人脚本和语音，D1 保存可恢复的任务状态，R2 保存源文件与音频。

## 本地开发

```bash
npm install
npx wrangler d1 create podforge
npx wrangler r2 bucket create podforge-files
npx wrangler r2 bucket create podforge-files-preview
npx wrangler queues create podforge-jobs
npx wrangler queues create podforge-jobs-dlq
```

将 D1 命令输出的 ID 写入 `wrangler.jsonc`，然后初始化本地数据库并启动：

```bash
npm run cf-typegen
npx wrangler d1 migrations apply podforge --local
npm run dev
```

## Secret 与部署

MiniMax 密钥只通过 Worker Secret 配置，禁止写入仓库或前端环境变量：

```bash
npx wrangler secret put MINIMAX_API_KEY
# 仅当 MiniMax 账号仍要求 GroupId 时配置
npx wrangler secret put MINIMAX_GROUP_ID
npx wrangler d1 migrations apply podforge --remote
npm run deploy
```

模型、API Base、上传上限可通过 `wrangler.jsonc` 的非敏感变量调整。语音接口返回的分段 MP3 按台词顺序组成最终文件；正式发布前应使用实际账号验证所选模型与音色 ID 是否在账号区域可用。

## 安全与限制

- 同源写请求、服务端文件类型/大小/时长校验；单文件默认上限 10 MB。
- API 响应与日志不包含原文或 Secret；R2 对象不公开，只通过任务音频接口读取。
- Queue 失败最多重试 3 次并进入 DLQ；D1 会保留可理解的失败原因。
- 建议在生产域名前增加 Cloudflare Turnstile/WAF 限速规则，并为 R2 原始资料配置生命周期删除策略。
