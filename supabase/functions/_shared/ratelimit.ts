// Fixed-window rate limiting backed by the rate_limits table (atomic via bump_rate_limit()).
import { HttpError } from "./cors.ts";
import type { AuthCtx } from "./auth.ts";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

export async function enforceRateLimit(auth: AuthCtx, req: Request, opts: { allowGuest?: boolean } = {}) {
  let key: string;
  let limit: number;
  let windowMs: number;

  if (auth.user) {
    key = `user:${auth.user.id}`;
    limit = Number(Deno.env.get("RATE_LIMIT_PER_HOUR") ?? 20);
    windowMs = 60 * 60 * 1000;
  } else {
    if (!opts.allowGuest) throw new HttpError(401, "auth_required", "Please sign in to use this feature.");
    const ip = (req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown").split(",")[0].trim();
    key = `guest:${await sha256Hex(ip)}`; // the raw IP is never stored
    limit = 1; // one trial assessment per day
    windowMs = 24 * 60 * 60 * 1000;
  }

  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const { data, error } = await auth.admin.rpc("bump_rate_limit", { p_key: key, p_window: windowStart.toISOString() });
  if (error) throw new HttpError(503, "rate_limit_unavailable", "Rate limiter is unavailable. Check that the database migrations were applied.");

  if (typeof data === "number" && data > limit) {
    const retry = Math.max(1, Math.ceil((windowStart.getTime() + windowMs - Date.now()) / 1000));
    const msg = auth.user
      ? "You have reached the hourly limit. Please try again later."
      : "The free guest trial has been used. Create a free account to continue.";
    throw new HttpError(429, auth.user ? "rate_limited" : "guest_trial_used", msg, { retry_after_seconds: retry });
  }
}
