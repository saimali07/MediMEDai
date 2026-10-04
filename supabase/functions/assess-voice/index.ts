import { clampStr, errorResponse, handleCors, json, optEnum, optInt, readJson, HttpError } from "../_shared/cors.ts";
import { authenticate, requireUser } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { runAssessment, titleFrom } from "../_shared/pipeline.ts";
import { loadMedia, MAX_BYTES, whisperHint, type MediaRef } from "../_shared/media.ts";
import { assertConfigured, transcribeAudio } from "../_shared/ai.ts";
import { detectEmergency, normalizeLang, safetyPayload } from "../_shared/safety.ts";

// Modes:
//  { transcript }                      → assessment from the (editable) transcript
//  { audio:{path}, transcribeOnly }    → returns { transcript } (Groq Whisper transcription fallback)
//  { audio:{path} }                    → transcribe with Whisper, then assess
Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  try {
    const auth = await authenticate(req);
    requireUser(auth, "Please sign in to use voice assessments.");
    await enforceRateLimit(auth, req);
    const b = await readJson(req);

    const lang = normalizeLang(b.language);
    const hint = whisperHint(b.speech_lang);
    const age = optInt(b.age, 0, 120);
    const sex = optEnum(b.sex, ["female", "male", "other"] as const);
    let transcript = clampStr(b.transcript, 6000);
    const audioRef = (b.audio && typeof b.audio === "object" ? b.audio : null) as MediaRef | null;
    let audioPath: string | undefined;

    if (!transcript) {
      if (!audioRef) throw new HttpError(400, "bad_request", "Provide a transcript or an audio file.");
      assertConfigured();
      const audio = await loadMedia(auth, audioRef, { bucket: "audio", kinds: ["audio"], maxBytes: MAX_BYTES.audio, label: "voice recording" });
      audioPath = audio.path;
      try {
        transcript = (await transcribeAudio(audio.part, hint)).trim();
      } catch (e) {
        if (e instanceof HttpError) e.extra = { ...(e.extra ?? {}), safety: safetyPayload(detectEmergency(""), lang) };
        throw e;
      }
      if (!transcript) throw new HttpError(422, "no_speech", "No speech was detected in the recording. Please try again closer to the microphone.");
      if (b.transcribeOnly === true) return json({ transcript, audio_path: audioPath });
    } else if (audioRef && typeof audioRef.path === "string") {
      audioPath = audioRef.path as string;
    }

    const out = await runAssessment({
      auth, type: "voice", lang, age,
      title: titleFrom(transcript, "Voice assessment", 60),
      safetyText: transcript,
      ragQuery: transcript,
      details: [`Voice transcript: ${transcript}`, age !== null && `Age: ${age}`, sex && `Sex: ${sex}`].filter(Boolean).join("\n"),
      input: { transcript, age, sex, language: lang, audio_path: audioPath ?? null },
    });
    return json({ ...out, transcript });
  } catch (e) {
    return errorResponse(e);
  }
});
