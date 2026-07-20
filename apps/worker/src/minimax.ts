import { AUDIO_SAMPLE_RATE, extractPcm16 } from "./audio";
import type { Env, PodcastScript, PodcastTone } from "./types";

const PODCAST_SYSTEM_PROMPT = `你是一位资深中文播客制作人。你的任务不是把摘要轮流分配给两个人朗读，而是把来源资料重新编排成一场自然、可信、有推进感的双人深度对谈。

角色分工：
- host 是代表听众的主持人：负责抛出核心问题、推进节奏、追问含糊处、检验理解，偶尔提出合理质疑。
- guest 是共同主持人兼解释者：负责拆解概念、给出来源中的证据和例子，也会反问、纠正和主动连接前后话题。guest 不能连续长篇授课。

节目结构：
1. 冷开场直接抛出来源中最反直觉、最有冲突或最贴近日常的问题，不要先报幕或泛泛欢迎。
2. 用很短的背景说明建立本期核心问题。
3. 围绕 3–5 个递进主题展开；每一部分都应包含事实、解释、具体例子以及“这意味着什么”。
4. 至少安排两次真实的澄清、重新表述或温和分歧，让观点通过对话变清楚。
5. 结尾回扣冷开场，给出克制、具体的核心收获，不喊口号，不机械感谢收听。

对话规则：
- 每句必须回应或推进上一句；禁止两人轮流念互不相干的摘要。
- 长短句交替。允许短反应、追问、打断后的补充，但不要滥用口头禅。
- 可以使用自然的“等等”“换句话说”“举个例子”，但避免反复出现“没错”“确实”“太有意思了”“让我们深入探讨”。
- 不虚构个人经历、嘉宾身份、研究数据或来源之外的事实。无法由来源支持的内容不要说。
- 不输出章节标题、项目符号、舞台说明、音效标记或面向读者的书面语。
- 单次发言通常为 1–3 句，适合直接朗读；不要让任何角色连续垄断多轮。
- tone 只能是 calm、happy、surprised、sad、angry、fearful 之一，并且只在语义确实需要时使用强情绪。

先在内部规划叙事弧和主题顺序，但不要输出规划。最终只输出合法 JSON：{"title":"...","lines":[{"speaker":"host|guest","text":"...","tone":"calm|happy|surprised|sad|angry|fearful"}]}。`;

interface MiniMaxBaseResponse {
  status_code?: number;
  status_msg?: string;
}

interface MiniMaxChatResponse {
  choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
  base_resp?: MiniMaxBaseResponse;
  input_sensitive?: boolean;
  output_sensitive?: boolean;
}

function assertBusinessSuccess(data: { base_resp?: MiniMaxBaseResponse }, operation: string): void {
  const code = data.base_resp?.status_code;
  if (code !== undefined && code !== 0) {
    const detail = data.base_resp?.status_msg?.trim() || "unknown provider error";
    throw new Error(`MiniMax ${operation} failed (${code}): ${detail}`);
  }
}

async function minimaxFetch(env: Env, path: string, init: RequestInit): Promise<Response> {
  const url = new URL(`${env.MINIMAX_API_BASE}${path}`);
  if (env.MINIMAX_GROUP_ID) url.searchParams.set("GroupId", env.MINIMAX_GROUP_ID);
  const response = await fetch(url, {
    ...init,
    headers: { "authorization": `Bearer ${env.MINIMAX_API_KEY}`, "content-type": "application/json", ...init.headers }
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`MiniMax request failed (${response.status}): ${detail}`);
  }
  return response;
}

export async function generateScript(env: Env, source: string, title: string, language: string, duration: number, style: string): Promise<PodcastScript> {
  const response = await minimaxFetch(env, "/chat/completions", { method: "POST", body: JSON.stringify({
    model: env.MINIMAX_TEXT_MODEL,
    messages: [{ role: "system", content: PODCAST_SYSTEM_PROMPT },
      { role: "user", content: `Title: ${title}\nLanguage: ${language}\nTarget minutes: ${duration}\nStyle: ${style}\nSource:\n${source.slice(0, 120000)}` }],
    temperature: 1,
    max_completion_tokens: 8192,
    reasoning_split: true
  }) });
  const data = await response.json<MiniMaxChatResponse>();
  assertBusinessSuccess(data, "script generation");
  const raw = data.choices?.[0]?.message?.content;
  if (!raw) {
    const reason = data.input_sensitive ? "input was rejected as sensitive" :
      data.output_sensitive ? "output was rejected as sensitive" :
      data.choices?.[0]?.finish_reason ? `finish reason: ${data.choices[0].finish_reason}` :
      "response contained no choices";
    throw new Error(`MiniMax returned an empty script (${reason})`);
  }
  const json = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const script = JSON.parse(json) as PodcastScript;
  if (!Array.isArray(script.lines) || script.lines.length === 0) throw new Error("MiniMax returned an invalid script");
  return script;
}

export async function synthesizeLine(env: Env, text: string, speaker: "host" | "guest", tone: PodcastTone = "calm"): Promise<Uint8Array> {
  const response = await minimaxFetch(env, "/t2a_v2", { method: "POST", body: JSON.stringify({
    model: env.MINIMAX_TTS_MODEL, text, stream: false, language_boost: "Chinese", output_format: "hex",
    voice_setting: { voice_id: speaker === "host" ? "Chinese (Mandarin)_Lyrical_Voice" : "Chinese (Mandarin)_Kind-hearted_Antie", speed: 1, vol: 1, pitch: 0, emotion: tone },
    audio_setting: { sample_rate: AUDIO_SAMPLE_RATE, format: "pcm", channel: 1 }
  }) });
  const data = await response.json<{ data?: { audio?: string }; base_resp?: MiniMaxBaseResponse }>();
  assertBusinessSuccess(data, "speech synthesis");
  const hex = data.data?.audio;
  if (!hex) throw new Error("MiniMax returned empty audio");
  const audio = Uint8Array.from(hex.match(/.{1,2}/g) ?? [], byte => Number.parseInt(byte, 16));
  return extractPcm16(audio);
}
