import { afterEach, describe, expect, it, vi } from "vitest";
import { generateScript, synthesizeLine } from "../src/minimax";
import type { Env } from "../src/types";

const env = {
  MINIMAX_API_BASE: "https://api.minimaxi.com/v1",
  MINIMAX_API_KEY: "test-key",
  MINIMAX_TEXT_MODEL: "MiniMax-M3"
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe("MiniMax script generation", () => {
  it("uses the Token Plan OpenAI-compatible endpoint and model", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      choices: [{ finish_reason: "stop", message: { content: "```json\n{\"title\":\"title\",\"lines\":[{\"speaker\":\"host\",\"text\":\"hello\"}]}\n```" } }],
      base_resp: { status_code: 0, status_msg: "" }
    }));
    vi.stubGlobal("fetch", fetch);

    await expect(generateScript(env, "source", "title", "zh-CN", 8, "轻松科普"))
      .resolves.toMatchObject({ title: "title", lines: [{ speaker: "host", text: "hello" }] });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.minimaxi.com/v1/chat/completions");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "MiniMax-M3",
      temperature: 1,
      max_completion_tokens: 8192,
      reasoning_split: true
    });
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
    expect(request.messages[0].content).toContain("不是把摘要轮流分配给两个人朗读");
    expect(request.messages[0].content).toContain("至少安排两次真实的澄清");
    expect(request.messages[1].content).toContain("约 2560 个中文字符");
  });

  it("surfaces provider business errors returned with HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      base_resp: { status_code: 1008, status_msg: "Insufficient balance" }
    })));

    await expect(generateScript(env, "source", "title", "zh-CN", 8, "轻松科普"))
      .rejects.toThrow("MiniMax script generation failed (1008): Insufficient balance");
  });

  it("requests emotional PCM for lossless podcast assembly", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({
      data: { audio: "0102feff" },
      base_resp: { status_code: 0, status_msg: "success" }
    }));
    vi.stubGlobal("fetch", fetch);

    await expect(synthesizeLine(env, "欢迎回来", "host", "happy"))
      .resolves.toEqual(new Uint8Array([1, 2, 254, 255]));

    const [url, init] = fetch.mock.calls[0];
    expect(String(url)).toBe("https://api.minimaxi.com/v1/t2a_v2");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      stream: false,
      output_format: "hex",
      voice_setting: { emotion: "happy" },
      audio_setting: { sample_rate: 32000, format: "pcm", channel: 1 }
    });
  });

  it("explains an empty response rejected by content filtering", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      choices: [{ finish_reason: "content_filter", message: { content: "" } }],
      output_sensitive: true,
      base_resp: { status_code: 0, status_msg: "" }
    })));

    await expect(generateScript(env, "source", "title", "zh-CN", 8, "轻松科普"))
      .rejects.toThrow("MiniMax returned an empty script (output was rejected as sensitive)");
  });
});
