// Client-side safety engine: shows the emergency warning instantly, before any network call.
// The regex rules below mirror supabase/functions/_shared/safety.ts — keep both in sync.
// ---- Emergency rules (English, Roman Urdu, Urdu script). Keep client + server copies identical. ----
const RULES = [
  { id: "breathing", patterns: [
    /\b(?:can['’]?t|cannot|can not|unable to|not able to|struggling to|trouble|difficulty|hard to)\s+(?:to\s+|in\s+)?(?:breathe|breathing)\b/i,
    /\b(?:short(?:ness)? of breath|gasping(?: for (?:air|breath))?|choking|suffocat\w*|stopped breathing)\b/i,
    /\b(?:saans|sans|sanse|saanse)\s+(?:nahi|nahin|nhi|nai)\b/i,
    /\b(?:saans|sans)\s+(?:lene|lenay|phool|ruk)\w*/i,
    /سانس\s*(?:نہیں|نہی|لینے میں|پھول|رک)/
  ]},
  { id: "chest_pain", patterns: [
    /\bchest\s+(?:pain|pains|pressure|tightness|tight|discomfort|heaviness)\b/i,
    /\bcrushing\s+(?:chest|pain|pressure)\b/i,
    /\bheart\s+attack\b/i,
    /\b(?:seene|sine|seena|sina)\s+(?:mein|me|main|mai|ka)?\s*(?:dard|bhaari|bhari|jakar|jalan)\b/i,
    /سینے\s*(?:میں)?\s*(?:درد|بھاری|جکڑن|دباؤ)/
  ]},
  { id: "stroke", patterns: [
    /\b(?:slurred speech|speech (?:is )?slurred|slurring|face (?:is )?droop\w*|facial droop\w*|droop\w* (?:face|mouth)|one[- ]sided (?:weakness|numbness)|(?:sudden|new) (?:weakness|numbness|confusion|loss of vision|vision loss)|can['’]?t (?:move|lift|feel) (?:my |the )?(?:arm|leg|face|hand)|worst headache (?:of|in) my life|thunderclap)\b/i,
    /\bstroke\b/i,
    /\b(?:falij|zuban\s+(?:larkhara|largara|laghar)\w*|chehra\s+(?:terha|tedha))\b/i,
    /فالج|زبان\s*(?:لڑکھڑا|بند)|چہرہ\s*(?:ٹیڑھا|ٹیڑھی)/
  ]},
  { id: "unconscious", patterns: [
    /\b(?:passed out|pass(?:ed|ing)? out|fainted|fainting|unconscious|unresponsive|not responding|collapsed|blacked out|loss of consciousness|lost consciousness|not waking up|won['’]?t wake up)\b/i,
    /\b(?:behosh|bayhosh|be\s*hosh|hosh\s+(?:nahi|nahin|kho))\b/i,
    /بے\s*ہوش|ہوش\s*(?:نہیں|کھو)/
  ]},
  { id: "severe_bleeding", patterns: [
    /\b(?:bleeding (?:profusely|heavily|badly|a lot|non[- ]?stop|won['’]?t stop)|(?:severe|heavy|profuse|uncontrolled|massive) bleeding|won['’]?t stop bleeding|can['’]?t stop (?:the )?bleeding|blood (?:is )?(?:gushing|pouring|spurting)|(?:vomit\w*|coughing|spitting) (?:up )?blood)\b/i,
    /\b(?:khoon\s+(?:bahut|bohat|nahi ruk|nahin ruk|ruk nahi|beh)|bohat\s+khoon|khoon\s+ki\s+(?:ulti|qay)|ulti\s+mein\s+khoon)\b/i,
    /خون\s*(?:بہت|نہیں رک|بہہ|بہ رہا)|خون کی (?:قے|الٹی)/
  ]},
  { id: "anaphylaxis", patterns: [
    /\b(?:throat (?:is )?(?:swelling|closing|tight|swollen)|tongue (?:is )?swell\w*|swollen (?:tongue|throat)|anaphyla\w*)\b/i,
    /\b(?:gala|halaq)\s+(?:band|sooj|sooja|phool)\w*/i,
    /گلا\s*(?:بند|سوج|پھول)/
  ]},
  { id: "seizure", patterns: [
    /\b(?:seiz\w+|convuls\w+|having a fit|had a fit|epileptic fit)\b/i,
    /\b(?:mirgi|daura\s+pad\w*|dora\s+pad\w*)\b/i,
    /مرگی|دورہ\s*پڑ/
  ]},
  { id: "infant_fever", patterns: [
    /\b(?:newborn|new-born|infant|baby|neonate)\b[^.?!]{0,60}\b(?:fever|high temperature|temperature|bukhar)\b/i,
    /\b(?:fever|high temperature|bukhar)\b[^.?!]{0,60}\b(?:newborn|new-born|infant|baby|neonate)\b/i,
    /\b(?:[1-9]|1[0-2]?)\s*(?:day|days|week|weeks)[- ]?old\b[^.?!]{0,60}\b(?:fever|temperature)\b/i,
    /\b[1-2]\s*(?:month|months)[- ]?old\b[^.?!]{0,60}\b(?:fever|temperature)\b/i,
    /(?:نوزائیدہ|شیر خوار)[^.؟!]{0,40}بخار|بخار[^.؟!]{0,40}(?:نوزائیدہ|شیر خوار)/
  ]},
  { id: "self_harm", patterns: [
    /\b(?:suicid\w*|kill (?:myself|my self)|end (?:my|this) life|end it all|want to die|wanna die|take my (?:own )?life|self[- ]?harm\w*|hurt(?:ing)? myself|cut(?:ting)? myself|don['’]?t want to (?:live|be alive)|better off dead|no reason to live)\b/i,
    /\b(?:khudkushi|khud\s*kushi|khud\s*kashi|marna\s+chah\w*|jaan\s+de\s+\w+|zindagi\s+khatam)\b/i,
    /خودکشی|مرنا\s*چاہ|جان\s*دے|زندگی\s*ختم/
  ]}
];

// "no chest pain" / "without chest pain" should not trigger (except for categories where negation is part of the phrase).
const NEGATION = /\b(?:no|without|denies|denied|never|not having|don['’]?t have|doesn['’]?t have|nahi|nahin)\s+(?:[\w'’-]+\s+){0,2}$/i;
const NEGATION_EXEMPT = new Set(["breathing", "self_harm", "infant_fever"]);
// ---- Emergency copy (shared data) ----
const LABELS = {
  en: {
    breathing: "difficulty breathing", chest_pain: "chest pain or pressure", stroke: "possible stroke signs",
    unconscious: "loss of consciousness", severe_bleeding: "severe bleeding",
    anaphylaxis: "throat or tongue swelling / a severe allergic reaction", seizure: "a seizure",
    infant_fever: "fever in a newborn or young infant", self_harm: "thoughts of self-harm or suicide"
  },
  ur: {
    breathing: "سانس لینے میں دشواری", chest_pain: "سینے میں درد یا دباؤ", stroke: "فالج کی ممکنہ علامات",
    unconscious: "بے ہوشی", severe_bleeding: "شدید خون بہنا",
    anaphylaxis: "گلے یا زبان کی سوجن / شدید الرجی", seizure: "دورہ (مرگی)",
    infant_fever: "نوزائیدہ یا چھوٹے بچے کو بخار", self_harm: "خود کو نقصان پہنچانے یا خودکشی کے خیالات"
  }
};
const COPY = {
  en: {
    title: "Immediate Emergency Assistance Needed",
    body: (labels) => `Your message mentions ${labels}. These can be life-threatening. Call your local emergency number now (for example 1122 in Pakistan, 911 in the US, 999 in the UK, 112 in the EU) or go to the nearest emergency department. Do not wait for this assessment.`,
    steps: [
      "Call your local emergency number now, or ask someone nearby to call.",
      "Do not drive yourself. Stay with someone if you can.",
      "Tell the responders the symptoms you described here."
    ],
    crisis: "If you are thinking about harming yourself, you are not alone and help is available right now. Call your local emergency number, or contact a crisis line (in the US call or text 988; in the UK call Samaritans on 116 123; elsewhere findahelpline.com lists free local helplines). If you can, stay with someone you trust."
  },
  ur: {
    title: "فوری طبی امداد کی ضرورت ہے",
    body: (labels) => `آپ کے پیغام میں ${labels} کا ذکر ہے۔ یہ جان لیوا ہو سکتا ہے۔ ابھی اپنے مقامی ایمرجنسی نمبر پر کال کریں (پاکستان میں 1122، امریکہ میں 911، برطانیہ میں 999، یورپی یونین میں 112) یا قریبی ایمرجنسی میں جائیں۔ اس جائزے کا انتظار نہ کریں۔`,
    steps: [
      "ابھی اپنے مقامی ایمرجنسی نمبر پر کال کریں یا قریب موجود کسی شخص سے کال کروائیں۔",
      "خود گاڑی نہ چلائیں۔ ممکن ہو تو کسی کے ساتھ رہیں۔",
      "عملے کو وہی علامات بتائیں جو آپ نے یہاں لکھی ہیں۔"
    ],
    crisis: "اگر آپ خود کو نقصان پہنچانے کا سوچ رہے ہیں تو آپ اکیلے نہیں ہیں، مدد ابھی دستیاب ہے۔ اپنے مقامی ایمرجنسی نمبر پر کال کریں یا کسی ہیلپ لائن سے رابطہ کریں (findahelpline.com پر آپ کے ملک کی مفت ہیلپ لائنز ملتی ہیں)۔ ممکن ہو تو کسی قابلِ اعتماد شخص کے ساتھ رہیں۔"
  }
};
const DOSAGE_RE = /\b(?:dos(?:e|es|age|ing)|mg|milligrams?|prescri\w+|how (?:many|much) (?:tablets?|pills?|capsules?|ml|drops?)|(?:can|should|may|could) i (?:take|use|give|have) (?:\w+ ){0,3}(?:tablets?|pills?|capsules?|medicines?|medications?|drugs?|painkillers?|antibiotics?|syrup|paracetamol|acetaminophen|ibuprofen|aspirin|antihistamines?)|kitni\s+(?:dawai|goli)|dawai\s+ka\s+dose)\b/i;

export function detectEmergency(text, ctx = {}) {
  const t = String(text ?? "").normalize("NFKC");
  const cats = new Set();
  for (const rule of RULES) {
    for (const re of rule.patterns) {
      const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
      let m;
      while ((m = g.exec(t)) !== null) {
        const before = t.slice(Math.max(0, m.index - 40), m.index);
        if (NEGATION_EXEMPT.has(rule.id) || !NEGATION.test(before)) { cats.add(rule.id); break; }
        if (m[0].length === 0) g.lastIndex++;
      }
      if (cats.has(rule.id)) break;
    }
  }
  if (ctx.age != null && ctx.age < 1 && /\b(?:fever|temperature|bukhar)\b|بخار/i.test(t)) cats.add("infant_fever");
  const categories = [...cats];
  return { triggered: categories.length > 0, categories, selfHarm: cats.has("self_harm") };
}

export function emergencyCopy(categories, lang = "en") {
  const L = lang === "ur" ? "ur" : "en";
  const labels = categories.map((c) => LABELS[L][c]).filter(Boolean).join(L === "ur" ? "، " : ", ");
  return {
    title: COPY[L].title,
    body: COPY[L].body(labels),
    steps: COPY[L].steps,
    crisis: categories.includes("self_harm") ? COPY[L].crisis : null,
  };
}

export function asksForDosage(text) { return DOSAGE_RE.test(String(text ?? "")); }

/** Best-effort local emergency number from the browser time zone (display only). */
export function emergencyNumber() {
  let tz = "";
  try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch { /* ignore */ }
  if (tz === "Asia/Karachi") return "1122";
  if (tz === "Europe/London") return "999";
  if (tz.startsWith("Europe/")) return "112";
  if (tz.startsWith("Australia/")) return "000";
  if (tz === "Asia/Kolkata" || tz === "Asia/Calcutta") return "112";
  return "911";
}

// ---- Landing-page live demo (client-only keyword triage, illustrative) ----
const URGENT_KEYWORDS = ["deep cut", "high fever", "broken", "fracture", "active bleeding", "vomiting blood", "severe pain", "swollen ankle", "throbbing"];
const ROUTINE_KEYWORDS = ["cough", "mild fever", "rash", "dull ache", "two weeks", "sore throat", "fatigue", "ear ache", "stomach ache"];

/** Returns "emergency" | "urgent" | "routine" | "self_care" for the landing demo ruler. */
export function classifyDemo(text) {
  if (detectEmergency(text).triggered) return "emergency";
  const lower = String(text ?? "").toLowerCase();
  if (URGENT_KEYWORDS.some((k) => lower.includes(k))) return "urgent";
  if (ROUTINE_KEYWORDS.some((k) => lower.includes(k))) return "routine";
  return "self_care";
}
