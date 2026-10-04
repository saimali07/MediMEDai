import { initPage, $, $$, esc, showToast, showError, attachLiveSafety, showEmergencyPayload, createAnalyzer, setupConsent, compressImage, formatBytes, getLang } from "../ui.js";
import { callFn, uploadFile, removeFiles } from "../api.js";
import { readReportFile } from "../pdf.js";
import { VoiceRecorder, blobToWav, speechSupported, fmtTimer } from "../recorder.js";

await initPage({ active: "intake", auth: "required" });
const analyzer = createAnalyzer($("#form-section"), $("#analyzing"));
const consentOk = setupConsent($("#consent-row"));
const banner = $("#live-banner");
const box = $("#voice-transcript");
const runSafety = attachLiveSafety({ fields: [$("#symptoms"), box], banner, getAge: () => parseInt($("#age").value, 10) || null });
if (!speechSupported) $("#voice-status").textContent = "Live transcript isn't supported here — the recording will be transcribed by AI when you analyze.";

/* ---- photos ---- */
const photos = [];
const renderPhotos = () => { $("#photo-previews").innerHTML = photos.map((p, i) => `<div class="file-chip"><img src="${p.url}" alt=""><div class="meta"><p>${esc(p.name)}</p><span>${formatBytes(p.blob.size)}</span></div><button class="btn btn-quiet" data-rm="${i}" style="min-height:36px; color:var(--u-emergency);">Remove</button></div>`).join(""); };
async function addPhotos(files) {
  for (const f of files) {
    if (photos.length >= 3) { showToast("You can add up to 3 photos", "error"); break; }
    try { const blob = await compressImage(f); photos.push({ blob, url: URL.createObjectURL(blob), name: f.name || "camera-photo.jpg" }); }
    catch (e) { showToast(`${f.name || "Photo"}: ${e.message}`, "error"); }
  }
  renderPhotos();
}
const pdz = $("#photo-dz");
pdz.addEventListener("click", () => $("#photo-input").click());
pdz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#photo-input").click(); } });
["dragenter", "dragover"].forEach((ev) => pdz.addEventListener(ev, (e) => { e.preventDefault(); pdz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => pdz.addEventListener(ev, (e) => { e.preventDefault(); pdz.classList.remove("drag"); }));
pdz.addEventListener("drop", (e) => addPhotos([...e.dataTransfer.files]));
$("#photo-input").addEventListener("change", (e) => { addPhotos([...e.target.files]); e.target.value = ""; });
$("#camera-btn").addEventListener("click", () => $("#camera-input").click());
$("#camera-input").addEventListener("change", (e) => { addPhotos([...e.target.files]); e.target.value = ""; });
$("#photo-previews").addEventListener("click", (e) => { const i = e.target.closest("[data-rm]")?.dataset.rm; if (i === undefined) return; URL.revokeObjectURL(photos[i].url); photos.splice(i, 1); renderPhotos(); });

/* ---- report ---- */
let report = null;
const REPORT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const renderReport = () => { $("#report-preview").innerHTML = report ? `<div class="file-chip"><div class="file-ico">${report.type === "application/pdf" ? "PDF" : "IMG"}</div><div class="meta"><p>${esc(report.name)}</p><span>${formatBytes(report.size)}</span></div><button class="btn btn-quiet" id="rm-report" style="min-height:36px; color:var(--u-emergency);">Remove</button></div>` : ""; $("#rm-report")?.addEventListener("click", () => { report = null; renderReport(); }); };
const rdz = $("#report-dz");
rdz.addEventListener("click", () => $("#report-input").click());
rdz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#report-input").click(); } });
$("#report-input").addEventListener("change", (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (!REPORT_TYPES.includes(f.type)) return showToast("Use a PDF, JPG, PNG or WebP file", "error");
  if (f.size > 10 * 1024 * 1024) return showToast("That file is larger than 10 MB", "error");
  report = f; renderReport();
});

/* ---- voice ---- */
let recorder = null, audioBlob = null, committed = "";
const bars = $$(".wave-bar");
async function startRec() {
  if (!navigator.mediaDevices?.getUserMedia) return showError($("#form-error"), "This browser cannot record audio. Type in the transcript box instead.");
  committed = box.value.trim();
  recorder = new VoiceRecorder({
    lang: $("#speech-lang").value,
    onTick: (s) => { $("#recording-timer").textContent = fmtTimer(s); },
    onLevels: (lv) => bars.forEach((b, i) => { b.style.height = `${8 + Math.round((lv[i] || 0) * 36)}px`; b.classList.toggle("active", (lv[i] || 0) > 0.05); }),
    onTranscript: (final, interim) => { box.value = [committed, final, interim].filter(Boolean).join(" "); runSafety(); },
    onAutoStop: () => stopRec(),
  });
  try { await recorder.start(); } catch { recorder = null; return showError($("#form-error"), "Microphone access was blocked."); }
  showError($("#form-error"), ""); $("#record-btn").classList.add("recording"); $("#voice-status").textContent = "Recording… tap again to stop.";
}
async function stopRec() {
  if (!recorder) return;
  const r = recorder; recorder = null;
  $("#record-btn").classList.remove("recording");
  const raw = await r.stop();
  box.value = [committed, r.finalText].filter(Boolean).join(" "); runSafety();
  audioBlob = (await blobToWav(raw).catch(() => null)) || raw;
  $("#voice-status").textContent = box.value.trim() ? "Recording saved. Edit the transcript if needed." : "Recording saved — it will be transcribed by AI when you analyze.";
}
$("#record-btn").addEventListener("click", () => (recorder ? stopRec() : startRec()));
$("#speech-lang").addEventListener("change", (e) => recorder?.setLang(e.target.value));

/* ---- submit ---- */
$("#analyze-btn").addEventListener("click", async () => {
  const err = $("#form-error"); showError(err, "");
  if (recorder) await stopRec();
  const symptoms = $("#symptoms").value.trim(), transcript = box.value.trim();
  if (!symptoms && !photos.length && !transcript && !audioBlob && !report) return showError(err, "Add at least one input: text, a photo, a voice note or a report.");
  if (!(await consentOk())) return showError(err, "Please tick the consent box to continue.");

  const uploaded = { images: [], audio: null, report: null, reportImages: [] };
  analyzer.start();
  try {
    for (const p of photos) uploaded.images.push(await uploadFile("assessment-images", p.blob, "image/jpeg"));
    let reportText = "";
    if (report) {
      const r = await readReportFile(report, { maxImages: Math.max(1, 5 - photos.length) });
      reportText = r.text;
      for (const img of r.images) uploaded.reportImages.push(await uploadFile("reports", img, "image/jpeg"));
      uploaded.report = report.type === "application/pdf" ? await uploadFile("reports", report, report.type) : uploaded.reportImages[0];
    }
    if (audioBlob && !transcript) uploaded.audio = await uploadFile("audio", audioBlob, audioBlob.type.split(";")[0] || "audio/wav");
    const out = await callFn("assess-multimodal", {
      symptoms, duration: $("#duration").value, transcript,
      age: parseInt($("#age").value, 10) || null, sex: $("#sex").value || null, language: getLang(),
      images: uploaded.images.map((path) => ({ path })),
      audio: uploaded.audio ? { path: uploaded.audio } : undefined,
      speech_lang: $("#speech-lang").value.slice(0, 2),
      report: uploaded.report ? { path: uploaded.report } : undefined,
      report_text: reportText,
      report_images: uploaded.reportImages.map((path) => ({ path })),
    });
    if (analyzer.cancelled) return;
    location.href = `results.html?id=${encodeURIComponent(out.id)}`;
  } catch (e) {
    if (!analyzer.cancelled) { analyzer.stop(); showError(err, e.message); showEmergencyPayload(banner, e.safety); showToast(e.message, "error"); }
    await removeFiles("assessment-images", uploaded.images);
    await removeFiles("reports", [...uploaded.reportImages, ...(uploaded.report ? [uploaded.report] : [])]);
    await removeFiles("audio", uploaded.audio ? [uploaded.audio] : []);
  }
});
