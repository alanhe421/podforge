import { describe, expect, it } from "vitest";
import { AUDIO_SAMPLE_RATE, extractPcm16, fadePcmEdges, pauseAfter, silenceByteLength, wavHeader } from "../src/audio";

describe("podcast audio assembly", () => {
  it("creates a valid mono 16-bit PCM WAV header", () => {
    const header = wavHeader(64000);
    const view = new DataView(header.buffer);
    expect(new TextDecoder().decode(header.subarray(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(header.subarray(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(AUDIO_SAMPLE_RATE);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(64000);
  });

  it("extracts PCM samples from a WAV response", () => {
    const pcm = new Uint8Array([1, 2, 3, 4]);
    const header = wavHeader(pcm.byteLength);
    const wav = new Uint8Array(header.byteLength + pcm.byteLength);
    wav.set(header);
    wav.set(pcm, header.byteLength);
    expect([...extractPcm16(wav)]).toEqual([...pcm]);
  });

  it("uses conversational pauses at speaker boundaries", () => {
    const host = { speaker: "host" as const, text: "真的会这样吗？" };
    const guest = { speaker: "guest" as const, text: "资料里给出了答案。" };
    expect(pauseAfter(host, guest)).toBe(340);
    expect(pauseAfter(guest, { ...guest, text: "还有一个例子。" })).toBe(140);
    expect(silenceByteLength(1000)).toBe(AUDIO_SAMPLE_RATE * 2);
  });

  it("fades the edges without changing PCM length", () => {
    const pcm = new Uint8Array(2000);
    const view = new DataView(pcm.buffer);
    for (let offset = 0; offset < pcm.byteLength; offset += 2) view.setInt16(offset, 10000, true);
    const faded = fadePcmEdges(pcm);
    const fadedView = new DataView(faded.buffer);
    expect(faded.byteLength).toBe(pcm.byteLength);
    expect(fadedView.getInt16(0, true)).toBeLessThan(10000);
    expect(fadedView.getInt16(1000, true)).toBe(10000);
    expect(fadedView.getInt16(1998, true)).toBeLessThan(10000);
  });
});
