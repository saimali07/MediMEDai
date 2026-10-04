import { initPage, $, esc, showToast, urgencyMeta, emergencyBannerHTML, formatDate, TYPE_LABEL, getLang } from "../ui.js";
import { getAssessment, listChat, signedUrl, callFn } from "../api.js";
import { detectEmergency, emergencyCopy } from "../safety.js";

const user = await initPage({ active: "history" });
const id = new URLSearchParams(location.search).get("id");
const msg = $("#state-msg");

const ICONS = {
  emergency: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>',
  urgent: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
  routine: '<circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline>',
  self_care: '<polyline points="20 6 9 17 4 12"></polyline>',
};
const H3ICON = (d) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" stroke-width="2">${d}</svg>`;
const I_DOC = H3ICON('<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line>');
const I_INFO = H3ICON('<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line>');
const I_Q = H3ICON('<circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line>');
const I_CHECK = H3ICON('<polyline points="9 11 12 14 22 4"></polyline><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>');
const I_WARN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';

const card = (icon, title, inner, extra = "") => `<div class="section-card" ${extra}><h3>${icon}${esc(title)}</h3>${inner}</div>`;
const ul = (items) => `<ul class="plain">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : "#");

function labTable(tests) {
  if (!tests.length) return '<p style="color:var(--ink-soft);">No test values could be read from this file.</p>';
  const flagCls = { normal: "normal", high: "high", abnormal: "high", low: "low", unclear: "unclear" };
  const flagLbl = { normal: "Normal", high: "High", abnormal: "Abnormal", low: "Low", unclear: "Unclear" };
  return `<div class="lab-wrap"><table class="lab-table" aria-label="Extracted lab results"><thead><tr><th>Test Marker</th><th>Your Value</th><th>Reference Range</th><th>Flag</th></tr></thead><tbody>${tests.map((t) => `
    <tr><td><strong>${esc(t.name)}</strong></td><td>${esc(t.value)} ${esc(t.unit)}</td><td>${esc(t.reference_range || "—")}</td><td><span class="tag-flag ${flagCls[t.flag] || "unclear"}">${flagLbl[t.flag] || "Unclear"}</span></td></tr>
    <tr><td colspan="4" style="color:var(--ink-soft); font-size:.8125rem; padding-top:0;">${esc(t.meaning)}</td></tr>`).join("")}</tbody></table></div>`;
}

let assessmentId = null;
const isGuest = id === "guest";

function render(a) {
  const r = a.result, m = urgencyMeta(r.urgency), lang = getLang();
  document.title = `${a.title || "Your assessment"} — MediMind AI`;

  // emergency notice: from the server's post-check, or recomputed from the stored input (defence in depth)
  const det = detectEmergency(JSON.stringify([a.input?.symptoms, a.input?.associated, a.input?.description, a.input?.transcript]));
  const notice = r.emergency_notice || (r.urgency === "emergency" && det.triggered ? { ...emergencyCopy(det.categories, lang), categories: det.categories } : null);
  $("#emergency-slot").innerHTML = notice ? emergencyBannerHTML({ title: notice.title, body: notice.body, crisis: notice.crisis }) : "";

  const banner = $("#results-banner");
  banner.className = `results-hero-banner ${m.cls}`;
  banner.innerHTML = `<svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="${m.color}" stroke-width="2.2" style="flex-shrink:0;">${ICONS[r.urgency] || ICONS.routine}</svg>
    <div><div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.25rem;"><span style="font-size:0.8125rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:${m.color};">Urgency: ${esc(m.label)}</span></div>
    <h2 style="font-family:var(--font-display); font-size:1.625rem; font-weight:600; margin-bottom:0.25rem; color:var(--ink);">${esc(m.headline)}</h2>
    <p style="font-size:0.9375rem; color:var(--ink-soft);">${esc(m.sub)}</p></div>`;

  const labels = ["Self-care", "Routine", "Urgent", "Emergency"], keys = ["self_care", "routine", "urgent", "emergency"];
  $("#scale-card").innerHTML = `<div class="scale-header"><span class="scale-title">Urgency scale</span><span class="scale-current-badge" style="background:${m.bg}; color:${m.color};">${esc(m.level)}</span></div>
    <div class="scale-ruler"><div class="scale-segment seg-self"></div><div class="scale-segment seg-routine"></div><div class="scale-segment seg-urgent"></div><div class="scale-segment seg-emergency"></div>
    <div class="scale-pointer" style="left:${m.pos}%; border-color:${m.color};"></div></div>
    <div class="scale-labels">${labels.map((l, i) => keys[i] === r.urgency ? `<span class="active" style="color:${m.color};">${l} (Identified)</span>` : `<span>${l}</span>`).join("")}</div>`;

  let html = "";
  html += `<div class="thumbs" id="thumbs"></div>`;
  html += card(I_DOC, r.report_type ? `Summary — ${r.report_type}` : "Assessment Summary", `<p style="font-size:1.0625rem; line-height:1.6; color:var(--ink);">${esc(r.summary)}</p>`);
  if (r.tests) html += card(I_CHECK, "Your Results, Explained", labTable(r.tests));
  if (r.observations?.length || r.photo_quality) {
    html += card(I_INFO, "What Is Visible in the Photo", (r.observations?.length ? ul(r.observations) : "") + (r.photo_quality ? `<p style="margin-top:.75rem; font-size:.875rem; color:var(--ink-soft);"><strong>Photo quality:</strong> ${esc(r.photo_quality)}</p>` : ""));
  }
  if (r.possible_explanations?.length) {
    html += card(I_INFO, "Clinical Considerations", `<p style="font-size:.8125rem; color:var(--ink-muted); margin-bottom:1rem;">These are possibilities to discuss with a clinician — not diagnoses.</p><div style="display:flex; flex-direction:column; gap:1.25rem;">${r.possible_explanations.map((e, i) => `
      <div style="border-left: 3px solid ${i === 0 ? "var(--primary)" : "var(--line)"}; padding-left: 1rem;"><h4 style="font-size:1rem; font-weight:600; color:var(--ink); margin-bottom:0.25rem;">${esc(e.title)}</h4><p style="font-size:0.875rem; color:var(--ink-soft); line-height:1.5;">${esc(e.reasoning)}</p></div>`).join("")}</div>`);
  }
  if (r.missing_information?.length) {
    html += card(I_Q, "Clarifying Questions", `<p style="font-size:0.875rem; color:var(--ink-soft); margin-bottom:1rem;">Answering these details can help sharpen the follow-up suggestions:</p><div style="display:flex; flex-direction:column; gap:0.75rem;">${r.missing_information.map((q, i) => `
      <div class="clarify-row" data-q="${i}"><div class="top"><span style="font-size:0.875rem; color:var(--ink);">${esc(q)}</span>${isGuest ? "" : '<button class="btn btn-secondary" data-add style="min-height:36px; padding:0.25rem 0.75rem; font-size:0.8125rem;">Add detail</button>'}</div></div>`).join("")}</div>`);
  }
  if (r.questions_for_doctor?.length) html += card(I_Q, "Questions to Ask Your Doctor", ul(r.questions_for_doctor));
  if (r.recommended_next_steps?.length) html += card(I_CHECK, "What to Do Next", `<ol class="numbered-step-list">${r.recommended_next_steps.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>`);
  if (r.red_flags_to_watch?.length) html += card(I_WARN, "Warning Signs Requiring Immediate Emergency Care", ul(r.red_flags_to_watch), 'style="border-left: 4px solid var(--u-urgent);"').replace("<h3>", '<h3 style="color:var(--u-urgent);">');
  if (r.limitations?.length) html += card(I_INFO, "Limitations", ul(r.limitations));
  if (r.citations?.length) html += card(I_DOC, "Sources", `<ul class="plain">${r.citations.map((c) => `<li><a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener noreferrer" style="color:var(--primary);">${esc(c.source)}</a></li>`).join("")}</ul>`);

  html += `<div class="disclaimer-card"><strong>For educational purposes only. Not a medical diagnosis.</strong> MediMind AI cannot examine you and can be wrong. If you are worried, your symptoms persist or get worse, or you think it is an emergency, contact a clinician or your local emergency number.</div>`;
  html += `<div class="page-actions no-print" style="justify-content:flex-start; margin-top:1.5rem;">
    <button class="btn btn-primary" id="print-btn"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect></svg> Print or Save as PDF</button>
    <a class="btn btn-secondary" href="text.html">Start New Assessment</a>
    ${isGuest ? '<a class="btn btn-quiet" href="register.html">Create account to save</a>' : '<a class="btn btn-quiet" href="dashboard.html">Saved to your History →</a>'}</div>`;
  $("#main-col").innerHTML = html;
  $("#print-btn").addEventListener("click", () => window.print());
  msg.classList.add("hidden"); $("#results-root").classList.remove("hidden");

  // signed URLs for the photos used (private bucket)
  (a.image_paths || []).forEach(async (p) => {
    const url = await signedUrl("assessment-images", p);
    if (url) $("#thumbs").insertAdjacentHTML("beforeend", `<img src="${esc(url)}" alt="Photo you submitted">`);
  });

  // "Add detail" → sends the answer to the follow-up chat
  $("#main-col").querySelectorAll("[data-add]").forEach((btn) => btn.addEventListener("click", () => {
    const row = btn.closest(".clarify-row");
    if (row.querySelector(".detail")) return row.querySelector("input").focus();
    row.insertAdjacentHTML("beforeend", '<form class="detail"><input type="text" class="input-text" maxlength="500" placeholder="Your answer…" style="min-height:40px; font-size:.875rem;"><button class="btn btn-primary" style="min-height:40px; padding:0 1rem; font-size:.8125rem;">Send</button></form>');
    const form = row.querySelector(".detail"); form.querySelector("input").focus();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const v = form.querySelector("input").value.trim(); if (!v) return;
      const q = row.querySelector("span").textContent;
      form.remove(); $("#chat-panel").scrollIntoView({ behavior: "smooth", block: "center" });
      sendChat(`Additional detail — ${q} ${v}`);
    });
  }));
}

/* ------------------------------------------------------------------ chat */
const log = $("#chat-log");
function bubble(role, text, pending = false) {
  const d = document.createElement("div");
  d.className = `chat-bubble ${role}${pending ? " pending" : ""}`; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight; return d;
}
let busy = false;
async function sendChat(text) {
  if (busy || !assessmentId) return;
  busy = true; $("#chat-send").disabled = true;
  bubble("user", text);
  const wait = bubble("assistant", "Thinking…", true);
  try {
    const out = await callFn("chat-followup", { assessmentId, message: text, language: getLang() });
    wait.classList.remove("pending"); wait.textContent = out.reply;
  } catch (e) { wait.classList.remove("pending"); wait.textContent = e.message; }
  busy = false; $("#chat-send").disabled = false; log.scrollTop = log.scrollHeight;
}
$("#chat-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const i = $("#follow-up-input"), v = i.value.trim(); if (!v) return;
  i.value = ""; sendChat(v);
});

/* ------------------------------------------------------------------ boot */
try {
  if (!id) throw new Error("No assessment selected.");
  if (isGuest) {
    const raw = sessionStorage.getItem("medimind_guest_result");
    if (!raw) throw new Error("This guest result is no longer available. Run a new assessment or sign in.");
    const g = JSON.parse(raw);
    $("#chat-body").classList.add("hidden"); $("#guest-chat").classList.remove("hidden");
    render({ title: g.title, result: g.result, input: { symptoms: g.title }, image_paths: [] });
  } else {
    if (!user) { location.replace(`login.html?next=${encodeURIComponent(`results.html?id=${id}`)}`); await new Promise(() => {}); }
    const a = await getAssessment(id);
    if (!a) throw new Error("Assessment not found. It may have been deleted.");
    assessmentId = a.id;
    render(a);
    const history = await listChat(a.id);
    history.forEach((h) => bubble(h.role, h.content));
  }
} catch (e) {
  msg.innerHTML = `<div class="empty-state"><p style="margin-bottom:1rem;">${esc(e.message)}</p><a class="btn btn-primary" href="dashboard.html">Go to History</a></div>`;
}
