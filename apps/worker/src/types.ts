export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  JOBS: Queue<JobMessage>;
  MINIMAX_API_KEY: string;
  MINIMAX_GROUP_ID?: string;
  MINIMAX_API_BASE: string;
  MINIMAX_TEXT_MODEL: string;
  MINIMAX_TTS_MODEL: string;
  MAX_UPLOAD_BYTES: string;
  WEB_ORIGIN: string;
}

export interface JobMessage { jobId: string }
export interface JobRow {
  id: string; title: string; language: string; duration: number; style: string;
  status: string; progress: number; stage: string; error: string | null;
  script: string | null; audio_key: string | null; input_keys: string;
  created_at: string; updated_at: string;
}
export type PodcastTone = "calm" | "happy" | "surprised" | "sad" | "angry" | "fearful";
export interface DialogueLine { speaker: "host" | "guest"; text: string; tone?: PodcastTone }
export interface PodcastScript { title: string; lines: DialogueLine[] }
