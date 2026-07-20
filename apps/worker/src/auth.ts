import { createRemoteJWKSet, jwtVerify } from "jose";
import { errorResponse, json } from "./http";
import type { Env, User } from "./types";

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const SESSION_COOKIE = "podforge_session";
const OAUTH_COOKIE = "podforge_oauth";
const SESSION_SECONDS = 60 * 60 * 24 * 30;

function encode(value: Uint8Array): string { return btoa(String.fromCharCode(...value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function randomToken(size = 32): string { const value = new Uint8Array(size); crypto.getRandomValues(value); return encode(value); }
async function sha256(value: string): Promise<string> { return encode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
function cookies(request: Request): Map<string, string> { return new Map((request.headers.get("cookie") ?? "").split(";").map(part => part.trim().split("=", 2)).filter(pair => pair.length === 2) as [string, string][]); }
function cookie(name: string, value: string, maxAge: number, secure: boolean): string { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`; }
function redirect(location: string): Response { return new Response(null, { status: 302, headers: { location } }); }
function appOrigin(request: Request, env: Env): string { const origin = new URL(request.url).origin; return origin.includes("localhost") ? env.WEB_ORIGIN : origin; }

export async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = cookies(request).get(SESSION_COOKIE); if (!token) return null;
  return env.DB.prepare(`SELECT users.id,users.email,users.name,users.picture FROM sessions JOIN users ON users.id=sessions.user_id WHERE sessions.token_hash=? AND sessions.expires_at>?`).bind(await sha256(token), new Date().toISOString()).first<User>();
}
export async function requireUser(request: Request, env: Env): Promise<User | Response> { return (await currentUser(request, env)) ?? errorResponse("请先使用 Google 登录", 401); }

export async function beginGoogleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return errorResponse("Google 登录尚未配置", 503);
  const state = randomToken(), verifier = randomToken(48), origin = appOrigin(request, env);
  const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${origin}/api/auth/google/callback`, response_type: "code", scope: "openid email profile", state, code_challenge: await sha256(verifier), code_challenge_method: "S256", prompt: "select_account" });
  const response = redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  response.headers.append("set-cookie", cookie(OAUTH_COOKIE, `${state}.${verifier}`, 600, origin.startsWith("https:")));
  return response;
}

export async function finishGoogleLogin(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url), origin = appOrigin(request, env);
  const [expectedState, verifier] = (cookies(request).get(OAUTH_COOKIE) ?? "").split(".");
  if (url.searchParams.get("error")) return redirect(`${origin}/?auth_error=cancelled`);
  const code = url.searchParams.get("code");
  if (!code || !expectedState || !verifier || url.searchParams.get("state") !== expectedState) return errorResponse("Google 登录请求无效", 400);
  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: `${origin}/api/auth/google/callback`, grant_type: "authorization_code", code_verifier: verifier }) });
  if (!tokenResponse.ok) return errorResponse("Google 登录失败", 401);
  const tokens = await tokenResponse.json<{ id_token?: string }>(); if (!tokens.id_token) return errorResponse("Google 登录响应无效", 401);
  const { payload } = await jwtVerify(tokens.id_token, googleKeys, { audience: env.GOOGLE_CLIENT_ID, issuer: ["https://accounts.google.com", "accounts.google.com"] });
  if (!payload.sub || !payload.email || payload.email_verified !== true) return errorResponse("Google 账号未通过验证", 401);
  const now = new Date().toISOString(), existing = await env.DB.prepare("SELECT id FROM users WHERE google_sub=?").bind(payload.sub).first<{ id: string }>(), userId = existing?.id ?? crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users (id,google_sub,email,name,picture,created_at,updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(google_sub) DO UPDATE SET email=excluded.email,name=excluded.name,picture=excluded.picture,updated_at=excluded.updated_at`).bind(userId, payload.sub, payload.email, String(payload.name ?? payload.email), typeof payload.picture === "string" ? payload.picture : null, now, now).run();
  const session = randomToken(), expires = new Date(Date.now() + SESSION_SECONDS * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)").bind(await sha256(session), userId, expires, now).run();
  const response = redirect(origin);
  response.headers.append("set-cookie", cookie(SESSION_COOKIE, session, SESSION_SECONDS, origin.startsWith("https:")));
  response.headers.append("set-cookie", cookie(OAUTH_COOKIE, "", 0, origin.startsWith("https:")));
  return response;
}
export async function authStatus(request: Request, env: Env): Promise<Response> { return json({ user: await currentUser(request, env) }); }
export async function logout(request: Request, env: Env): Promise<Response> { const token = cookies(request).get(SESSION_COOKIE); if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash=?").bind(await sha256(token)).run(); const response = json({ ok: true }); response.headers.append("set-cookie", cookie(SESSION_COOKIE, "", 0, new URL(request.url).protocol === "https:")); return response; }
