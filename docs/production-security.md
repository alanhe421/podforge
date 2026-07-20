# 生产环境安全配置

## Turnstile

创建 Managed widget，并把 hostname 限制在生产域名和本地开发域名：

```bash
npx wrangler turnstile widget create "podforge-production" \
  --domain podforge.1991421.cn --domain localhost --domain 127.0.0.1 \
  --mode managed --json
```

将返回的 site key 保存为 GitHub Actions secret `TURNSTILE_SITE_KEY`。Secret key 只写入 Worker Secret：

```bash
cd apps/worker
npx wrangler secret put TURNSTILE_SECRET
```

不要把 secret key 放在 `wrangler.jsonc`、前端环境变量或 GitHub Actions 日志中。部署后在 Turnstile Analytics 确认 action 为 `turnstile-spin-v2`，并分别验证创建任务和失败任务重试。Worker 会同时校验 Siteverify 的 `success`、`action` 和 `hostname`；验证服务不可用时请求失败关闭。

本地开发可将两个 `.example` 文件复制为对应的 `.env` 和 `.dev.vars`，使用 Cloudflare 官方测试凭据。生产环境不得使用测试凭据。

## WAF 限速

在 `podforge.1991421.cn` 所属 zone 的 **Security → WAF → Rate limiting rules** 创建规则：

- 表达式：`http.request.method eq "POST" and (http.request.uri.path eq "/api/jobs" or (starts_with(http.request.uri.path, "/api/jobs/") and ends_with(http.request.uri.path, "/retry")))`
- 计数特征：IP
- 建议初始阈值：每个 IP 每 10 秒 3 次
- 动作：Block，缓解时间 60 秒

Cloudflare 套餐支持的周期、规则数量和动作不同；若当前套餐只允许一条规则，优先保护以上两个会触发 AI 计算的写接口。上线一周后根据 Security Events 中的误拦截与攻击流量调整阈值。Turnstile 是应用层最终校验，WAF 是边缘层成本保护，两者都需保留。

## R2 原始资料生命周期

新上传原始资料使用 `inputs/` 前缀，生成音频使用 `outputs/` 前缀，因此生命周期规则不会提前删除成品。为生产 bucket 添加 7 天删除策略：

```bash
npx wrangler r2 bucket lifecycle add podforge-files delete-job-inputs-after-7-days inputs/ --expire-days 7
npx wrangler r2 bucket lifecycle list podforge-files
```

此命令需要带 `Workers R2 Storage Write` 权限的 Cloudflare token。生命周期删除通常会在过期时间后 24 小时内完成。旧版本写入 `jobs/<id>/input/` 的对象不匹配新规则，应在确认没有仍需重试的旧任务后单独清理；不要对整个 `jobs/` 前缀设置规则，否则会同时删除旧版生成音频。
