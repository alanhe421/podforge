import { extractText } from "unpdf";
import mammoth from "mammoth";
import { Buffer } from "node:buffer";
import { fadePcmEdges, pauseAfter, storePodcastWav, type StoredAudioPart } from "./audio";
import { generateScript, synthesizeLine } from "./minimax";
import type { Env, JobMessage, JobRow } from "./types";

class JobCanceledError extends Error {
  constructor() { super("Job canceled"); this.name = "JobCanceledError"; }
}

async function assertActive(env: Env, id: string): Promise<void> {
  const row = await env.DB.prepare("SELECT status FROM jobs WHERE id=?").bind(id).first<{ status: string }>();
  if (!row || row.status === "canceled") throw new JobCanceledError();
}

async function updateProcessing(env: Env, id: string, progress: number, stage: string): Promise<void> {
  const result = await env.DB.prepare("UPDATE jobs SET status='processing', progress=?, stage=?, error=NULL, updated_at=? WHERE id=? AND status IN ('queued','processing','failed')")
    .bind(progress, stage, new Date().toISOString(), id).run();
  if (result.meta.changes === 0) throw new JobCanceledError();
}

export async function sourceText(env: Env, keys: string[]): Promise<string> {
  const chunks: string[] = [];
  for (const key of keys) {
    const object = await env.FILES.get(key);
    if (!object) throw new Error("Uploaded source is missing");
    if (key.endsWith(".pdf")) {
      const result = await extractText(new Uint8Array(await object.arrayBuffer()), { mergePages: true });
      chunks.push(result.text);
    } else if (key.endsWith(".docx")) {
      const arrayBuffer = await object.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer, buffer: Buffer.from(arrayBuffer) });
      chunks.push(result.value.trim());
    } else chunks.push(await object.text());
  }
  return chunks.join("\n\n").slice(0, 150000);
}

export async function processJob(env: Env, jobId: string): Promise<void> {
  const job = await env.DB.prepare("SELECT * FROM jobs WHERE id=?").bind(jobId).first<JobRow>();
  if (!job || job.status === "completed" || job.status === "canceled") return;
  const temporaryAudioKeys: string[] = [];
  let unfinishedAudioKey: string | null = null;
  try {
    await updateProcessing(env, jobId, 15, "正在解析资料");
    const source = await sourceText(env, JSON.parse(job.input_keys) as string[]);
    if (!source.trim()) throw new Error("资料中没有可提取的文本");
    await assertActive(env, jobId);
    await updateProcessing(env, jobId, 35, "正在生成双人脚本");
    const script = await generateScript(env, source, job.title, job.language, job.duration, job.style);
    await assertActive(env, jobId);
    const scriptResult = await env.DB.prepare("UPDATE jobs SET script=?, updated_at=? WHERE id=? AND status='processing'")
      .bind(JSON.stringify(script), new Date().toISOString(), jobId).run();
    if (scriptResult.meta.changes === 0) throw new JobCanceledError();
    const parts: StoredAudioPart[] = [];
    for (let index = 0; index < script.lines.length; index += 1) {
      const line = script.lines[index];
      await assertActive(env, jobId);
      const pcm = fadePcmEdges(await synthesizeLine(env, line.text, line.speaker, line.tone));
      await assertActive(env, jobId);
      const partKey = `jobs/${jobId}/audio-parts/${index.toString().padStart(4, "0")}.pcm`;
      await env.FILES.put(partKey, pcm);
      temporaryAudioKeys.push(partKey);
      parts.push({ key: partKey, byteLength: pcm.byteLength, pauseMs: pauseAfter(line, script.lines[index + 1]) });
      await updateProcessing(env, jobId, 45 + Math.floor(((index + 1) / script.lines.length) * 45), `正在合成语音 ${index + 1}/${script.lines.length}`);
    }
    await updateProcessing(env, jobId, 92, "正在编排对话节奏");
    const audioKey = `jobs/${jobId}/podcast-${jobId}.wav`;
    unfinishedAudioKey = audioKey;
    await storePodcastWav(env.FILES, audioKey, parts);
    await assertActive(env, jobId);
    const completed = await env.DB.prepare("UPDATE jobs SET status='completed', progress=100, stage='生成完成', audio_key=?, updated_at=? WHERE id=? AND status='processing'")
      .bind(audioKey, new Date().toISOString(), jobId).run();
    if (completed.meta.changes === 0) throw new JobCanceledError();
    unfinishedAudioKey = null;
  } catch (cause) {
    if (cause instanceof JobCanceledError) return;
    const message = cause instanceof Error ? cause.message : "生成失败";
    await env.DB.prepare("UPDATE jobs SET status='failed', progress=0, stage='生成失败', error=?, updated_at=? WHERE id=? AND status!='canceled'")
      .bind(message.slice(0, 500), new Date().toISOString(), jobId).run();
    throw cause;
  } finally {
    if (unfinishedAudioKey) await env.FILES.delete(unfinishedAudioKey).catch(cause =>
      console.warn(JSON.stringify({ event: "unfinished_audio_cleanup_failed", jobId, error: cause instanceof Error ? cause.message : "unknown" })));
    if (temporaryAudioKeys.length > 0) await env.FILES.delete(temporaryAudioKeys).catch(cause =>
      console.warn(JSON.stringify({ event: "audio_parts_cleanup_failed", jobId, error: cause instanceof Error ? cause.message : "unknown" })));
  }
}

export async function consume(batch: MessageBatch<JobMessage>, env: Env): Promise<void> {
  for (const message of batch.messages) {
    try { await processJob(env, message.body.jobId); message.ack(); }
    catch (cause) { console.error(JSON.stringify({ event: "job_failed", jobId: message.body.jobId, error: cause instanceof Error ? cause.message : "unknown" })); message.retry(); }
  }
}
