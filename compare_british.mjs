// Generate Standard British English (RP) samples for all 30 Gemini TTS voices
// and emit a clickable comparison page.
//
// Usage:
//   node compare_british.mjs              # all voices × all phrases
//   LIMIT_VOICES=3 node compare_british.mjs
//   ONLY_VOICE=Achernar node compare_british.mjs

import { writeFileSync, mkdirSync, readFileSync, existsSync, copyFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(DIR, "compare", "audio");
const HTML_PATH = join(DIR, "compare", "index.html");
const MANIFEST_PATH = join(DIR, "compare", "manifest.json");
const PROJECT = "project-7512206b-7586-4bc6-ab2";
const SAMPLE_RATE = 24000;
const MODEL = "gemini-3.1-flash-tts-preview";
const ENDPOINT = `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${MODEL}:generateContent`;

const VOICES = [
  { name: "Achernar", gender: "Female", character: "Soft" },
  { name: "Aoede", gender: "Female", character: "Breezy" },
  { name: "Autonoe", gender: "Female", character: "Bright" },
  { name: "Callirrhoe", gender: "Female", character: "Easy-going" },
  { name: "Despina", gender: "Female", character: "Smooth" },
  { name: "Erinome", gender: "Female", character: "Clear" },
  { name: "Gacrux", gender: "Female", character: "Mature" },
  { name: "Kore", gender: "Female", character: "Firm" },
  { name: "Laomedeia", gender: "Female", character: "Upbeat" },
  { name: "Leda", gender: "Female", character: "Youthful" },
  { name: "Pulcherrima", gender: "Female", character: "Forward" },
  { name: "Sulafat", gender: "Female", character: "Warm" },
  { name: "Vindemiatrix", gender: "Female", character: "Gentle" },
  { name: "Zephyr", gender: "Female", character: "Bright" },
  { name: "Achird", gender: "Male", character: "Friendly" },
  { name: "Algenib", gender: "Male", character: "Gravelly" },
  { name: "Algieba", gender: "Male", character: "Smooth" },
  { name: "Alnilam", gender: "Male", character: "Firm" },
  { name: "Charon", gender: "Male", character: "Informative" },
  { name: "Enceladus", gender: "Male", character: "Breathy" },
  { name: "Fenrir", gender: "Male", character: "Excitable" },
  { name: "Iapetus", gender: "Male", character: "Clear" },
  { name: "Orus", gender: "Male", character: "Firm" },
  { name: "Puck", gender: "Male", character: "Upbeat" },
  { name: "Rasalgethi", gender: "Male", character: "Informative" },
  { name: "Sadachbia", gender: "Male", character: "Lively" },
  { name: "Sadaltager", gender: "Male", character: "Knowledgeable" },
  { name: "Schedar", gender: "Male", character: "Even" },
  { name: "Umbriel", gender: "Male", character: "Easy-going" },
  { name: "Zubenelgenubi", gender: "Male", character: "Casual" },
];

const PHRASES = [
  { id: "please-speak", text: "Please speak", tag: "gently" },
  { id: "im-here", text: "I'm here", tag: "warmly" },
  { id: "hello", text: "Hello", tag: "warmly" },
  { id: "good-morning", text: "Good morning", tag: "warmly" },
  { id: "nice-to-see-you-again", text: "Nice to see you again", tag: "warmly" },
  { id: "im-listening", text: "I'm listening", tag: "warmly" },
  {
    id: "rp-probe",
    text: "Good afternoon. I can't schedule that after half past four.",
    tag: "warmly",
  },
];

const US_REF = {
  "please-speak": "01-please-speak.wav",
  "im-here": "02-i-m-here.wav",
  hello: "03-hello.wav",
  "good-morning": "05-good-morning.wav",
  "nice-to-see-you-again": "11-nice-to-see-you-again.wav",
  "im-listening": "16-i-m-listening.wav",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findAdcPath() {
  const candidates = [];
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    candidates.push(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  if (process.env.APPDATA) {
    candidates.push(join(process.env.APPDATA, "gcloud", "application_default_credentials.json"));
  }
  candidates.push(join(homedir(), ".config", "gcloud", "application_default_credentials.json"));
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  throw new Error(`ADC credentials not found. Tried: ${candidates.join(", ")}`);
}

function buildPrompt({ text, tag }) {
  return `Synthesize speech for the performance defined below. The profile, scene, performance notes, and context are direction only. Do NOT speak them. Speak ONLY the lines under #### TRANSCRIPT.

# AUDIO PROFILE: Nova
## "In-car voice assistant"

## SCENE: Cabin after the wake word
The driver has just called the assistant. Soft daylight in a quiet car cabin. The reply comes from the speakers, close and kind, like a copilot turning toward the driver with a small smile, ready to help.

### PERFORMANCE
Style: Warm, kind, and welcoming, with a vocal smile. Soft and pleasant. Never angry, never stern, never impatient, never clipped, never commanding. A helpful copilot who is glad the driver spoke.
Pace: Easy conversational greeting. Patient and unhurried, with a natural landing at the end.
Accent: Standard British English, Received Pronunciation (RP), as spoken by a BBC newsreader in London. Southern British, non-rhotic. Not Cockney, not Estuary, not Northern, not Scottish, not Irish, not Welsh, not Australian, not American.

### CONTEXT
One short acknowledgment after the wake word. This is an invitation to talk, not an order.

#### TRANSCRIPT
[${tag}] ${text}`;
}

function pcmToWav(pcm, sampleRate = SAMPLE_RATE) {
  const header = Buffer.alloc(44);
  const dataSize = pcm.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

function analyzePcm(buf) {
  const n = buf.length >> 1;
  let peak = 0;
  let clip = 0;
  const win = 2400;
  const env = [];
  let winSq = 0;
  let winN = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
    if (a >= 32767) clip++;
    winSq += s * s;
    winN++;
    if (winN === win || i === n - 1) {
      env.push(Math.sqrt(winSq / winN));
      winSq = 0;
      winN = 0;
    }
  }
  let bursts = 0;
  let on = false;
  for (const e of env) {
    if (e > 800 && !on) {
      bursts++;
      on = true;
    } else if (e < 400) {
      on = false;
    }
  }
  return { seconds: n / SAMPLE_RATE, peak, clip, bursts };
}

function qualityIssue(phrase, stats) {
  const words = phrase.text.trim().split(/\s+/).length;
  const minSec = 0.45;
  const maxSec = Math.min(8.5, 1.3 + 0.55 * words);
  if (stats.seconds < minSec) return `too short (${stats.seconds.toFixed(2)}s)`;
  if (stats.seconds > maxSec) return `too long (${stats.seconds.toFixed(2)}s)`;
  if (stats.clip > 40) return `clipping (${stats.clip})`;
  if (stats.peak < 4000) return `too quiet (peak ${stats.peak})`;
  return null;
}

async function getAccessToken() {
  const adc = JSON.parse(readFileSync(findAdcPath(), "utf8"));
  if (adc.type !== "authorized_user") {
    throw new Error(`Unsupported ADC type: ${adc.type}`);
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: HTTP ${res.status}`);
  return (await res.json()).access_token;
}

async function tts(phrase, voice, headers, attempt = 1) {
  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(phrase) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        languageCode: "en-GB",
        voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
      },
    },
  };
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt <= 6) {
    const wait = attempt * 4000;
    console.log(`  HTTP ${res.status}, retry in ${wait / 1000}s...`);
    await sleep(wait);
    return tts(phrase, voice, headers, attempt + 1);
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 280).replace(/\s+/g, " ")}`);
  }
  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    throw new Error(`No audio in response: ${JSON.stringify(data).slice(0, 250)}`);
  }
  return Buffer.from(part.inlineData.data, "base64");
}

async function goodTake(phrase, voice, headers) {
  let best = null;
  for (let i = 1; i <= 3; i++) {
    const buf = await tts(phrase, voice, headers);
    const stats = analyzePcm(buf);
    const issue = qualityIssue(phrase, stats);
    const take = { buf, stats, issue };
    if (!issue) return take;
    console.log(`  take ${i} rejected: ${issue}`);
    if (!best || stats.seconds > 0.3) best = take;
    await sleep(300);
  }
  if (!best) throw new Error("no audio");
  console.log(`  keeping least-bad take despite: ${best.issue}`);
  return best;
}

function wavPath(voice, phraseId) {
  return join(OUT_DIR, voice, `${phraseId}.wav`);
}

function copyUsReference() {
  const destDir = join(OUT_DIR, "_us-achernar");
  mkdirSync(destDir, { recursive: true });
  for (const [id, file] of Object.entries(US_REF)) {
    const src = join(DIR, "wav_out", file);
    if (existsSync(src)) copyFileSync(src, join(destDir, `${id}.wav`));
  }
}

function writeManifest(results) {
  const payload = {
    generatedAt: new Date().toISOString(),
    model: MODEL,
    languageCode: "en-GB",
    accent: "Standard British English (Received Pronunciation)",
    voices: VOICES,
    phrases: PHRASES,
    files: results,
    usReference: US_REF,
  };
  writeFileSync(MANIFEST_PATH, JSON.stringify(payload, null, 2) + "\n");
}

function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function writeHtml() {
  const phraseTh = PHRASES.map(
    (p) =>
      `<th title="${esc(p.text)}"><div class="ph">${esc(p.text)}</div><button class="mini" data-play-col="${esc(p.id)}">播这一列</button></th>`
  ).join("");

  const voiceRows = VOICES.map((v) => {
    const cells = PHRASES.map((p) => {
      const src = `audio/${encodeURIComponent(v.name)}/${encodeURIComponent(p.id)}.wav`;
      return `<td>
        <button class="play" data-src="${src}" data-voice="${esc(v.name)}" data-phrase="${esc(p.id)}" title="${esc(p.text)}">▶</button>
      </td>`;
    }).join("");
    const current = v.name === "Achernar" ? " current" : "";
    return `<tr class="voice${current}" data-gender="${v.gender}" data-name="${esc(v.name)}">
      <th class="sticky">
        <div class="vname">${esc(v.name)}${v.name === "Achernar" ? ' <span class="tag">现用</span>' : ""}</div>
        <div class="vmeta">${esc(v.gender)} · ${esc(v.character)}</div>
        <button class="mini" data-play-row="${esc(v.name)}">播这一行</button>
      </th>
      ${cells}
    </tr>`;
  }).join("\n");

  const usCells = PHRASES.map((p) => {
    if (!US_REF[p.id]) return `<td class="na">—</td>`;
    const src = `audio/_us-achernar/${encodeURIComponent(p.id)}.wav`;
    return `<td><button class="play us" data-src="${src}" data-voice="_us-achernar" data-phrase="${esc(p.id)}" title="${esc(p.text)}">▶</button></td>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Gemini TTS · 英式 RP 音色对比</title>
<style>
  :root {
    --bg: #0f1218;
    --panel: #171b24;
    --line: #2a3140;
    --text: #e8edf5;
    --muted: #9aa6b8;
    --accent: #7dd3c0;
    --female: #f0b4d0;
    --male: #9ec5f0;
    --us: #e8c07a;
    --play: #1f6f5b;
    --play-on: #2fa887;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg); color: var(--text); line-height: 1.45;
  }
  header {
    padding: 20px 24px 8px; max-width: 1400px; margin: 0 auto;
  }
  h1 { font-size: 22px; margin: 0 0 8px; font-weight: 650; }
  .lede { color: var(--muted); max-width: 920px; font-size: 14px; }
  .lede code { background: #232836; padding: 1px 6px; border-radius: 4px; font-size: 12px; }
  .toolbar {
    display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    padding: 12px 24px 16px; max-width: 1400px; margin: 0 auto; position: sticky; top: 0;
    background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); z-index: 5;
  }
  .toolbar label { font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
  button, select {
    background: var(--panel); color: var(--text); border: 1px solid var(--line);
    border-radius: 8px; padding: 6px 10px; cursor: pointer; font: inherit;
  }
  button:hover { border-color: var(--accent); }
  .now { font-size: 13px; color: var(--accent); min-height: 1.4em; }
  .wrap { overflow: auto; padding: 0 16px 48px; }
  table { border-collapse: separate; border-spacing: 0; min-width: 1100px; width: 100%; }
  th, td { border-bottom: 1px solid var(--line); padding: 8px 10px; text-align: center; background: var(--panel); }
  thead th {
    position: sticky; top: 52px; z-index: 3; background: #1c2230; font-size: 12px; font-weight: 600;
  }
  th.sticky, .voice th.sticky {
    position: sticky; left: 0; z-index: 2; text-align: left; min-width: 180px; background: #1c2230;
  }
  thead th.sticky { z-index: 4; }
  .ph { max-width: 140px; margin: 0 auto 4px; white-space: normal; }
  .vname { font-size: 14px; }
  .vmeta { font-size: 12px; color: var(--muted); }
  .tag { font-size: 10px; background: var(--accent); color: #08211b; border-radius: 999px; padding: 1px 6px; margin-left: 4px; }
  tr[data-gender="Female"] .vname { color: var(--female); }
  tr[data-gender="Male"] .vname { color: var(--male); }
  tr.current td, tr.current th { box-shadow: inset 3px 0 0 var(--accent); }
  tr.us-ref th, tr.us-ref td { background: #241e14; }
  tr.us-ref .vname { color: var(--us); }
  .play {
    width: 42px; height: 42px; border-radius: 50%; background: var(--play); border: 0;
    font-size: 16px; color: white;
  }
  .play.us { background: #8a6a2f; }
  .play.playing, .play:focus { background: var(--play-on); outline: 2px solid var(--accent); }
  .play.missing { background: #33384a; opacity: 0.4; cursor: not-allowed; }
  .mini { font-size: 11px; padding: 3px 7px; color: var(--muted); }
  td.na { color: #556; }
  tr.hidden { display: none; }
  footer { color: var(--muted); font-size: 12px; padding: 8px 24px 32px; max-width: 1400px; margin: 0 auto; }
</style>
</head>
<body>
<header>
  <h1>Gemini TTS · 标准英式英语（RP）音色对比</h1>
  <p class="lede">
    Gemini TTS 没有单独的「英式 role」：官方 30 个 prebuilt voice 都可以说英式。
    本页全部用 <code>languageCode=en-GB</code> + Received Pronunciation（BBC / 标准南部英音，非 Cockney / Estuary / 北部 / 苏格兰）生成。
    现用美式对照行是仓库里的 <code>Achernar</code> + <code>en-US</code>。
    点格子播放；同一时间只播一条。最后一列是 RP 试音句（can't / schedule / bath 元音 / half past four）。
  </p>
</header>
<div class="toolbar">
  <label>性别
    <select id="gender">
      <option value="all">全部 30</option>
      <option value="Female">女声 14</option>
      <option value="Male">男声 16</option>
    </select>
  </label>
  <label>搜索音色 <input id="q" type="search" placeholder="Achernar / Warm / Female"></label>
  <button id="stop">停止</button>
  <div class="now" id="now">未播放</div>
  <div class="now" id="ready">正在检测样本…</div>
</div>
<div class="wrap">
<table>
  <thead>
    <tr>
      <th class="sticky">音色</th>
      ${phraseTh}
    </tr>
  </thead>
  <tbody>
    <tr class="us-ref" data-gender="Female" data-name="Achernar-US">
      <th class="sticky">
        <div class="vname">Achernar（现有美式）</div>
        <div class="vmeta">Female · Soft · en-US</div>
        <button class="mini" data-play-row="_us-achernar">播这一行</button>
      </th>
      ${usCells}
    </tr>
    ${voiceRows}
  </tbody>
</table>
</div>
<footer>
  模型 gemini-3.1-flash-tts-preview · 24 kHz WAV · 打开本页请用本地静态服务（例如 <code>python3 -m http.server</code> 于 compare/）。
</footer>
<script>
const audio = new Audio();
let currentBtn = null;
const now = document.getElementById("now");

function setPlaying(btn) {
  if (currentBtn) currentBtn.classList.remove("playing");
  currentBtn = btn;
  if (btn) btn.classList.add("playing");
}

function playSrc(btn) {
  const src = btn.getAttribute("data-src");
  const voice = btn.getAttribute("data-voice");
  const phrase = btn.getAttribute("data-phrase");
  if (!src) return;
  if (currentBtn === btn && !audio.paused) {
    audio.pause();
    setPlaying(null);
    now.textContent = "已暂停";
    return;
  }
  audio.src = src;
  audio.play().then(() => {
    setPlaying(btn);
    now.textContent = "正在播放：" + voice + " · " + phrase;
  }).catch((err) => {
    now.textContent = "无法播放 " + src + "（" + err.message + "）";
  });
}

audio.addEventListener("ended", () => {
  setPlaying(null);
  now.textContent = "播放结束";
  if (queue.length) playNext();
});

let queue = [];
function playNext() {
  const btn = queue.shift();
  if (btn) playSrc(btn);
}

document.addEventListener("click", (e) => {
  const play = e.target.closest("[data-src]");
  if (play) { queue = []; playSrc(play); return; }
  const row = e.target.closest("[data-play-row]");
  if (row) {
    const name = row.getAttribute("data-play-row");
    const sel = name === "_us-achernar"
      ? 'tr.us-ref button[data-src]'
      : 'tr[data-name="' + CSS.escape(name) + '"] button[data-src]';
    queue = [...document.querySelectorAll(sel)];
    playNext();
    return;
  }
  const col = e.target.closest("[data-play-col]");
  if (col) {
    const id = col.getAttribute("data-play-col");
    const visible = 'tr.voice:not(.hidden) button[data-phrase="' + CSS.escape(id) + '"]';
    queue = [...document.querySelectorAll(visible)];
    playNext();
  }
});

document.getElementById("stop").onclick = () => {
  queue = [];
  audio.pause();
  audio.removeAttribute("src");
  setPlaying(null);
  now.textContent = "已停止";
};

function applyFilter() {
  const g = document.getElementById("gender").value;
  const q = document.getElementById("q").value.trim().toLowerCase();
  document.querySelectorAll("tr.voice").forEach((tr) => {
    const genderOk = g === "all" || tr.dataset.gender === g;
    const hay = (tr.dataset.name + " " + tr.textContent).toLowerCase();
    tr.classList.toggle("hidden", !(genderOk && (!q || hay.includes(q))));
  });
}
document.getElementById("gender").onchange = applyFilter;
document.getElementById("q").oninput = applyFilter;

const readyEl = document.getElementById("ready");
async function markMissing() {
  const buttons = [...document.querySelectorAll("button.play[data-src]")];
  let ok = 0;
  await Promise.all(buttons.map(async (btn) => {
    if (btn.dataset.ok === "1") { ok++; return; }
    try {
      const r = await fetch(btn.getAttribute("data-src"), { method: "HEAD" });
      if (r.ok) {
        btn.dataset.ok = "1";
        btn.classList.remove("missing");
        btn.disabled = false;
        ok++;
      } else {
        btn.classList.add("missing");
        btn.disabled = true;
      }
    } catch {
      btn.classList.add("missing");
      btn.disabled = true;
    }
  }));
  readyEl.textContent = "已就绪 " + ok + "/" + buttons.length;
  return ok === buttons.length;
}
(async function pollReady() {
  const all = await markMissing();
  if (!all) setTimeout(pollReady, 8000);
})();
</script>
</body>
</html>
`;
  mkdirSync(dirname(HTML_PATH), { recursive: true });
  writeFileSync(HTML_PATH, html);
}

async function main() {
  copyUsReference();
  writeHtml();
  if (process.env.HTML_ONLY) {
    console.log("Wrote", HTML_PATH);
    return;
  }

  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await getAccessToken()}`,
  };

  let voices = VOICES;
  if (process.env.ONLY_VOICE) {
    voices = VOICES.filter((v) => v.name === process.env.ONLY_VOICE);
    if (!voices.length) {
      console.error(`Unknown voice: ${process.env.ONLY_VOICE}`);
      process.exit(1);
    }
  } else if (process.env.LIMIT_VOICES) {
    voices = VOICES.slice(0, Number(process.env.LIMIT_VOICES));
  }

  const results = [];
  let done = 0;
  const total = voices.length * PHRASES.length;
  for (const voice of voices) {
    mkdirSync(join(OUT_DIR, voice.name), { recursive: true });
    for (const phrase of PHRASES) {
      done++;
      const dest = wavPath(voice.name, phrase.id);
      if (existsSync(dest) && !process.env.FORCE) {
        console.log(`[${done}/${total}] skip ${voice.name} / ${phrase.id}`);
        results.push({ voice: voice.name, phrase: phrase.id, skipped: true });
        continue;
      }
      process.stdout.write(`[${done}/${total}] ${voice.name} / "${phrase.text}" ...\n`);
      try {
        const take = await goodTake(phrase, voice.name, headers);
        writeFileSync(dest, pcmToWav(take.buf));
        console.log(
          `  -> ${dest.replace(DIR + "/", "")} (${take.stats.seconds.toFixed(2)}s, peak ${take.stats.peak})`
        );
        results.push({
          voice: voice.name,
          phrase: phrase.id,
          seconds: Number(take.stats.seconds.toFixed(2)),
          peak: take.stats.peak,
        });
      } catch (e) {
        console.log(`  FAILED: ${e.message}`);
        results.push({ voice: voice.name, phrase: phrase.id, error: e.message });
      }
      await sleep(350);
    }
  }

  writeManifest(results);
  writeHtml();
  const ok = results.filter((r) => !r.error).length;
  console.log(`\nDone: ${ok}/${total} files. Open compare/index.html`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
