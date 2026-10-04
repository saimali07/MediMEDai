import { initPage, $, $$, showToast, showError, attachLiveSafety, showEmergencyPayload, createAnalyzer, setupConsent, getLang } from "../ui.js";
import { callFn, uploadFile, removeFiles } from "../api.js";
import { VoiceRecorder, blobToWav, speechSupported, fmtTimer } from "../recorder.js";

await initPage({ active: "intake", auth: "required" });
const analyzer = createAnalyzer($("#form-section"), $("#analyzing"));
const consentOk = setupConsent($("#consent-row"));
const banner = $("#live-banner");
const box = $("#voice-transcript"), status = $("#voice-status");
const runSafety = attachLiveSafety({ fields: [box], banner });

let recorder = null, audioBlob = null, audioPath = null, committed = "";
const bars = $$(".wave-bar");

if (!speechSupported) status.textContent = "Live transcript isn't supported in this browser. Record or upload audio, then tap “Transcribe with AI” — or type below.";
const langMap = { en: "en-US", ur: "ur-PK" };
$("#speech-lang").value = langMap[getLang()] || "en-US";
$("#speech-lang").addEventListener("change", (e) => recorder?.setLang(e.target.value));

function setAudio(blob) {
  audioBlob = blob; audioPath = null;
  const p = $("#playback"); p.src = URL.createObjectURL(blob); p.classList.remove("hidden");
  $("#transcribe-btn").classList.toggle("hidden", !(blob && (!box.value.trim() || !speechSupported)));
}

async function startRec() {
  if (!navigator.mediaDevices?.getUserMedia) return showError($("#form-error"), "This browser cannot record audio. Upload an audio file or type your symptoms instead.");
  committed = box.value.trim();
  recorder = new VoiceRecorder({
    lang: $("#speech-lang").value,
    onTick: (s) => { $("#recording-timer").textContent = fmtTimer(s); },
    onLevels: (lv) => bars.forEach((b, i) => { b.style.height = `${8 + Math.round((lv[i] || 0) * 36)}px`; b.classList.toggle("active", (lv[i] || 0) > 0.05); }),
    onTranscript: (final, interim) => { box.value = [committed, final, interim].filter(Boolean).join(" "); runSafety(); },
    onAutoStop: () => stopRec(),
    onSpeechError: (e) => { if (e === "not-allowed") showToast("Speech recognition permission was denied — you can still type or use AI transcription.", "error"); },
  });
  try { await recorder.start(); }
  catch { recorder = null; return showError($("#form-error"), "Microphone access was blocked. Allow it in your browser, or upload an audio file instead."); }
  showError($("#form-error"), "");
  $("#record-btn").classList.add("recording");
  status.textContent = "Recording… tap again to stop.";
  showToast("Recording started (speak naturally)");
}

async function stopRec() {
  if (!recorder) return;
  const r = recorder; recorder = null;
  $("#record-btn").classList.remove("recording");
  const raw = await r.stop();
  box.value = [committed, r.finalText].filter(Boolean).join(" "); runSafety();
  status.textContent = "Recording saved. Review and edit the transcript below.";
  const wav = await blobToWav(raw).catch(() => null);
  setAudio(wav || raw);
  if (!box.value.trim()) { status.textContent = "No live transcript captured — transcribing with AI…"; transcribeWithAI(); }
}

$("#record-btn").addEventListener("click", () => (recorder ? stopRec() : startRec()));

$("#upload-audio-btn").addEventListener("click", () => $("#audio-input").click());
$("#audio-input").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  if (f.size > 10 * 1024 * 1024) return showError($("#form-error"), "That audio file is larger than 10 MB.");
  try {
    const wav = await blobToWav(f);
    if (wav) setAudio(wav);
    else if (/^audio\/(wav|x-wav|mpeg|mp3|ogg|flac)$/.test(f.type)) setAudio(f);
    else return showError($("#form-error"), "That audio format isn't supported. Use WAV, MP3, OGG or FLAC.");
    showError($("#form-error"), ""); status.textContent = "Audio loaded. Tap “Transcribe with AI”.";
    $("#transcribe-btn").classList.remove("hidden");
  } catch (err) { showError($("#form-error"), err.message); }
});

async function ensureAudioUploaded() {
  if (!audioPath) audioPath = await uploadFile("audio", audioBlob, audioBlob.type.split(";")[0] || "audio/wav");
  return audioPath;
}

async function transcribeWithAI() {
  if (!audioBlob) return;
  const btn = $("#transcribe-btn"); btn.disabled = true; showError($("#form-error"), "");
  if (!(await consentOk())) { btn.disabled = false; return showError($("#form-error"), "Please tick the consent box first."); }
  try {
    status.textContent = "Transcribing with AI…";
    const out = await callFn("assess-voice", { audio: { path: await ensureAudioUploaded() }, transcribeOnly: true, language: getLang(), speech_lang: $("#speech-lang").value.slice(0, 2) });
    box.value = out.transcript; runSafety();
    status.textContent = "Transcript ready — please check it and fix any mistakes.";
  } catch (e) { showError($("#form-error"), e.message); showEmergencyPayload(banner, e.safety); status.textContent = ""; }
  btn.disabled = false;
}
$("#transcribe-btn").addEventListener("click", transcribeWithAI);

$("#analyze-btn").addEventListener("click", async () => {
  const err = $("#form-error"); showError(err, "");
  if (recorder) await stopRec();
  const transcript = box.value.trim();
  if (!transcript && !audioBlob) return showError(err, "Record, upload or type something first.");
  if (!(await consentOk())) return showError(err, "Please tick the consent box to continue.");
  analyzer.start();
  try {
    const body = { language: getLang(), speech_lang: $("#speech-lang").value.slice(0, 2) };
    if (transcript) { body.transcript = transcript; if (audioPath) body.audio = { path: audioPath }; }
    else body.audio = { path: await ensureAudioUploaded() };
    const out = await callFn("assess-voice", body);
    if (analyzer.cancelled) return;
    location.href = `results.html?id=${encodeURIComponent(out.id)}`;
  } catch (e) {
    if (!analyzer.cancelled) { analyzer.stop(); showError(err, e.message); showEmergencyPayload(banner, e.safety); showToast(e.message, "error"); }
  }
});
