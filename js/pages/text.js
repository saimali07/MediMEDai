import { initPage, $, $$, t, getLang, showToast, showError, attachLiveSafety, showEmergencyPayload, createAnalyzer } from "../ui.js";
import { callFn } from "../api.js";

const user = await initPage({ active: "intake" });
const guestUsed = !user && localStorage.getItem("medimind_guest_used") === "1";
if (!user) {
  $("#guest-note").innerHTML = guestUsed
    ? '<div class="info-note">Your free guest assessment has been used. <a href="register.html">Create a free account</a> or <a href="login.html">sign in</a> to continue.</div>'
    : '<div class="info-note"><strong>Guest trial:</strong> you can run one free text assessment. <a href="register.html">Create an account</a> to save results and use photos, voice and lab reports.</div>';
}

const analyzer = createAnalyzer($("#form-section"), $("#analyzing"));
const banner = $("#live-banner");
const age = () => { const n = parseInt($("#age").value, 10); return Number.isFinite(n) ? n : null; };
attachLiveSafety({ fields: [$("#primary-symptom"), $("#associated-symptoms")], banner, getAge: age });

$("#severity-range").addEventListener("input", (e) => { $("#severity-val").textContent = `${e.target.value} / 10`; });

let step = 1;
const LABELS = { 1: null, 2: "step_2", 3: "step_3" };
function render() {
  $$(".step-pane").forEach((p) => p.classList.toggle("hidden", Number(p.dataset.step) !== step));
  $("#form-progress-fill").style.width = `${step * 33.33}%`;
  $("#step-count-label").textContent = step === 1 ? t("step_indicator") : t(LABELS[step]);
  $("#back-btn").textContent = step === 1 ? t("btn_back") : t("btn_back");
  $("#next-label").textContent = step === 3 ? t("btn_run_assessment") : t("btn_next");
  showError($("#form-error"), "");
}
document.addEventListener("langchange", render);

$("#back-btn").addEventListener("click", () => { if (step === 1) location.href = "index.html"; else { step--; render(); } });

$("#next-btn").addEventListener("click", async () => {
  const err = $("#form-error");
  if (step === 1) {
    if (!$("#primary-symptom").value.trim()) return showError(err, "Please describe your main symptom.");
    step = 2; return render();
  }
  if (step === 2) { step = 3; return render(); }

  if (guestUsed) return showError(err, "Your free guest assessment has been used. Please create an account to continue.");
  const body = {
    symptoms: $("#primary-symptom").value.trim(),
    duration: $("#duration-select").value,
    severity: Number($("#severity-range").value),
    associated: $("#associated-symptoms").value.trim(),
    age: age(),
    sex: $("#sex").value || null,
    conditions: $("#conditions").value.trim(),
    medications: $("#medications").value.trim(),
    allergies: $("#allergies").value.trim(),
    language: getLang(),
  };
  analyzer.start();
  try {
    const out = await callFn("assess-text", body);
    if (analyzer.cancelled) return;
    if (out.id) { location.href = `results.html?id=${encodeURIComponent(out.id)}`; return; }
    sessionStorage.setItem("medimind_guest_result", JSON.stringify({ result: out.result, created_at: new Date().toISOString(), type: "text", title: body.symptoms }));
    localStorage.setItem("medimind_guest_used", "1");
    location.href = "results.html?id=guest";
  } catch (e) {
    if (analyzer.cancelled) return;
    analyzer.stop();
    showError(err, e.message);
    showEmergencyPayload(banner, e.safety);
    showToast(e.message, "error");
  }
});
render();
