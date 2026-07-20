import { afterEach, describe, expect, it, vi } from "vitest";
import { generateScript } from "../src/minimax";
import type { Env } from "../src/types";

const env = {
  MINIMAX_API_BASE: "https://api.minimax.io/v1",
  MINIMAX_API_KEY: "test-key",
  MINIMAX_TEXT_MODEL: "MiniMax-Text-01"
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe("MiniMax script generation", () => {
  it("surfaces provider business errors returned with HTTP 200", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      base_resp: { status_code: 1008, status_msg: "Insufficient balance" }
    })));

    await expect(generateScript(env, "source", "title", "zh-CN", 8, "轻松科普"))
      .rejects.toThrow("MiniMax script generation failed (1008): Insufficient balance");
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
