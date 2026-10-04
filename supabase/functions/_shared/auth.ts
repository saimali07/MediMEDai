// JWT verification. Functions are deployed with verify_jwt = false (see supabase/config.toml)
// so that guests (anon key / publishable key) can reach the one trial path; every function
// calls authenticate() and decides for itself whether a guest is allowed.
import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";
import { HttpError } from "./cors.ts";

export interface AuthCtx {
  user: User | null;
  /** Service-role client. Always scope queries by the verified user id. */
  admin: SupabaseClient;
}

export async function authenticate(req: Request): Promise<AuthCtx> {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) throw new HttpError(500, "server_misconfigured", "Server is missing Supabase credentials.");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();

  let user: User | null = null;
  if (token && token.split(".").length === 3) {
    const { data, error } = await admin.auth.getUser(token);
    if (!error && data.user) user = data.user;
  }
  return { user, admin };
}

export function requireUser(auth: AuthCtx, message = "Please sign in to use this feature."): User {
  if (!auth.user) throw new HttpError(401, "auth_required", message);
  return auth.user;
}
