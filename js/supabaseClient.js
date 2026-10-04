import { createClient } from "./vendor/supabase.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const isConfigured = !/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY);

export const supabase = createClient(
  isConfigured ? SUPABASE_URL : "https://not-configured.invalid",
  isConfigured ? SUPABASE_ANON_KEY : "not-configured",
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);
