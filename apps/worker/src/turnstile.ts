import type { Env } from "./types";

interface TurnstileResult {
  success: boolean;
  action?: string;
  hostname?: string;
  "error-codes"?: string[];
}

export async function verifyTurnstile(request: Request, env: Env, token: FormDataEntryValue | null): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || typeof token !== "string" || !token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET, response: token, idempotency_key: crypto.randomUUID() });
  const remoteIp = request.headers.get("CF-Connecting-IP");
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) return false;
    const result = await response.json<TurnstileResult>();
    const hostnames = env.TURNSTILE_HOSTNAMES.split(",").map(value => value.trim()).filter(Boolean);
    return result.success === true && result.action === "turnstile-spin-v2" && !!result.hostname && hostnames.includes(result.hostname);
  } catch {
    return false;
  }
}
