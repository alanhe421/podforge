import { extractText } from "unpdf";
import mammoth from "mammoth";
import { Buffer } from "node:buffer";
import { fadePcmEdges, pauseAfter, storePodcastWav, type StoredAudioPart } from "./audio";
import { generateScript, synthesizeLine } from "./minimax";
import type { Env, JobMessage, JobRow } from "./types";

const update = (env: Env, id: string, status: string, progress: number, stage: string, error: string | null = null) =>
  env.DB.prepare("UPDATE jobs SET status=?, progress=?, stage=?, error=?, updated_at=? WHERE id=?")
    .bind(status, progress, stage, error, new Date().toISOString(), id).run();

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
  if (!job || job.status === "completed") return;
  const temporaryAudioKeys: string[] = [];
  try {
    await update(env, jobId, "processing", 15, "正在解析资料");
    const source = await sourceText(env, JSON.parse(job.input_keys) as string[]);
    if (!source.trim()) throw new Error("资料中没有可提取的文本");
    await update(env, jobId, "processing", 35, "正在生成双人脚本");
    const script = await generateScript(env, source, job.title, job.language, job.duration, job.style);
    await env.DB.prepare("UPDATE jobs SET script=?, updated_at=? WHERE id=?").bind(JSON.stringify(script), new Date().toISOString(), jobId).run();
    const parts: StoredAudioPart[] = [];
    for (let index = 0; index < script.lines.length; index += 1) {
      const line = script.lines[index];
      const pcm = fadePcmEdges(await synthesizeLine(env, line.text, line.speaker, line.tone));
      const partKey = `jobs/${jobId}/audio-parts/${index.toString().padStart(4, "0")}.pcm`;
      await env.FILES.put(partKey, pcm);
      temporaryAudioKeys.push(partKey);
      parts.push({ key: partKey, byteLength: pcm.byteLength, pauseMs: pauseAfter(line, script.lines[index + 1]) });
      await update(env, jobId, "processing", 45 + Math.floor(((index + 1) / script.lines.length) * 45), `正在合成语音 ${index + 1}/${script.lines.length}`);
    }
    await update(env, jobId, "processing", 92, "正在编排对话节奏");
    const audioKey = `jobs/${jobId}/podcast-${jobId}.wav`;
    await storePodcastWav(env.FILES, audioKey, parts);
    await env.DB.prepare("UPDATE jobs SET status='completed', progress=100, stage='生成完成', audio_key=?, updated_at=? WHERE id=?").bind(audioKey, new Date().toISOString(), jobId).run();
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "生成失败";
    await update(env, jobId, "failed", 0, "生成失败", message.slice(0, 500));
    throw cause;
  } finally {
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
