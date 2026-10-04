import { clampStr, errorResponse, handleCors, json, optEnum, optInt, readJson, HttpError } from "../_shared/cors.ts";
import { authenticate, requireUser } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { runAssessment, titleFrom } from "../_shared/pipeline.ts";
import { loadMedia, MAX_BYTES, type MediaRef } from "../_shared/media.ts";
import { normalizeLang } from "../_shared/safety.ts";

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  try {
    const auth = await authenticate(req);
    requireUser(auth, "Please sign in to upload photos.");
    await enforceRateLimit(auth, req);
    const b = await readJson(req);

    const refs = Array.isArray(b.images) ? (b.images as MediaRef[]).slice(0, 4) : [];
    if (!refs.length) throw new HttpError(400, "bad_request", "Please add at least one photo.");
    const description = clampStr(b.description, 2000);
    const age = optInt(b.age, 0, 120);
    const sex = optEnum(b.sex, ["female", "male", "other"] as const);
    const lang = normalizeLang(b.language);

    const media = [];
    for (const [i, r] of refs.entries()) {
      media.push(await loadMedia(auth, r, { bucket: "assessment-images", kinds: ["image"], maxBytes: MAX_BYTES.image, label: `photo ${i + 1} of ${refs.length}` }));
    }

    const out = await runAssessment({
      auth, type: "image", lang, age, media,
      title: titleFrom(description, "Photo assessment"),
      safetyText: description,
      ragQuery: description || "skin rash swelling wound visible symptoms",
      details: [description && `Description: ${description}`, age !== null && `Age: ${age}`, sex && `Sex: ${sex}`, `Number of photos: ${media.length}`].filter(Boolean).join("\n"),
      input: { description, age, sex, language: lang, photo_count: media.length },
      imagePaths: media.map((m) => m.path).filter((p): p is string => !!p),
    });
    return json(out);
  } catch (e) {
    return errorResponse(e);
  }
});
