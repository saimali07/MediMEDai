import { supabase } from "./supabaseClient.js";

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}
export async function getUser() { return (await getSession())?.user ?? null; }

/** Only allow same-site relative redirects (prevents open-redirect abuse of ?next=). */
export function safeNext(raw, fallback = "dashboard.html") {
  if (!raw) return fallback;
  return /^[a-z0-9_\-./?=&%]+$/i.test(raw) && !raw.startsWith("/") && !raw.includes("..") && !raw.includes(":") ? raw : fallback;
}

/** Redirects to login if there is no session; resolves with the user otherwise. */
export async function requireAuth() {
  const user = await getUser();
  if (!user) {
    const here = location.pathname.split("/").pop() || "index.html";
    location.replace(`login.html?next=${encodeURIComponent(here + location.search)}`);
    return new Promise(() => {}); // never resolves; the page is navigating away
  }
  return user;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name }, emailRedirectTo: new URL("login.html", location.href).href },
  });
  if (error) throw error;
  return data; // data.session is null when email confirmation is required
}
export async function signOut() { await supabase.auth.signOut(); }
