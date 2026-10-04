import { initPage, $, esc, showToast, showError, showEmergencyPayload, createAnalyzer, setupConsent, formatBytes, getLang } from "../ui.js";
import { callFn, uploadFile, removeFiles } from "../api.js";
import { readReportFile } from "../pdf.js";

await initPage({ active: "reports", auth: "required" });
const analyzer = createAnalyzer($("#form-section"), $("#analyzing"));
const consentOk = setupConsent($("#consent-row"));
const TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
let file = null;

function render() {
  $("#file-preview").innerHTML = file ? `<div class="file-chip"><div class="file-ico" style="font-weight:700; font-size:.75rem;">${file.type === "application/pdf" ? "PDF" : "IMG"}</div><div class="meta"><p>${esc(file.name)}</p><span>${formatBytes(file.size)}</span></div><button class="btn btn-quiet" id="rm" style="min-height:36px; padding:0.25rem 0.625rem; color:var(--u-emergency);">Remove</button></div>` : "";
  $("#rm")?.addEventListener("click", () => { file = null; render(); showToast("File removed"); });
  $("#analyze-btn").disabled = !file;
}
function pick(f) {
  if (!f) return;
  if (!TYPES.includes(f.type)) return showError($("#form-error"), "Please choose a PDF, JPG, PNG or WebP file.");
  if (f.size > 10 * 1024 * 1024) return showError($("#form-error"), "That file is larger than 10 MB.");
  showError($("#form-error"), ""); file = f; render();
}
const dz = $("#dropzone");
dz.addEventListener("click", () => $("#file-input").click());
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file-input").click(); } });
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => pick(e.dataTransfer.files[0]));
$("#file-input").addEventListener("change", (e) => { pick(e.target.files[0]); e.target.value = ""; });

$("#analyze-btn").addEventListener("click", async () => {
  const err = $("#form-error"); showError(err, "");
  if (!(await consentOk())) return showError(err, "Please tick the consent box to continue.");
  const uploaded = [];
  analyzer.start();
  try {
    const { text, images, truncated } = await readReportFile(file);
    if (!text && !images.length) throw new Error("No readable content was found in that file.");
    const imagePaths = [];
    for (const img of images) { const p = await uploadFile("reports", img, "image/jpeg"); uploaded.push(p); imagePaths.push(p); }
    // keep the original PDF for the user's records (deletable); photos are already stored above
    const originalPath = file.type === "application/pdf" ? await uploadFile("reports", file, file.type) : imagePaths[0];
    if (file.type === "application/pdf") uploaded.push(originalPath);
    const out = await callFn("analyze-report", {
      report: { path: originalPath }, report_text: text, report_images: imagePaths.map((path) => ({ path })),
      notes: ($("#notes").value.trim() + (truncated ? "\n(Note: only the first part of this report could be read.)" : "")).trim(),
      language: getLang(),
    });
    if (analyzer.cancelled) return;
    location.href = `results.html?id=${encodeURIComponent(out.id)}`;
  } catch (e) {
    if (!analyzer.cancelled) { analyzer.stop(); showError(err, e.message); showEmergencyPayload($("#live-banner"), e.safety); showToast(e.message, "error"); }
    await removeFiles("reports", uploaded);
  }
});
render();
