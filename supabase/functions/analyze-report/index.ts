import { clampStr, errorResponse, handleCors, json, optInt, readJson, HttpError } from "../_shared/cors.ts";
import { authenticate, requireUser } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { runAssessment, titleFrom } from "../_shared/pipeline.ts";
import { loadReportInputs } from "../_shared/media.ts";
import { normalizeLang } from "../_shared/safety.ts";

// Input: report_text (extracted from a PDF in the browser) and/or report_images (rendered pages / photo, in the 'reports' bucket).
// The model reads them and returns each test with value, range, flag and plain-language meaning.
Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  try {
    const auth = await authenticate(req);
    requireUser(auth, "Please sign in to analyze lab reports.");
    await enforceRateLimit(auth, req);
    const b = await readJson(req);

    const notes = clampStr(b.notes, 1500);
    const age = optInt(b.age, 0, 120);
    const lang = normalizeLang(b.language);
    const rep = await loadReportInputs(auth, b);
    if (!rep.text && !rep.images.length) throw new HttpError(400, "bad_request", "No readable report content was received. Upload a PDF with selectable text, or a clear photo/scan.");

    const out = await runAssessment({
      auth, type: "report", lang, age, media: rep.images, reportPath: rep.reportPath,
      title: "Lab report",
      safetyText: notes,
      ragQuery: `${notes} laboratory test results reference ranges interpretation`,
      details: [notes && `Notes from the user: ${notes}`, age !== null && `Age: ${age}`, rep.text && `LAB REPORT TEXT (extracted from the file):\n${rep.text}`, rep.images.length && `Report page images attached: ${rep.images.length}`].filter(Boolean).join("\n"),
      input: { notes, age, language: lang, report_path: rep.reportPath ?? null, report_image_paths: rep.imagePaths, had_text: !!rep.text },
    });
    if (out.id) {
      const rt = (out.result as { report_type?: string }).report_type;
      if (rt) await auth.admin.from("assessments").update({ title: titleFrom(`Lab report: ${rt}`, "Lab report") }).eq("id", out.id).eq("user_id", auth.user!.id);
    }
    return json(out);
  } catch (e) {
    return errorResponse(e);
  }
});
