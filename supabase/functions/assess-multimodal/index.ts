import { clampStr, errorResponse, handleCors, json, optEnum, optInt, readJson, HttpError } from "../_shared/cors.ts";
import { authenticate, requireUser } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { runAssessment, titleFrom } from "../_shared/pipeline.ts";
import { loadMedia, loadReportInputs, MAX_BYTES, whisperHint, type LoadedMedia, type MediaRef } from "../_shared/media.ts";
import { assertConfigured, transcribeAudio } from "../_shared/ai.ts";
import { normalizeLang } from "../_shared/safety.ts";

// Fuses typed details + photo(s) + voice (transcript or audio→Whisper) + optional lab report into ONE AI call.
// Groq vision accepts a few images per request, so photos + report pages are capped at 5 in total.
Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  try {
    const auth = await authenticate(req);
    requireUser(auth, "Please sign in to use combined assessments.");
    await enforceRateLimit(auth, req);
    const b = await readJson(req);

    const lang = normalizeLang(b.language);
    const hint = whisperHint(b.speech_lang);
    const symptoms = clampStr(b.symptoms, 2000);
    const duration = clampStr(b.duration, 120);
    const associated = clampStr(b.associated, 1500);
    const age = optInt(b.age, 0, 120);
    const sex = optEnum(b.sex, ["female", "male", "other"] as const);
    let transcript = clampStr(b.transcript, 6000);
    const images = Array.isArray(b.images) ? (b.images as MediaRef[]).slice(0, 3) : [];
    const audioRef = (b.audio && typeof b.audio === "object" ? b.audio : null) as MediaRef | null;
    const rep = await loadReportInputs(auth, b);
    const hasReport = !!rep.text || rep.images.length > 0;

    if (!symptoms && !images.length && !transcript && !audioRef && !hasReport) {
      throw new HttpError(400, "bad_request", "Add at least one input: text, a photo, a voice note or a report.");
    }
    assertConfigured();

    const media: LoadedMedia[] = [];
    const imagePaths: string[] = [];
    for (const [i, r] of images.entries()) {
      const m = await loadMedia(auth, r, { bucket: "assessment-images", kinds: ["image"], maxBytes: MAX_BYTES.image, label: `photo ${i + 1} of ${images.length}` });
      media.push(m);
      if (m.path) imagePaths.push(m.path);
    }
    media.push(...rep.images);
    if (media.length > 5) throw new HttpError(400, "too_many_images", "Please use at most 5 images in total (photos plus report pages).");

    let audioPath: string | undefined;
    if (!transcript && audioRef) {
      const a = await loadMedia(auth, audioRef, { bucket: "audio", kinds: ["audio"], maxBytes: MAX_BYTES.audio, label: "voice recording" });
      audioPath = a.path;
      transcript = (await transcribeAudio(a.part, hint)).trim();
    } else if (audioRef && typeof audioRef.path === "string") {
      audioPath = audioRef.path as string;
    }

    const details = [
      symptoms && `Main symptom: ${symptoms}`,
      duration && `Duration: ${duration}`,
      associated && `Other symptoms: ${associated}`,
      transcript && `Voice transcript: ${transcript}`,
      age !== null && `Age: ${age}`,
      sex && `Sex: ${sex}`,
      rep.text && `LAB REPORT TEXT (extracted from the file):\n${rep.text}`,
      `Inputs supplied: text=${!!symptoms}, photos=${images.length}, voice=${!!transcript}, lab report=${hasReport}`,
    ].filter(Boolean).join("\n");

    const out = await runAssessment({
      auth, type: "multimodal", lang, age, media, imagePaths, reportPath: rep.reportPath,
      title: titleFrom(symptoms || transcript, "Combined assessment"),
      safetyText: `${symptoms}\n${associated}\n${transcript}`,
      ragQuery: `${symptoms} ${associated} ${transcript}`,
      details,
      input: { symptoms, duration, associated, transcript, age, sex, language: lang, photo_count: images.length, has_report: hasReport, audio_path: audioPath ?? null, report_path: rep.reportPath ?? null, report_image_paths: rep.imagePaths },
    });
    return json(out);
  } catch (e) {
    return errorResponse(e);
  }
});
