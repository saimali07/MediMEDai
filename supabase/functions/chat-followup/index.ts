import { clampStr, errorResponse, handleCors, json, readJson, HttpError } from "../_shared/cors.ts";
import { authenticate, requireUser } from "../_shared/auth.ts";
import { enforceRateLimit } from "../_shared/ratelimit.ts";
import { generateText, assertConfigured } from "../_shared/ai.ts";
import { CHAT_SYSTEM } from "../_shared/prompts.ts";
import { DOSAGE_REFUSAL, asksForDosage, detectEmergency, emergencyCopy, normalizeLang } from "../_shared/safety.ts";

Deno.serve(async (req) => {
  const pre = handleCors(req);
  if (pre) return pre;
  try {
    const auth = await authenticate(req);
    const user = requireUser(auth, "Please sign in to ask follow-up questions.");
    await enforceRateLimit(auth, req);
    const b = await readJson(req);

    const assessmentId = typeof b.assessmentId === "string" ? b.assessmentId : "";
    const message = clampStr(b.message, 1500);
    const lang = normalizeLang(b.language);
    if (!/^[0-9a-f-]{36}$/i.test(assessmentId) || !message) throw new HttpError(400, "bad_request", "A message and assessment are required.");

    const { data: a } = await auth.admin.from("assessments").select("id, type, result, input").eq("id", assessmentId).eq("user_id", user.id).maybeSingle();
    if (!a) throw new HttpError(404, "not_found", "Assessment not found.");

    const save = async (role: "user" | "assistant", content: string) => {
      const { error } = await auth.admin.from("chat_messages").insert({ assessment_id: assessmentId, role, content });
      if (error) console.error("chat_save_failed", error.code ?? "unknown");
    };

    // 1) deterministic safety — never skipped, and works even if the AI is down
    const det = detectEmergency(message);
    if (det.triggered) {
      const c = emergencyCopy(det.categories, lang);
      const reply = `${c.title}\n\n${c.body}${c.crisis ? `\n\n${c.crisis}` : ""}`;
      await save("user", message);
      await save("assistant", reply);
      return json({ reply, emergency: true });
    }

    // 2) refuse dosage / prescription requests
    if (asksForDosage(message)) {
      const reply = DOSAGE_REFUSAL[lang === "ur" ? "ur" : "en"];
      await save("user", message);
      await save("assistant", reply);
      return json({ reply, refused: true });
    }

    assertConfigured();
    const { data: history } = await auth.admin.from("chat_messages").select("role, content").eq("assessment_id", assessmentId).order("created_at", { ascending: false }).limit(12);
    const transcript = (history ?? []).reverse().map((m: { role: string; content: string }) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`).join("\n");

    const context = JSON.stringify({ type: a.type, urgency: a.result?.urgency, summary: a.result?.summary, possible_explanations: a.result?.possible_explanations, missing_information: a.result?.missing_information, next_steps: a.result?.recommended_next_steps, red_flags: a.result?.red_flags_to_watch, tests: a.result?.tests });

    const reply = await generateText({
      system: CHAT_SYSTEM,
      parts: [{ text: `ASSESSMENT CONTEXT (data):\n${context}\n\nCONVERSATION SO FAR:\n${transcript || "(none)"}\n\nNEW USER MESSAGE (data):\n"""\n${message}\n"""\n\nPreferred reply language if unclear: ${lang === "ur" ? "Urdu" : lang === "hi" ? "Hindi" : "English"}` }],
      maxOutputTokens: 2048,
    });

    await save("user", message);
    await save("assistant", reply);
    return json({ reply });
  } catch (e) {
    return errorResponse(e);
  }
});
