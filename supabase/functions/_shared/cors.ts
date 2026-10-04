// CORS + small HTTP helpers shared by every Edge Function.

export const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

export class HttpError extends Error {
  status: number;
  code: string;
  extra?: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function handleCors(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response("ok", { headers: corsHeaders }) : null;
}

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", ...extraHeaders },
  });
}

/** Clean JSON error. Never logs request bodies, medical content or keys — only the error code. */
export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    const headers: Record<string, string> = {};
    const retry = e.extra?.retry_after_seconds;
    if (typeof retry === "number") headers["Retry-After"] = String(retry);
    return json({ error: e.message, code: e.code, ...(e.extra ?? {}) }, e.status, headers);
  }
  console.error("unhandled_error", (e as Error)?.name ?? "unknown");
  return json({ error: "Something went wrong on the server. Please try again.", code: "internal" }, 500);
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 20 * 1024 * 1024) throw new HttpError(413, "too_large", "Request is too large.");
  try {
    const body = await req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch { /* fall through */ }
  throw new HttpError(400, "bad_json", "Request body must be a JSON object.");
}

export function clampStr(x: unknown, max: number): string {
  return typeof x === "string" ? x.trim().slice(0, max) : "";
}

export function optInt(x: unknown, min: number, max: number): number | null {
  const n = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
}

export function optEnum<T extends string>(x: unknown, allowed: readonly T[]): T | null {
  return typeof x === "string" && (allowed as readonly string[]).includes(x) ? (x as T) : null;
}
