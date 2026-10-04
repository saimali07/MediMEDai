import { clampStr, errorResponse, handleCors, json, optEnum, optInt, readJson } from "../_shared/cors.ts";
import { authenticate } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { runAssessment, titleFrom } from "../_shared/pipeline.ts";
import { normalizeLang } from "../_shared/safety.ts";
import { HttpError } from "../_shared/cors.ts";

// Guests may use ONLY this function, once (rate-limited by hashed IP, 1/day). Guest results are not stored.
Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  try {
    const auth = await authenticate(req);
    await enforceRateLimit(auth, req, { allowGuest: true });
    const b = await readJson(req);

    const symptoms = clampStr(b.symptoms, 2000);
    if (!symptoms) throw new HttpError(400, "bad_request", "Please describe your main symptom.");
    const duration = clampStr(b.duration, 120);
    const severity = optInt(b.severity, 1, 10);
    const associated = clampStr(b.associated, 1500);
    const age = optInt(b.age, 0, 120);
    const sex = optEnum(b.sex, ["female", "male", "other"] as const);
    const conditions = clampStr(b.conditions, 600);
    const medications = clampStr(b.medications, 600);
    const allergies = clampStr(b.allergies, 400);
    const lang = normalizeLang(b.language);

    const details = [
      `Main symptom: ${symptoms}`,
      duration && `Duration: ${duration}`,
      severity !== null && `Discomfort level: ${severity}/10`,
      associated && `Other symptoms: ${associated}`,
      age !== null && `Age: ${age}`,
      sex && `Sex: ${sex}`,
      conditions && `Existing conditions: ${conditions}`,
      medications && `Current medications: ${medications}`,
      allergies && `Allergies: ${allergies}`,
    ].filter(Boolean).join("\n");

    const out = await runAssessment({
      auth, type: "text", lang, age,
      title: titleFrom(symptoms, "Symptom assessment"),
      // allergies/conditions are history, not current symptoms — keep them out of the emergency scan
      safetyText: `${symptoms}\n${associated}`,
      ragQuery: `${symptoms} ${associated}`,
      details,
      input: { symptoms, duration, severity, associated, age, sex, conditions, medications, allergies, language: lang },
    });
    return json(out);
  } catch (e) {
    return errorResponse(e);
  }
});
