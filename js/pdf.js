// Lab reports in the browser (Groq cannot read PDFs): extract the text layer with pdf.js; if the PDF is a scan
// (no text layer), render its first pages to images for the vision model. Photos are just compressed.
import { compressImage } from "./ui.js";

const VER = "4.10.38";
const LIB = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VER}/build/pdf.min.mjs`;
const WORKER = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VER}/build/pdf.worker.min.mjs`;
export const MAX_REPORT_TEXT = 24000;
let lib = null;

async function loadPdfJs() {
  if (lib) return lib;
  lib = await import(LIB);
  // cross-origin workers are blocked by browsers, so wrap the worker script in a same-origin blob
  const code = await (await fetch(WORKER)).text();
  lib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  return lib;
}

async function pageToJpeg(page, scale) {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.8));
}

/** @returns {{ text: string, images: Blob[], truncated: boolean }} */
export async function readReportFile(file, { maxImages = 3 } = {}) {
  if (file.type !== "application/pdf") {
    return { text: "", images: [await compressImage(file)], truncated: false };
  }
  let pdf;
  try {
    const pdfjs = await loadPdfJs();
    pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  } catch {
    throw new Error("That PDF could not be read. Try a photo or screenshot of the report instead.");
  }
  let text = "";
  for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
    const tc = await (await pdf.getPage(i)).getTextContent();
    text += tc.items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("") + "\n";
  }
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

  if (text.length >= 150) {
    return { text: text.slice(0, MAX_REPORT_TEXT), images: [], truncated: text.length > MAX_REPORT_TEXT };
  }
  // scanned PDF → render the first pages for the vision model
  const images = [];
  for (let i = 1; i <= Math.min(pdf.numPages, maxImages); i++) {
    const page = await pdf.getPage(i);
    let blob = await pageToJpeg(page, 1.4);
    if (blob.size > 2.9 * 1024 * 1024) blob = await pageToJpeg(page, 1.0);
    images.push(blob);
  }
  return { text: "", images, truncated: pdf.numPages > maxImages };
}
