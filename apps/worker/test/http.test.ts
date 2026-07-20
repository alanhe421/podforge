import { describe, expect, it, vi } from "vitest";
import { assertSameOrigin, json, withCors } from "../src/http";
import { cancelJob } from "../src/index";
import type { Env } from "../src/types";

function cancelEnv(status: string, changes = 1): Env {
  return {
    WEB_ORIGIN: "https://web.example",
    DB: {
      prepare: vi.fn((sql: string) => ({
        bind: vi.fn(() => ({
          first: vi.fn(async () => sql.includes("FROM sessions") ? ({ id: "user-1", email: "user@example.com", name: "User", picture: null }) : ({ status })),
          run: vi.fn(async () => ({ meta: { changes } }))
        }))
      }))
    }
  } as unknown as Env;
}

describe("HTTP helpers", () => {
  it("accepts a same-origin mutation", () => {
    const request = new Request("https://podforge.example/api/jobs", { headers: { origin: "https://podforge.example" } });
    expect(assertSameOrigin(request, "https://web.example")).toBe(true);
  });

  it("rejects a cross-origin mutation", () => {
    const request = new Request("https://podforge.example/api/jobs", { headers: { origin: "https://attacker.example" } });
    expect(assertSameOrigin(request, "https://web.example")).toBe(false);
  });

  it("accepts the configured Pages origin and adds CORS headers", () => {
    const request = new Request("https://api.example/api/jobs", { headers: { origin: "https://web.example" } });
    expect(assertSameOrigin(request, "https://web.example")).toBe(true);
    expect(withCors(json({ ok: true }), request, "https://web.example").headers.get("access-control-allow-origin")).toBe("https://web.example");
  });

  it("marks API JSON as private and non-cacheable", () => {
    const response = json({ ok: true }, 202);
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("requires authentication before canceling a job", async () => {
    const response = await cancelJob("11111111-1111-1111-1111-111111111111", new Request("https://api.example/api/jobs/11111111-1111-1111-1111-111111111111/cancel", { method: "POST", headers: { origin: "https://web.example" } }), cancelEnv("processing"));
    expect(response.status).toBe(401);
  });

  it("cancels a processing job", async () => {
    const env = cancelEnv("processing");
    const response = await cancelJob("11111111-1111-1111-1111-111111111111", new Request("https://api.example/api/jobs/11111111-1111-1111-1111-111111111111/cancel", {
      method: "POST", headers: { origin: "https://web.example", cookie: "podforge_session=test-session" }
    }), env);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ id: "11111111-1111-1111-1111-111111111111", status: "canceled" });
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining("status='canceled'"));
  });

  it("does not cancel a completed job", async () => {
    const response = await cancelJob("11111111-1111-1111-1111-111111111111", new Request("https://api.example/api/jobs/11111111-1111-1111-1111-111111111111/cancel", {
      method: "POST", headers: { origin: "https://web.example", cookie: "podforge_session=test-session" }
    }), cancelEnv("completed"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "当前任务无法取消" });
  });
});
