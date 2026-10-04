#!/usr/bin/env node
// Seeds public health content (MedlinePlus, NHS, CDC, WHO) into knowledge_chunks for RAG citations.
// Retrieval uses Postgres full-text search, so no embedding API (and no AI key) is needed here.
//
// Usage (Node 18+):
//   PowerShell:  $env:SUPABASE_URL="https://xxxx.supabase.co"; $env:SUPABASE_SERVICE_ROLE_KEY="..."; node supabase/scripts/seed_knowledge.mjs
//   Optional:    node supabase/scripts/seed_knowledge.mjs extra-urls.txt   (one URL per line)
//
// The service-role key is used ONLY here, on your own machine. Never put it in the frontend.
import fs from "node:fs";

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.");
  process.exit(1);
}

const SOURCES = [
  ["MedlinePlus", "https://medlineplus.gov/headache.html"],
  ["MedlinePlus", "https://medlineplus.gov/cough.html"],
  ["MedlinePlus", "https://medlineplus.gov/fever.html"],
  ["MedlinePlus", "https://medlineplus.gov/chestpain.html"],
  ["MedlinePlus", "https://medlineplus.gov/rashes.html"],
  ["MedlinePlus", "https://medlineplus.gov/backpain.html"],
  ["MedlinePlus", "https://medlineplus.gov/sorethroat.html"],
  ["MedlinePlus", "https://medlineplus.gov/diarrhea.html"],
  ["MedlinePlus", "https://medlineplus.gov/stroke.html"],
  ["MedlinePlus", "https://medlineplus.gov/heartattack.html"],
  ["MedlinePlus", "https://medlineplus.gov/allergy.html"],
  ["MedlinePlus", "https://medlineplus.gov/anemia.html"],
  ["MedlinePlus", "https://medlineplus.gov/bloodtests.html"],
  ["MedlinePlus", "https://medlineplus.gov/cholesterol.html"],
  ["MedlinePlus", "https://medlineplus.gov/diabetes.html"],
  ["MedlinePlus", "https://medlineplus.gov/urinarytractinfections.html"],
  ["MedlinePlus", "https://medlineplus.gov/burns.html"],
  ["MedlinePlus", "https://medlineplus.gov/dehydration.html"],
  ["NHS", "https://www.nhs.uk/conditions/headaches/"],
  ["NHS", "https://www.nhs.uk/conditions/fever-in-adults/"],
  ["NHS", "https://www.nhs.uk/conditions/cough/"],
  ["NHS", "https://www.nhs.uk/conditions/sore-throat/"],
  ["NHS", "https://www.nhs.uk/conditions/stroke/"],
  ["NHS", "https://www.nhs.uk/conditions/anaphylaxis/"],
  ["CDC", "https://www.cdc.gov/heart-disease/about/heart-attack.html"],
  ["WHO", "https://www.who.int/news-room/fact-sheets/detail/anaemia"],
];
const extra = process.argv[2] && fs.existsSync(process.argv[2])
  ? fs.readFileSync(process.argv[2], "utf8").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((u) => [new URL(u).hostname.replace(/^www\./, ""), u])
  : [];

function htmlToText(html) {
  let h = html.replace(/<(script|style|nav|header|footer|aside|form|noscript|svg)[\s\S]*?<\/\1>/gi, " ");
  const main = h.match(/<main[\s\S]*?<\/main>/i) || h.match(/<article[\s\S]*?<\/article>/i);
  if (main) h = main[0];
  return h.replace(/<\/(p|li|h[1-6]|div|tr|br)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, "'").replace(/&[a-z]+;/g, " ")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter((l) => l.length > 25).join("\n");
}

function chunk(text, size = 900, overlap = 120) {
  const paras = text.split("\n"), out = [];
  let cur = "";
  for (const p of paras) {
    if ((cur + " " + p).length > size && cur) { out.push(cur.trim()); cur = cur.slice(-overlap) + " " + p; } else cur += (cur ? " " : "") + p;
  }
  if (cur.trim().length > 80) out.push(cur.trim());
  return out;
}

const rest = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init, headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal", ...(init.headers || {}) },
});

let total = 0;
for (const [source, url] of [...SOURCES, ...extra]) {
  try {
    const res = await fetch(url, { headers: { "User-Agent": "MediMindSeeder/1.0 (educational project)" } });
    if (!res.ok) { console.warn(`skip ${url} (HTTP ${res.status})`); continue; }
    const chunks = chunk(htmlToText(await res.text()));
    if (!chunks.length) { console.warn(`skip ${url} (no readable text)`); continue; }
    const rows = [];
    for (const c of chunks.slice(0, 12)) rows.push({ source, url, content: c });
    await rest(`knowledge_chunks?url=eq.${encodeURIComponent(url)}`, { method: "DELETE" });
    const ins = await rest("knowledge_chunks", { method: "POST", body: JSON.stringify(rows) });
    if (!ins.ok) throw new Error(`insert failed: HTTP ${ins.status} ${await ins.text()}`);
    total += rows.length;
    console.log(`ok   ${rows.length} chunks  ${url}`);
  } catch (e) {
    console.warn(`skip ${url}: ${e.message}`);
  }
}
console.log(`Done. ${total} chunks stored.`);
