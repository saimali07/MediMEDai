// The ONLY file that talks to an AI provider — this version uses Groq (OpenAI-compatible API).
//   • text chat     : Groq /chat/completions (default openai/gpt-oss-120b)
//   • photos        : Google Gemini (OpenAI-compatible endpoint, default gemini-3.5-flash) — Groq has no vision model on this account
//                     (falls back to GROQ_VISION_MODEL on Groq if GEMINI_API_KEY is not set and that variable is set)
//   • speech-to-text: /audio/transcriptions (whisper-large-v3, multilingual incl. Urdu/Hindi)
// Groq cannot read PDFs and has no embedding model: the browser extracts PDF text / renders pages to images,
// and RAG uses Postgres full-text search (see rag.ts).
import { HttpError } from "./cors.ts";

export type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

const baseUrl = () => Deno.env.get("GROQ_BASE_URL") || "https://api.groq.com/openai/v1";
export const textModel = () => Deno.env.get("GROQ_TEXT_MODEL") || "openai/gpt-oss-120b";
export const geminiModel = () => Deno.env.get("GEMINI_MODEL") || "gemini-3.5-flash";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai";

type Provider = { name: "groq" | "gemini"; base: string; key: string; model: string };

/** Groq provider for text. */
function groqProvider(model: string): Provider {
  return { name: "groq", base: baseUrl(), key: assertConfigured(), model };
}

/** Provider for requests that contain photos. Gemini when GEMINI_API_KEY is set; else Groq with GROQ_VISION_MODEL. */
function visionProvider(): Provider {
  const gk = Deno.env.get("GEMINI_API_KEY");
  if (gk) return { name: "gemini", base: GEMINI_BASE, key: gk, model: geminiModel() };
  const gm = Deno.env.get("GROQ_VISION_MODEL");
  if (gm) return groqProvider(gm);
  throw new HttpError(503, "ai_not_configured", "Photo analysis is not configured yet (GEMINI_API_KEY is missing). Please try again later.");
}

/** Reasoning models spend output tokens on thinking: keep it small so JSON is never cut off. */
const extra = (m: string): Record<string, unknown> => {
  if (/qwen/i.test(m)) return { reasoning_effort: "none" };
  if (/gpt-oss/i.test(m)) return { reasoning_effort: "low" };
  if (/gemini/i.test(m)) return { reasoning_effort: "low" };
  return {};
};
export const sttModel = () => Deno.env.get("GROQ_STT_MODEL") || "whisper-large-v3";

const MAX_B64_IMAGE = 4 * 1024 * 1024; // Groq limit for base64-encoded images

/** Throws HTTP 503 with a clear message when the key is missing. Never fakes output. */
export function assertConfigured(): string {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) {
    throw new HttpError(503, "ai_not_configured", "The AI service is not configured yet (GROQ_API_KEY is missing). Please try again later.");
  }
  return key;
}

// deno-lint-ignore no-explicit-any
async function call(path: string, init: { json?: unknown; form?: FormData }, timeoutMs = 90_000, prov?: Provider): Promise<any> {
  const p = prov ?? groqProvider("");
  const key = p.key;
  const gem = p.name === "gemini";
  let res: Response;
  try {
    res = await fetch(`${p.base}/${path}`, {
      method: "POST",
      headers: init.form ? { Authorization: `Bearer ${key}` } : { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: init.form ?? JSON.stringify(init.json),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new HttpError(504, "ai_timeout", "The AI service took too long to respond. Please try again.");
  }
  if (res.ok) return await res.json();

  console.error(`${p.name}_http_error`, res.status); // status only — never the body
  let code = "";
  let bodyText = ""; // read once; used only for matching, never logged
  try { bodyText = await res.text(); } catch { /* ignore */ }
  try {
    const j = JSON.parse(bodyText);
    code = String((Array.isArray(j) ? j[0] : j)?.error?.code ?? "");
  } catch { /* ignore */ }
  if (res.status === 429) throw new HttpError(503, "ai_busy", "The AI service is busy or the free-tier limit was reached. Please try again in a minute.");
  if (res.status === 401 || res.status === 403 || (gem && res.status === 400 && /api key/i.test(bodyText))) {
    throw new HttpError(503, "ai_auth", gem ? "The photo-analysis service rejected the server key. The administrator must check GEMINI_API_KEY." : "The AI service rejected the server key. The administrator must check GROQ_API_KEY.");
  }
  if (code === "json_validate_failed") throw new HttpError(502, "ai_invalid_json", "The AI returned an unreadable answer. Please try again.");
  if (res.status === 404 || code === "model_not_found" || code === "model_decommissioned") {
    throw new HttpError(503, "ai_model_missing", gem ? "The configured photo model is not available. The administrator must check GEMINI_MODEL." : "The configured AI model is not available. The administrator must check GROQ_TEXT_MODEL.");
  }
  if (res.status === 413) throw new HttpError(413, "ai_input_too_large", "The input is too large for the AI service. Use a smaller photo or shorter text.");
  throw new HttpError(502, "ai_error", "The AI service returned an error. Please try again.");
}

function toContent(parts: Part[]): { content: unknown; hasImage: boolean } {
  let hasImage = false;
  // deno-lint-ignore no-explicit-any
  const out: any[] = [];
  for (const p of parts) {
    if ("text" in p) { out.push({ type: "text", text: p.text }); continue; }
    if (!p.inlineData.mimeType.startsWith("image/")) {
      throw new HttpError(415, "unsupported_attachment", "Only photos can be analysed directly. PDFs must be converted to text or images first.");
    }
    if (p.inlineData.data.length > MAX_B64_IMAGE) {
      throw new HttpError(413, "image_too_large", "A photo is too large for the AI service (4 MB limit after encoding). Use a smaller photo.");
    }
    hasImage = true;
    out.push({ type: "image_url", image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } });
  }
  return { content: hasImage ? out : out.map((o) => o.text).join("\n\n"), hasImage };
}

// Gemini-style schema (uppercase types) → standard JSON Schema, used only to describe the format in the prompt.
// deno-lint-ignore no-explicit-any
function toJsonSchema(s: any): any {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (s && typeof s === "object") {
    // deno-lint-ignore no-explicit-any
    const o: any = {};
    for (const [k, v] of Object.entries(s)) o[k] = k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v);
    return o;
  }
  return s;
}

function stripFences(t: string) {
  return t.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
}

export interface JSONRequest<T> {
  system: string;
  parts: Part[];
  schema: Record<string, unknown>;
  validate: (raw: unknown) => T;
  maxOutputTokens?: number;
  temperature?: number;
}

/** JSON-mode output. Validates, retries once on invalid/truncated JSON, never returns truncated output. */
export async function generateJSON<T>(req: JSONRequest<T>): Promise<T> {
  const { content, hasImage } = toContent(req.parts);
  const prov = hasImage ? visionProvider() : groqProvider(textModel());
  const model = prov.model;
  const schemaText = JSON.stringify(toJsonSchema(req.schema));
  let lastErr: HttpError = new HttpError(502, "ai_invalid_json", "The AI returned an unreadable answer. Please try again.");

  for (let attempt = 0; attempt < 2; attempt++) {
    const system = `${req.system}\n\nOUTPUT FORMAT: Respond with ONE valid JSON object and nothing else (no markdown, no commentary). It must conform to this JSON Schema; include every required key; use [] for empty lists and "" for empty strings:\n${schemaText}` +
      (attempt === 1 ? "\n\nYour previous reply was not valid JSON for the schema. Reply with ONLY the JSON object." : "");
    let data;
    try {
      data = await call("chat/completions", {
        json: {
          model,
          messages: [{ role: "system", content: system }, { role: "user", content }],
          ...(prov.name === "groq" ? { response_format: { type: "json_object" } } : {}),
          ...extra(model),
          ...(prov.name === "gemini" ? {} : { temperature: req.temperature ?? 0.3 }),
          max_completion_tokens: attempt === 0 ? (req.maxOutputTokens ?? 6000) : 8192,
        },
      }, prov.name === "gemini" ? 55_000 : 90_000, prov);
    } catch (e) {
      if (e instanceof HttpError && e.code === "ai_invalid_json" && attempt === 0) { lastErr = e; continue; }
      throw e;
    }
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") {
      lastErr = new HttpError(502, "ai_truncated", "The AI answer was cut off. Please try again.");
      continue;
    }
    try {
      return req.validate(JSON.parse(stripFences(String(choice?.message?.content ?? ""))));
    } catch {
      lastErr = new HttpError(502, "ai_invalid_json", "The AI returned an unreadable answer. Please try again.");
    }
  }
  throw lastErr;
}

export async function generateText(req: { system: string; parts: Part[]; maxOutputTokens?: number; temperature?: number }): Promise<string> {
  const { content, hasImage } = toContent(req.parts);
  const prov = hasImage ? visionProvider() : groqProvider(textModel());
  const model = prov.model;
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await call("chat/completions", {
      json: {
        model,
        messages: [{ role: "system", content: req.system }, { role: "user", content }],
        ...extra(model),
        ...(prov.name === "gemini" ? {} : { temperature: req.temperature ?? 0.3 }),
        max_completion_tokens: attempt === 0 ? (req.maxOutputTokens ?? 2048) : 4096,
      },
    }, prov.name === "gemini" ? 55_000 : 90_000, prov);
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") continue; // never return a cut-off answer
    const text = String(choice?.message?.content ?? "").trim();
    if (text) return text;
  }
  throw new HttpError(502, "ai_truncated", "The AI answer was cut off. Please try again.");
}

const AUDIO_EXT: Record<string, string> = {
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/ogg": "ogg", "audio/flac": "flac", "audio/webm": "webm", "audio/mp4": "m4a",
};

/** Whisper (Groq) verbatim transcript. `whisperLang` is an optional ISO-639-1 hint (en/ur/hi); omit for auto-detect. */
export async function transcribeAudio(audio: Part, whisperLang?: string): Promise<string> {
  if (!("inlineData" in audio)) throw new HttpError(400, "bad_audio", "No audio supplied.");
  const { mimeType, data } = audio.inlineData;
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append("file", new Blob([bytes], { type: mimeType }), `audio.${AUDIO_EXT[mimeType] ?? "wav"}`);
  form.append("model", sttModel());
  form.append("response_format", "json");
  form.append("temperature", "0");
  if (whisperLang && /^[a-z]{2}$/.test(whisperLang)) form.append("language", whisperLang);
  const out = await call("audio/transcriptions", { form }, 120_000);
  return String(out?.text ?? "").trim();
}
