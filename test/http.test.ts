import { describe, expect, it } from "vitest";
import { assertSameOrigin, json } from "../src/http";

describe("HTTP helpers", () => {
  it("accepts a same-origin mutation", () => {
    const request = new Request("https://podforge.example/api/jobs", { headers: { origin: "https://podforge.example" } });
    expect(assertSameOrigin(request)).toBe(true);
  });

  it("rejects a cross-origin mutation", () => {
    const request = new Request("https://podforge.example/api/jobs", { headers: { origin: "https://attacker.example" } });
    expect(assertSameOrigin(request)).toBe(false);
  });

  it("marks API JSON as private and non-cacheable", () => {
    const response = json({ ok: true }, 202);
    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
