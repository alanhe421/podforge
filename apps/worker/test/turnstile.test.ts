import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstile } from "../src/turnstile";
import type { Env } from "../src/types";

const env = {
  TURNSTILE_SECRET: "secret",
  TURNSTILE_HOSTNAMES: "podforge.example,localhost"
} as Env;

afterEach(() => vi.unstubAllGlobals());

describe("Turnstile validation", () => {
  it("accepts a valid token for the expected action and hostname", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true, action: "turnstile-spin-v2", hostname: "podforge.example"
    }), { headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);

    await expect(verifyTurnstile(new Request("https://podforge.example/api/jobs", {
      headers: { "CF-Connecting-IP": "203.0.113.10" }
    }), env, "token")).resolves.toBe(true);
    const body = fetch.mock.calls[0][1].body as URLSearchParams;
    expect(body.get("remoteip")).toBe("203.0.113.10");
    expect(body.get("secret")).toBe("secret");
  });

  it.each([
    { success: false, action: "turnstile-spin-v2", hostname: "podforge.example" },
    { success: true, action: "another-action", hostname: "podforge.example" },
    { success: true, action: "turnstile-spin-v2", hostname: "attacker.example" }
  ])("rejects invalid verification data", async result => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(result))));
    await expect(verifyTurnstile(new Request("https://podforge.example/api/jobs"), env, "token")).resolves.toBe(false);
  });

  it("fails closed when configuration or Siteverify is unavailable", async () => {
    await expect(verifyTurnstile(new Request("https://podforge.example/api/jobs"), { ...env, TURNSTILE_SECRET: "" }, "token")).resolves.toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network error")));
    await expect(verifyTurnstile(new Request("https://podforge.example/api/jobs"), env, "token")).resolves.toBe(false);
  });
});
