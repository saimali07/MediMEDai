import { errorResponse, handleCors, json, readJson, HttpError } from "../_shared/cors.ts";
import { authenticate, requireUser, type AuthCtx } from "../_shared/auth.ts";

const BUCKETS = ["assessment-images", "reports", "audio"] as const;

async function removeAllFiles(auth: AuthCtx, uid: string) {
  for (const bucket of BUCKETS) {
    for (let guard = 0; guard < 50; guard++) {
      const { data, error } = await auth.admin.storage.from(bucket).list(uid, { limit: 100 });
      if (error || !data || data.length === 0) break;
      const { error: rmErr } = await auth.admin.storage.from(bucket).remove(data.map((f: { name: string }) => `${uid}/${f.name}`));
      if (rmErr) break;
    }
  }
}

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  try {
    const auth = await authenticate(req);
    const user = requireUser(auth);
    const b = await readJson(req);
    const uid = user.id;

    if (b.all === true) {
      await removeAllFiles(auth, uid);
      const { error } = await auth.admin.from("assessments").delete().eq("user_id", uid); // cascades to chat_messages + reports
      if (error) throw new HttpError(500, "delete_failed", "Could not delete your data. Please try again.");
      await auth.admin.from("reports").delete().eq("user_id", uid);
      await auth.admin.from("rate_limits").delete().eq("key", `user:${uid}`);
      await auth.admin.from("profiles").update({ age: null, sex: null, consent_at: null }).eq("id", uid);
      return json({ deleted: "all" });
    }

    const id = typeof b.assessmentId === "string" ? b.assessmentId : "";
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "bad_request", "assessmentId is required.");
    const { data: a } = await auth.admin.from("assessments").select("id, image_paths, input").eq("id", id).eq("user_id", uid).maybeSingle();
    if (!a) throw new HttpError(404, "not_found", "Assessment not found.");
    const { data: reps } = await auth.admin.from("reports").select("file_path").eq("assessment_id", id).eq("user_id", uid);

    const own = (p: unknown): p is string => typeof p === "string" && p.startsWith(`${uid}/`) && !p.includes("..");
    const remove = async (bucket: typeof BUCKETS[number], paths: unknown[]) => {
      const ok = paths.filter(own);
      if (ok.length) await auth.admin.storage.from(bucket).remove(ok);
    };
    await remove("assessment-images", a.image_paths ?? []);
    await remove("audio", [a.input?.audio_path]);
    await remove("reports", [a.input?.report_path, ...(Array.isArray(a.input?.report_image_paths) ? a.input.report_image_paths : []), ...(reps ?? []).map((r: { file_path: string }) => r.file_path)]);

    const { error } = await auth.admin.from("assessments").delete().eq("id", id).eq("user_id", uid);
    if (error) throw new HttpError(500, "delete_failed", "Could not delete that assessment.");
    return json({ deleted: id });
  } catch (e) {
    return errorResponse(e);
  }
});
