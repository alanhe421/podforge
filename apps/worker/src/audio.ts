import type { DialogueLine } from "./types";

export const AUDIO_SAMPLE_RATE = 32000;
export const AUDIO_CHANNELS = 1;
export const AUDIO_BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = AUDIO_BITS_PER_SAMPLE / 8;

export interface StoredAudioPart {
  key: string;
  byteLength: number;
  pauseMs: number;
}

const ascii = (view: Uint8Array, offset: number, length: number) =>
  String.fromCharCode(...view.subarray(offset, offset + length));

export function extractPcm16(audio: Uint8Array): Uint8Array {
  if (audio.byteLength >= 12 && ascii(audio, 0, 4) === "RIFF" && ascii(audio, 8, 4) === "WAVE") {
    const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
    let offset = 12;
    while (offset + 8 <= audio.byteLength) {
      const chunkId = ascii(audio, offset, 4);
      const chunkLength = view.getUint32(offset + 4, true);
      const dataStart = offset + 8;
      if (chunkId === "data" && dataStart + chunkLength <= audio.byteLength) {
        return audio.slice(dataStart, dataStart + chunkLength);
      }
      offset = dataStart + chunkLength + (chunkLength % 2);
    }
    throw new Error("MiniMax returned WAV audio without a data chunk");
  }
  if (audio.byteLength % BYTES_PER_SAMPLE !== 0) throw new Error("MiniMax returned malformed PCM audio");
  return audio;
}

export function fadePcmEdges(pcm: Uint8Array, fadeMs = 8): Uint8Array {
  const result = pcm.slice();
  const sampleCount = result.byteLength / BYTES_PER_SAMPLE;
  const fadeSamples = Math.min(Math.round(AUDIO_SAMPLE_RATE * fadeMs / 1000), Math.floor(sampleCount / 2));
  const view = new DataView(result.buffer, result.byteOffset, result.byteLength);
  for (let index = 0; index < fadeSamples; index += 1) {
    const gain = (index + 1) / fadeSamples;
    const start = view.getInt16(index * BYTES_PER_SAMPLE, true);
    const endOffset = (sampleCount - index - 1) * BYTES_PER_SAMPLE;
    const end = view.getInt16(endOffset, true);
    view.setInt16(index * BYTES_PER_SAMPLE, Math.round(start * gain), true);
    view.setInt16(endOffset, Math.round(end * gain), true);
  }
  return result;
}

export function pauseAfter(line: DialogueLine, next?: DialogueLine): number {
  if (!next) return 450;
  if (line.speaker === next.speaker) return 140;
  if (/[?？]\s*$/.test(line.text)) return 340;
  if (/[!！…]\s*$/.test(line.text)) return 280;
  return 220;
}

export function silenceByteLength(milliseconds: number): number {
  const frames = Math.round(AUDIO_SAMPLE_RATE * milliseconds / 1000);
  return frames * AUDIO_CHANNELS * BYTES_PER_SAMPLE;
}

export function wavHeader(dataByteLength: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) header[offset + index] = value.charCodeAt(index);
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataByteLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, AUDIO_CHANNELS, true);
  view.setUint32(24, AUDIO_SAMPLE_RATE, true);
  view.setUint32(28, AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(32, AUDIO_CHANNELS * BYTES_PER_SAMPLE, true);
  view.setUint16(34, AUDIO_BITS_PER_SAMPLE, true);
  writeAscii(36, "data");
  view.setUint32(40, dataByteLength, true);
  return header;
}

export async function storePodcastWav(bucket: R2Bucket, key: string, parts: StoredAudioPart[]): Promise<void> {
  const dataByteLength = parts.reduce((total, part) => total + part.byteLength + silenceByteLength(part.pauseMs), 0);
  const stream = new FixedLengthStream(44 + dataByteLength);
  const upload = bucket.put(key, stream.readable, {
    httpMetadata: { contentType: "audio/wav", contentDisposition: `attachment; filename="${key.split("/").at(-1)}"` }
  });
  const writer = stream.writable.getWriter();
  try {
    await writer.write(wavHeader(dataByteLength));
    for (const part of parts) {
      const object = await bucket.get(part.key);
      if (!object) throw new Error("Temporary audio segment is missing");
      const reader = object.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          await writer.write(value);
        }
      } finally {
        reader.releaseLock();
      }
      const silence = silenceByteLength(part.pauseMs);
      if (silence > 0) await writer.write(new Uint8Array(silence));
    }
    await writer.close();
    await upload;
  } catch (cause) {
    await writer.abort(cause).catch(() => undefined);
    await upload.catch(() => undefined);
    throw cause;
  }
}
