// Loads user files from private storage, validates type/size by magic bytes, and prepares inline parts.
import { HttpError, clampStr } from "./cors.ts";
import type { AuthCtx } from "./auth.ts";
import type { Part } from "./ai.ts";

export type MediaKind = "image" | "pdf" | "audio";
export interface MediaRef { path?: unknown; data?: unknown; mimeType?: unknown }
export interface LoadedMedia { label: string; part: Part; bytes: number; path?: string }

const MIMES: Record<MediaKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  pdf: ["application/pdf"],
  audio: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/flac", "audio/webm", "audio/mp4"],
};
export const MAX_BYTES = { image: 8 * 1024 * 1024, report: 10 * 1024 * 1024, audio: 10 * 1024 * 1024 };
export const MAX_TOTAL_BYTES = 14 * 1024 * 1024; // keep requests comfortably small

const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, e));

function sniff(b: Uint8Array): string | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 4 && b[0] === 0x89 && ascii(b, 1, 4) === "PNG") return "image/png";
  if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP") return "image/webp";
  if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WAVE") return "audio/wav";
  if (b.length > 5 && ascii(b, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(bin);
}

export async function loadMedia(
  auth: AuthCtx,
  ref: MediaRef,
  opts: { bucket: "assessment-images" | "reports" | "audio"; kinds: MediaKind[]; maxBytes: number; label: string },
): Promise<LoadedMedia> {
  const allowed = opts.kinds.flatMap((k) => MIMES[k]);
  let bytes: Uint8Array;
  let declared = "";
  let path: string | undefined;

  if (typeof ref.path === "string") {
    const uid = auth.user?.id;
    if (!uid || !ref.path.startsWith(`${uid}/`) || ref.path.includes("..")) {
      throw new HttpError(403, "forbidden_path", "That file does not belong to your account.");
    }
    const { data, error } = await auth.admin.storage.from(opts.bucket).download(ref.path);
    if (error || !data) throw new HttpError(404, "file_not_found", "The uploaded file could not be found. Please upload it again.");
    bytes = new Uint8Array(await data.arrayBuffer());
    declared = (data.type || "").split(";")[0].toLowerCase();
    path = ref.path;
  } else if (typeof ref.data === "string" && typeof ref.mimeType === "string") {
    if (ref.data.length * 0.75 > opts.maxBytes * 1.05) throw new HttpError(413, "file_too_large", "That file is too large.");
    try {
      bytes = Uint8Array.from(atob(ref.data), (c) => c.charCodeAt(0));
    } catch {
      throw new HttpError(400, "bad_base64", "The file data could not be read.");
    }
    declared = ref.mimeType.split(";")[0].toLowerCase();
  } else {
    throw new HttpError(400, "bad_file_ref", "A file reference is required.");
  }

  if (bytes.length === 0) throw new HttpError(400, "empty_file", "The file is empty.");
  if (bytes.length > opts.maxBytes) {
    throw new HttpError(413, "file_too_large", `That file is larger than ${Math.round(opts.maxBytes / 1048576)} MB.`);
  }

  const sniffed = sniff(bytes);
  const isAudio = opts.kinds.includes("audio");
  let mime = sniffed ?? declared;
  if (!isAudio || sniffed) {
    // images and PDFs must really be what they claim to be
    if (!sniffed || !allowed.includes(sniffed)) throw new HttpError(415, "unsupported_type", "Unsupported file type.");
  } else if (!allowed.includes(declared)) {
    throw new HttpError(415, "unsupported_type", "Unsupported audio type. Use WAV, MP3, OGG, FLAC, WebM or M4A.");
  }
  if (mime === "audio/x-wav") mime = "audio/wav";

  return { label: opts.label, part: { inlineData: { mimeType: mime, data: toBase64(bytes) } }, bytes: bytes.length, path };
}

export function assertTotalSize(items: LoadedMedia[]) {
  const total = items.reduce((n, m) => n + m.bytes, 0);
  if (total > MAX_TOTAL_BYTES) throw new HttpError(413, "attachments_too_large", "The attachments are too large together. Remove one and try again.");
}

/** Optional ISO-639-1 hint for Whisper (only en/ur/hi accepted; omit for auto-detect). */
export function whisperHint(x: unknown): string | undefined {
  return typeof x === "string" && /^(en|ur|hi)$/.test(x) ? x : undefined;
}

/**
 * Lab reports on Groq: the browser extracts text from PDFs (pdf.js) and/or renders pages / photos to images.
 * The original upload (report.path) is kept only so the user can delete it later.
 */
export async function loadReportInputs(auth: AuthCtx, b: Record<string, unknown>) {
  const text = clampStr(b.report_text, 24000);
  const refs = Array.isArray(b.report_images) ? (b.report_images as MediaRef[]).slice(0, 3) : [];
  const images: LoadedMedia[] = [];
  for (const [i, r] of refs.entries()) {
    images.push(await loadMedia(auth, r, { bucket: "reports", kinds: ["image"], maxBytes: MAX_BYTES.report, label: `lab report page ${i + 1} of ${refs.length}` }));
  }
  let reportPath: string | undefined;
  const rep = (b.report && typeof b.report === "object" ? b.report : null) as MediaRef | null;
  if (rep && typeof rep.path === "string") {
    const uid = auth.user?.id;
    if (!uid || !rep.path.startsWith(`${uid}/`) || rep.path.includes("..")) throw new HttpError(403, "forbidden_path", "That file does not belong to your account.");
    reportPath = rep.path;
  }
  return { text, images, reportPath, imagePaths: images.map((m) => m.path).filter((p): p is string => !!p) };
}
