export const json = (value: unknown, status = 200): Response => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

export const errorResponse = (message: string, status = 400): Response => json({ error: message }, status);

export function assertSameOrigin(request: Request, allowedOrigin: string): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  return origin === new URL(request.url).origin || origin === allowedOrigin;
}

export function withCors(response: Response, request: Request, allowedOrigin: string): Response {
  if (request.headers.get("origin") !== allowedOrigin) return response;
  const result = new Response(response.body, response);
  result.headers.set("access-control-allow-origin", allowedOrigin);
  result.headers.set("access-control-allow-credentials", "true");
  result.headers.set("vary", "Origin");
  return result;
}
