import { supabase } from "./supabaseClient.js";
import { getUser } from "./auth.js";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "unknown", safety = null } = {}) {
    super(message);
    this.status = status; this.code = code; this.safety = safety;
  }
}

/** Calls a Supabase Edge Function and normalises errors (including the safety payload). */
export async function callFn(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data;
  let payload = null;
  try { payload = await error.context.json(); } catch { /* network error or non-JSON */ }
  throw new ApiError(
    payload?.error || "Could not reach the server. Check your connection and try again.",
    { status: error.context?.status ?? 0, code: payload?.code ?? "network", safety: payload?.safety ?? null },
  );
}

const EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf", "audio/wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/aac": "aac", "audio/ogg": "ogg", "audio/flac": "flac", "audio/webm": "webm", "audio/mp4": "m4a" };

/** Uploads to a private bucket under  <user_id>/<uuid>.<ext>  (storage policies enforce the folder). */
export async function uploadFile(bucket, blob, contentType = blob.type) {
  const user = await getUser();
  if (!user) throw new ApiError("Please sign in first.", { status: 401, code: "auth_required" });
  const ext = EXT[contentType] || "bin";
  const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(path, blob, { contentType, upsert: false });
  if (error) throw new ApiError(`Upload failed: ${error.message}`, { code: "upload_failed" });
  return path;
}
export async function removeFiles(bucket, paths) {
  if (paths?.length) await supabase.storage.from(bucket).remove(paths).catch(() => {});
}
export async function signedUrl(bucket, path, seconds = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, seconds);
  return error ? null : data.signedUrl;
}

export async function listAssessments() {
  const { data, error } = await supabase.from("assessments").select("id,type,title,urgency,created_at").order("created_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(error.message);
  return data;
}
export async function getAssessment(id) {
  const { data, error } = await supabase.from("assessments").select("*").eq("id", id).maybeSingle();
  if (error) throw new ApiError(error.message);
  return data;
}
export async function listChat(assessmentId) {
  const { data, error } = await supabase.from("chat_messages").select("role,content,created_at").eq("assessment_id", assessmentId).order("created_at");
  if (error) throw new ApiError(error.message);
  return data;
}
export const deleteAssessment = (assessmentId) => callFn("delete-my-data", { assessmentId });
export const deleteAllData = () => callFn("delete-my-data", { all: true });

/** Records that the user consented to AI processing of uploads (stored locally and on their profile). */
export async function recordConsent() {
  localStorage.setItem("medimind_consent", "1");
  const user = await getUser();
  if (user) await supabase.from("profiles").update({ consent_at: new Date().toISOString() }).eq("id", user.id);
}
export const hasConsent = () => localStorage.getItem("medimind_consent") === "1";
