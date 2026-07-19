import { errorResponse, json, assertSameOrigin } from "./http";
import { consume } from "./jobs";
import type { Env, JobMessage, JobRow } from "./types";

const allowed = new Set(["application/pdf", "text/plain", "text/markdown", "text/x-markdown"]);
const cleanName = (name: string) => name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);

async function createJob(request: Request, env: Env): Promise<Response> {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request origin", 403);
  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  const title = String(form.get("title") ?? "").trim().slice(0, 120);
  const language = String(form.get("language") ?? "zh-CN");
  const duration = Number(form.get("duration") ?? 8);
  const style = String(form.get("style") ?? "轻松科普").slice(0, 40);
  if (!title || files.length === 0) return errorResponse("请填写标题并至少上传一个资料文件");
  if (!Number.isInteger(duration) || duration < 3 || duration > 30) return errorResponse("目标时长须为 3–30 分钟");
  const max = Number(env.MAX_UPLOAD_BYTES);
  if (files.some(file => file.size <= 0 || file.size > max || !allowed.has(file.type))) return errorResponse("仅支持 10 MB 内的 PDF、TXT 或 Markdown 文件");
  const id = crypto.randomUUID();
  const keys: string[] = [];
  for (const file of files) {
    const key = `jobs/${id}/input/${crypto.randomUUID()}-${cleanName(file.name).toLowerCase()}`;
    await env.FILES.put(key, file.stream(), { httpMetadata: { contentType: file.type } });
    keys.push(key);
  }
  const now = new Date().toISOString();
  await env.DB.prepare("INSERT INTO jobs (id,title,language,duration,style,status,progress,stage,input_keys,created_at,updated_at) VALUES (?,?,?,?,?,'queued',5,'等待处理',?,?,?)")
    .bind(id, title, language, duration, style, JSON.stringify(keys), now, now).run();
  await env.JOBS.send({ jobId: id });
  return json({ id, status: "queued" }, 202);
}

async function getJob(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(id).first<JobRow>();
  if (!row) return errorResponse("任务不存在", 404);
  return json({ id: row.id, title: row.title, status: row.status, progress: row.progress, stage: row.stage, error: row.error,
    script: row.script ? JSON.parse(row.script) : null, audioUrl: row.audio_key ? `/api/jobs/${id}/audio` : null, createdAt: row.created_at });
}

async function retryJob(id: string, request: Request, env: Env): Promise<Response> {
  if (!assertSameOrigin(request)) return errorResponse("Invalid request origin", 403);
  const row = await env.DB.prepare("SELECT status FROM jobs WHERE id=?").bind(id).first<{ status: string }>();
  if (!row) return errorResponse("任务不存在", 404);
  if (row.status !== "failed") return errorResponse("只有失败的任务可以重试", 409);
  await env.DB.prepare("UPDATE jobs SET status='queued', progress=5, stage='等待重试', error=NULL, updated_at=? WHERE id=?").bind(new Date().toISOString(), id).run();
  await env.JOBS.send({ jobId: id });
  return json({ id, status: "queued" }, 202);
}

async function audio(id: string, request: Request, env: Env): Promise<Response> {
  const row = await env.DB.prepare("SELECT audio_key FROM jobs WHERE id=? AND status='completed'").bind(id).first<{ audio_key: string }>();
  if (!row?.audio_key) return errorResponse("音频尚未生成", 404);
  const object = await env.FILES.get(row.audio_key, { range: request.headers });
  if (!object) return errorResponse("音频不存在", 404);
  const headers = new Headers(); object.writeHttpMetadata(headers); headers.set("etag", object.httpEtag); headers.set("accept-ranges", "bytes");
  if (object.range && "offset" in object.range && typeof object.range.offset === "number" && typeof object.range.length === "number") {
    headers.set("content-range", `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
  }
  return new Response(object.body, { status: object.range ? 206 : 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/api/jobs") return await createJob(request, env);
      const retryMatch = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)\/retry$/);
      if (retryMatch && request.method === "POST") return await retryJob(retryMatch[1], request, env);
      const match = url.pathname.match(/^\/api\/jobs\/([0-9a-f-]+)(\/audio)?$/);
      if (match && request.method === "GET") return match[2] ? await audio(match[1], request, env) : await getJob(match[1], env);
      if (url.pathname.startsWith("/api/")) return errorResponse("Not found", 404);
      return await env.ASSETS.fetch(request);
    } catch (cause) {
      console.error(JSON.stringify({ event: "request_failed", path: url.pathname, error: cause instanceof Error ? cause.message : "unknown" }));
      return errorResponse("服务暂时不可用，请稍后重试", 500);
    }
  },
  queue: consume
} satisfies ExportedHandler<Env, JobMessage>;
