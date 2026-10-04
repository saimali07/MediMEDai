// Shared UI: header/footer chrome, theme, language, toasts, emergency banner, analyzing state, image compression.
import { translations } from "./i18n.js";
import { getSession, requireAuth, signOut } from "./auth.js";
import { isConfigured } from "./supabaseClient.js";
import { hasConsent, recordConsent } from "./api.js";
import { detectEmergency, emergencyCopy, emergencyNumber } from "./safety.js";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ------------------------------------------------------------------ i18n */
let lang = localStorage.getItem("medimind_lang") === "ur" ? "ur" : "en";
export const getLang = () => lang;

export function t(key, vars) {
  let s = translations[lang]?.[key] ?? translations.en[key] ?? key;
  if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, vars[k]);
  return s;
}

function setText(el, value) {
  if (!el.children.length) { el.textContent = value; return; }
  // keep inline icons: replace only the first non-empty text node
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
  if (node) node.nodeValue = ` ${value} `;
}

export function applyI18n(root = document) {
  $$("[data-i18n]", root).forEach((el) => {
    const key = el.dataset.i18n;
    const v = translations[lang]?.[key];
    if (v === undefined) return;
    setText(el, key === "emergency_call" ? v.replace("{n}", emergencyNumber()) : v);
  });
}

export function setLang(l) {
  lang = l === "ur" ? "ur" : "en";
  localStorage.setItem("medimind_lang", lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ur" ? "rtl" : "ltr";
  applyI18n();
  const lbl = $("#lang-label");
  if (lbl) lbl.textContent = lang === "en" ? "اردو" : "English";
  document.dispatchEvent(new CustomEvent("langchange", { detail: lang }));
}
export function toggleLanguage() { setLang(lang === "en" ? "ur" : "en"); showToast(t("lang_switched")); }

/* ----------------------------------------------------------------- theme */
export function toggleTheme() {
  const html = document.documentElement;
  const next = (html.getAttribute("data-theme") || "light") === "light" ? "dark" : "light";
  html.setAttribute("data-theme", next);
  localStorage.setItem("medimind_theme", next);
  showToast(t("theme_switched", { t: next }));
}

/* ----------------------------------------------------------------- toasts */
export function showToast(msg, type = "ok") {
  let container = $("#toast-container");
  if (!container) { container = document.createElement("div"); container.id = "toast-container"; container.className = "toast-container"; container.setAttribute("aria-live", "polite"); document.body.appendChild(container); }
  const toast = document.createElement("div");
  toast.className = `toast${type === "error" ? " error" : ""}`;
  toast.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span></span>';
  toast.querySelector("span").textContent = msg;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = "0"; toast.style.transition = "opacity 300ms ease"; setTimeout(() => toast.remove(), 300); }, type === "error" ? 5000 : 3200);
}

/* --------------------------------------------------------------- chrome */
const NAV = [
  ["assess", "index.html", "nav_assess", "Assess"],
  ["intake", "text.html", "nav_intake", "Symptom Intake"],
  ["reports", "report.html", "nav_reports", "Lab Reports"],
  ["history", "dashboard.html", "nav_history", "History"],
];

const LOGO = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>';
const GLOBE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>';
const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>';
const INFO = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';

function headerHTML(active, signedIn) {
  const links = NAV.map(([id, href, key, label]) => `<li><a class="nav-btn${id === active ? " active" : ""}" href="${href}" data-i18n="${key}">${label}</a></li>`).join("");
  const auth = signedIn
    ? '<button class="btn btn-secondary" id="logout-btn" style="min-height:38px; padding:0.4rem 0.875rem;" data-i18n="nav_logout">Log out</button>'
    : '<a class="btn btn-secondary" href="login.html" style="min-height:38px; padding:0.4rem 0.875rem;" data-i18n="nav_login">Log In</a>';
  return `<header class="header"><div class="header-inner">
    <a href="index.html" class="brand-wrap" aria-label="MediMind AI Home"><div class="brand-icon">${LOGO}</div>
      <div class="brand-name"><span>MediMind</span><span class="brand-tag" data-i18n="tag">AI</span></div></a>
    <nav aria-label="Main Navigation"><ul class="nav-links">${links}</ul></nav>
    <div class="header-controls">
      <button class="lang-toggle" id="lang-btn" aria-label="Switch Language">${GLOBE}<span id="lang-label">اردو</span></button>
      <button class="icon-btn" id="theme-btn" aria-label="Toggle Dark / Light Mode" title="Toggle Theme">${SUN}</button>
      ${auth}
    </div></div></header>`;
}

function footerHTML() {
  return `<footer class="site-footer"><div class="disclaimer-strip">${INFO}
    <span data-i18n="global_disclaimer">Educational information only, not a medical diagnosis. If you are experiencing chest pain, severe breathlessness, or immediate danger, call your local emergency service immediately.</span></div>
    <div class="footer-links"><a href="privacy.html" data-i18n="footer_privacy">Privacy</a><a href="terms.html" data-i18n="footer_terms">Terms</a></div></footer>`;
}

/** Renders header/footer, applies language, and (optionally) enforces login. Returns the user or null. */
export async function initPage({ active = "", auth = "none" } = {}) {
  if (!isConfigured) {
    const warn = document.createElement("div");
    warn.className = "config-warning";
    warn.textContent = "Supabase is not configured yet. Open js/config.js and set SUPABASE_URL and SUPABASE_ANON_KEY (see README).";
    document.body.prepend(warn);
  }
  let session = null;
  try { session = await getSession(); } catch { /* not configured */ }
  const hostH = $("#site-header"), hostF = $("#site-footer");
  if (hostH) hostH.innerHTML = headerHTML(active, !!session);
  if (hostF) hostF.innerHTML = footerHTML();
  if (!$("#toast-container")) { const c = document.createElement("div"); c.id = "toast-container"; c.className = "toast-container"; c.setAttribute("aria-live", "polite"); document.body.appendChild(c); }

  $("#lang-btn")?.addEventListener("click", toggleLanguage);
  $("#theme-btn")?.addEventListener("click", toggleTheme);
  $("#logout-btn")?.addEventListener("click", async () => { await signOut(); location.href = "index.html"; });
  setLang(lang);

  if (auth === "required") return await requireAuth();
  return session?.user ?? null;
}

/* --------------------------------------------------------- emergency UI */
const ALERT = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--u-emergency)" stroke-width="2.2" style="flex-shrink:0"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
const PHONE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>';

export function emergencyBannerHTML({ title, body, crisis = null }) {
  const n = emergencyNumber();
  return `<div class="emergency-banner" role="alert">${ALERT}<div>
    <h4>${esc(title)}</h4><p>${esc(body)}</p>${crisis ? `<p class="crisis-note">${esc(crisis)}</p>` : ""}
    <a href="tel:${esc(n)}" class="emergency-call-btn">${PHONE}<span>${esc(t("emergency_call", { n }))}</span></a></div></div>`;
}

/** Renders the deterministic client-side emergency banner into `el` (or clears it). */
export function showEmergency(el, det) {
  if (!el) return;
  el.innerHTML = det?.triggered ? emergencyBannerHTML(emergencyCopy(det.categories, lang)) : "";
}
/** Renders the banner from the safety payload an Edge Function attaches to error responses. */
export function showEmergencyPayload(el, safety) {
  if (el && safety?.triggered) el.innerHTML = emergencyBannerHTML(safety);
}

/** Runs the safety engine on every keystroke so the warning appears instantly — before any network call. */
export function attachLiveSafety({ fields, banner, getAge }) {
  const run = () => showEmergency(banner, detectEmergency(fields.map((f) => f.value).join("\n"), { age: getAge?.() }));
  fields.forEach((f) => f.addEventListener("input", run));
  document.addEventListener("langchange", run);
  run();
  return run;
}

/* ------------------------------------------------------ urgency helpers */
export const URGENCY = {
  emergency: { cls: "urgency-emergency", color: "var(--u-emergency)", bg: "var(--u-emergency-bg)", pos: 87.5, label: "Emergency", badge: "Emergency", level: "Level 4: Emergency Care", headline: "Call your local emergency number now.", sub: "Your information includes signs that can be life-threatening. Do not wait for an online assessment." },
  urgent: { cls: "urgency-urgent", color: "var(--u-urgent)", bg: "var(--u-urgent-bg)", pos: 62.5, label: "Urgent", badge: "Urgent", level: "Level 3: Urgent Care", headline: "Get medical care today.", sub: "Your information suggests you should be assessed by a clinician within hours." },
  routine: { cls: "urgency-routine", color: "var(--u-routine)", bg: "var(--u-routine-bg)", pos: 37.5, label: "Routine Care", badge: "Routine", level: "Level 2: Routine Primary Care", headline: "Schedule an evaluation with your primary clinician this week.", sub: "Your information does not show emergency markers, but warrants routine medical review." },
  self_care: { cls: "urgency-self", color: "var(--u-self)", bg: "var(--u-self-bg)", pos: 12.5, label: "Self-care", badge: "Self-care", level: "Level 1: Self-care", headline: "This can usually be managed at home — keep an eye on it.", sub: "See a clinician if it lasts longer than expected, gets worse, or you are worried." },
};
export const urgencyMeta = (u) => URGENCY[u] || URGENCY.routine;
export const TYPE_LABEL = { text: "Text Intake", image: "Photo Assessment", voice: "Voice Recording", multimodal: "Combined Assessment", report: "Lab Document Upload" };
export const formatDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export const formatBytes = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/* ----------------------------------------------------- analyzing state */
function analyzerHTML() {
  return `<div class="analyzing-box" role="status" aria-live="polite">
    <div class="scale-card" style="margin-bottom:1.5rem;"><div class="scale-ruler">
      <div class="scale-segment seg-self"></div><div class="scale-segment seg-routine"></div><div class="scale-segment seg-urgent"></div><div class="scale-segment seg-emergency"></div>
      <div class="scale-pointer" data-pointer style="left: 25%; border-color:var(--u-routine);"></div></div></div>
    <div style="display:inline-block; padding:0.5rem; border-radius:50%; background:var(--surface-subtle); color:var(--primary);">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="spin">
        <line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line>
        <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line></svg></div>
    <h3 class="analyzing-status-text" data-msg>Checking for urgent red-flag signs…</h3>
    <p style="font-size:0.9375rem; color:var(--ink-soft); max-width:44ch; margin:0 auto 1.5rem;">Cross-referencing medical reference material and triage thresholds. This can take up to a minute.</p>
    <button class="btn btn-quiet" data-cancel>Cancel Assessment</button></div>`;
}

/** Swaps a form for the calm "analyzing" view. Status text rotates while the real request runs. */
export function createAnalyzer(formEl, mountEl) {
  mountEl.innerHTML = analyzerHTML();
  const ptr = $("[data-pointer]", mountEl), msg = $("[data-msg]", mountEl);
  const steps = ["Checking for urgent red-flag signs…", "Reading what you shared…", "Looking up medical reference material…", "Writing plain-language suggestions…"];
  let timer = null, cancelled = false;
  const show = (i) => { msg.textContent = steps[i]; ptr.style.left = `${25 + i * 15}%`; };
  const stop = () => { clearInterval(timer); mountEl.classList.add("hidden"); formEl.classList.remove("hidden"); };
  $("[data-cancel]", mountEl).addEventListener("click", () => { cancelled = true; stop(); showToast("Assessment cancelled"); });
  return {
    start() {
      cancelled = false; formEl.classList.add("hidden"); mountEl.classList.remove("hidden");
      let i = 0; show(0); window.scrollTo({ top: 0 });
      timer = setInterval(() => { if (i < steps.length - 1) show(++i); }, 2500);
    },
    stop,
    get cancelled() { return cancelled; },
  };
}

/* -------------------------------------------------------------- consent */
/** First-upload consent. Returns a function that returns true when consent is present (and records it). */
export function setupConsent(rowEl) {
  const box = $("input[type=checkbox]", rowEl);
  if (hasConsent()) { box.checked = true; rowEl.classList.add("hidden"); }
  return async () => {
    if (!box.checked) return false;
    if (!hasConsent()) await recordConsent();
    return true;
  };
}

/* ---------------------------------------------------------------- images */
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Validates (jpg/png/webp, ≤ 8 MB) and downsizes/compresses to JPEG on a canvas, honouring EXIF rotation. */
export async function compressImage(file, { maxDim = 1600, quality = 0.85 } = {}) {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Please choose a JPG, PNG or WebP image.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is larger than 8 MB.");
  let bmp;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    bmp = await new Promise((resolve, reject) => {
      const img = new Image(); const url = URL.createObjectURL(file);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("That image could not be read.")); };
      img.src = url;
    });
  }
  const w = bmp.width, h = bmp.height, scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));
  if (!blob) throw new Error("That image could not be processed.");
  return blob;
}

export function setBusy(btn, busy) { btn.disabled = busy; }
export function showError(el, msg) { if (el) el.textContent = msg || ""; }
