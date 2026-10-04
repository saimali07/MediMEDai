// Voice capture: MediaRecorder (audio) + AnalyserNode (waveform) + Web Speech API (live transcript).
// Recordings are converted to 16 kHz mono WAV so Whisper can read them regardless of browser codec.
export const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition || null;
export const speechSupported = !!SpeechRecognitionCtor;
export const MAX_SECONDS = 180;

export class VoiceRecorder {
  constructor({ lang = "en-US", onTick, onLevels, onTranscript, onAutoStop, onSpeechError } = {}) {
    Object.assign(this, { lang, onTick, onLevels, onTranscript, onAutoStop, onSpeechError });
    this.recording = false; this.finalText = ""; this.chunks = [];
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    this.media = new MediaRecorder(this.stream, mime ? { mimeType: mime } : undefined);
    this.chunks = []; this.finalText = ""; this.seconds = 0;
    this.media.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
    this.media.start(1000);

    // waveform
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser(); this.analyser.fftSize = 64;
    src.connect(this.analyser);
    const data = new Uint8Array(this.analyser.frequencyBinCount);
    const loop = () => {
      if (!this.recording) return;
      this.analyser.getByteFrequencyData(data);
      const bars = 12, step = Math.floor(data.length / bars) || 1;
      this.onLevels?.(Array.from({ length: bars }, (_, i) => data[i * step] / 255));
      this.raf = requestAnimationFrame(loop);
    };

    this.recording = true;
    loop();
    this.timer = setInterval(() => {
      this.seconds++; this.onTick?.(this.seconds);
      if (this.seconds >= MAX_SECONDS) this.onAutoStop?.();
    }, 1000);
    this._startSpeech();
  }

  _startSpeech() {
    if (!SpeechRecognitionCtor) return;
    const rec = new SpeechRecognitionCtor();
    rec.lang = this.lang; rec.continuous = true; rec.interimResults = true;
    rec.onresult = (ev) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) this.finalText += (this.finalText ? " " : "") + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      this.onTranscript?.(this.finalText, interim);
    };
    rec.onerror = (e) => { if (e.error !== "no-speech" && e.error !== "aborted") this.onSpeechError?.(e.error); };
    rec.onend = () => { if (this.recording) { try { rec.start(); } catch { /* already started */ } } };
    try { rec.start(); this.rec = rec; } catch { /* ignore */ }
  }

  setLang(l) { this.lang = l; }

  async stop() {
    this.recording = false;
    clearInterval(this.timer); cancelAnimationFrame(this.raf);
    try { this.rec?.stop(); } catch { /* ignore */ }
    const blob = await new Promise((resolve) => {
      if (!this.media || this.media.state === "inactive") return resolve(new Blob(this.chunks, { type: this.media?.mimeType || "audio/webm" }));
      this.media.onstop = () => resolve(new Blob(this.chunks, { type: this.media.mimeType || "audio/webm" }));
      this.media.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    try { await this.ctx?.close(); } catch { /* ignore */ }
    this.onLevels?.(Array(12).fill(0));
    return blob;
  }
}

/* ---- WAV conversion: decode → mono → 16 kHz → 16-bit PCM ---- */
export async function blobToWav(blob, maxSeconds = 300) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC();
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    await ctx.close();
    if (decoded.duration > maxSeconds) throw new Error("too_long");
    const rate = 16000, frames = Math.ceil(decoded.duration * rate);
    const off = new OfflineAudioContext(1, frames, rate);
    const src = off.createBufferSource(); src.buffer = decoded; src.connect(off.destination); src.start();
    const rendered = await off.startRendering();
    return encodeWav(rendered.getChannelData(0), rate);
  } catch (e) {
    if (e.message === "too_long") throw new Error(`Audio is longer than ${Math.round(maxSeconds / 60)} minutes.`);
    return null; // could not decode — caller may fall back to the original file
  }
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2), v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
  return new Blob([buf], { type: "audio/wav" });
}

export const fmtTimer = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
