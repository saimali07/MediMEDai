import { initPage, $, esc, showToast, showError, attachLiveSafety, showEmergencyPayload, createAnalyzer, setupConsent, compressImage, formatBytes, getLang } from "../ui.js";
import { callFn, uploadFile, removeFiles } from "../api.js";

await initPage({ active: "intake", auth: "required" });
const analyzer = createAnalyzer($("#form-section"), $("#analyzing"));
const consentOk = setupConsent($("#consent-row"));
const banner = $("#live-banner");
attachLiveSafety({ fields: [$("#description")], banner, getAge: () => parseInt($("#age").value, 10) || null });

const MAX = 3;
const photos = []; // { blob, url, name }

function renderPreviews() {
  $("#previews").innerHTML = photos.map((p, i) => `<div class="file-chip"><img src="${p.url}" alt="Preview of ${esc(p.name)}"><div class="meta"><p>${esc(p.name)}</p><span>${formatBytes(p.blob.size)} · compressed</span></div><button class="btn btn-quiet" data-rm="${i}" style="min-height:36px; padding:0.25rem 0.625rem; color:var(--u-emergency);">Remove</button></div>`).join("");
  $("#analyze-btn").disabled = photos.length === 0;
}

async function addFiles(files) {
  showError($("#form-error"), "");
  for (const f of files) {
    if (photos.length >= MAX) { showToast(`You can add up to ${MAX} photos`, "error"); break; }
    try {
      const blob = await compressImage(f);
      photos.push({ blob, url: URL.createObjectURL(blob), name: f.name || "camera-photo.jpg" });
    } catch (e) { showToast(`${f.name || "Photo"}: ${e.message}`, "error"); }
  }
  renderPreviews();
}

const dz = $("#dropzone");
dz.addEventListener("click", () => $("#file-input").click());
dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#file-input").click(); } });
["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
$("#file-input").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
$("#camera-btn").addEventListener("click", () => $("#camera-input").click());
$("#camera-input").addEventListener("change", (e) => { addFiles([...e.target.files]); e.target.value = ""; });
$("#previews").addEventListener("click", (e) => {
  const i = e.target.closest("[data-rm]")?.dataset.rm;
  if (i === undefined) return;
  URL.revokeObjectURL(photos[i].url); photos.splice(i, 1); renderPreviews(); showToast("Photo removed");
});

$("#analyze-btn").addEventListener("click", async () => {
  const err = $("#form-error");
  if (!(await consentOk())) return showError(err, "Please tick the consent box to continue.");
  const uploaded = [];
  analyzer.start();
  try {
    for (const p of photos) uploaded.push(await uploadFile("assessment-images", p.blob, "image/jpeg"));
    const out = await callFn("assess-image", {
      images: uploaded.map((path) => ({ path })),
      description: $("#description").value.trim(),
      age: parseInt($("#age").value, 10) || null,
      sex: $("#sex").value || null,
      language: getLang(),
    });
    if (analyzer.cancelled) return;
    location.href = `results.html?id=${encodeURIComponent(out.id)}`;
  } catch (e) {
    if (!analyzer.cancelled) { analyzer.stop(); showError(err, e.message); showEmergencyPayload(banner, e.safety); showToast(e.message, "error"); }
    await removeFiles("assessment-images", uploaded);
  }
});
