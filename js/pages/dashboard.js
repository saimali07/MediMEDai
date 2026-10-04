import { initPage, $, esc, showToast, urgencyMeta, TYPE_LABEL, formatDate } from "../ui.js";
import { listAssessments, deleteAssessment, deleteAllData } from "../api.js";

await initPage({ active: "history", auth: "required" });
const list = $("#history-list");
const TRASH = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>';

function empty() {
  list.innerHTML = '<div class="empty-state"><p style="margin-bottom:1rem;">No assessments yet.</p><a class="btn btn-primary" href="text.html">Start your first assessment</a></div>';
}

function item(a) {
  const m = urgencyMeta(a.urgency);
  return `<div class="history-card-item" data-id="${esc(a.id)}">
    <div style="display:flex; align-items:center; gap:1rem; min-width:0;">
      <div class="mini-tick" style="background:${m.color};" title="${esc(m.label)} level"></div>
      <div style="min-width:0;">
        <div style="display:flex; align-items:center; gap:0.5rem; margin-bottom:0.25rem; flex-wrap:wrap;">
          <span style="font-weight:600; font-size:0.9375rem; color:var(--ink);">${esc(a.title || TYPE_LABEL[a.type] || "Assessment")}</span>
          <span class="scale-current-badge" style="background:${m.bg}; color:${m.color}; font-size:0.75rem; padding:1px 6px;">${esc(m.badge)}</span>
        </div>
        <p style="font-size:0.8125rem; color:var(--ink-soft);">${esc(formatDate(a.created_at))} · ${esc(TYPE_LABEL[a.type] || a.type)}</p>
      </div>
    </div>
    <div style="display:flex; gap:0.5rem;">
      <a class="btn btn-secondary" style="min-height:36px; padding:0.25rem 0.75rem; font-size:0.8125rem;" href="results.html?id=${encodeURIComponent(a.id)}">View Report</a>
      <button class="btn btn-quiet" data-del aria-label="Delete assessment" style="min-height:36px; padding:0.25rem 0.5rem; color:var(--ink-muted);">${TRASH}</button>
    </div></div>`;
}

async function load() {
  try {
    const rows = await listAssessments();
    list.innerHTML = rows.length ? rows.map(item).join("") : "";
    if (!rows.length) empty();
  } catch (e) {
    list.innerHTML = `<div class="empty-state">Could not load your history: ${esc(e.message)}</div>`;
  }
}

list.addEventListener("click", async (e) => {
  const btn = e.target.closest("[data-del]");
  if (!btn) return;
  const row = btn.closest(".history-card-item");
  if (!confirm("Delete this assessment and its uploaded files? This cannot be undone.")) return;
  btn.disabled = true;
  try {
    await deleteAssessment(row.dataset.id);
    row.remove();
    showToast("Assessment deleted from history");
    if (!list.querySelector(".history-card-item")) empty();
  } catch (err) { btn.disabled = false; showToast(err.message, "error"); }
});

$("#delete-all").addEventListener("click", async (e) => {
  if (!confirm("Delete ALL your assessments, chats, photos, voice files and lab reports? This cannot be undone.")) return;
  if (!confirm("Last check — really delete everything?")) return;
  e.target.disabled = true;
  try { await deleteAllData(); empty(); showToast("All your data was deleted"); }
  catch (err) { showToast(err.message, "error"); }
  e.target.disabled = false;
});

await load();
