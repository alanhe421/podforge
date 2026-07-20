import type { Env, PodcastScript } from "./types";

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
    messages: [{ role: "system", content: "You create factual two-person podcast scripts. Return JSON only: {title,lines:[{speaker:'host'|'guest',text,tone}]}. Never invent facts absent from the source." },
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

export async function synthesizeLine(env: Env, text: string, speaker: "host" | "guest"): Promise<Uint8Array> {
  const response = await minimaxFetch(env, "/t2a_v2", { method: "POST", body: JSON.stringify({
    model: env.MINIMAX_TTS_MODEL, text,
    voice_setting: { voice_id: speaker === "host" ? "Chinese (Mandarin)_Lyrical_Voice" : "Chinese (Mandarin)_Kind-hearted_Antie", speed: 1, vol: 1, pitch: 0 },
    audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 }
  }) });
  const data = await response.json<{ data?: { audio?: string }; base_resp?: MiniMaxBaseResponse }>();
  assertBusinessSuccess(data, "speech synthesis");
  const hex = data.data?.audio;
  if (!hex) throw new Error("MiniMax returned empty audio");
  return Uint8Array.from(hex.match(/.{1,2}/g) ?? [], byte => Number.parseInt(byte, 16));
}
