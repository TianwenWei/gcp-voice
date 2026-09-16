// Gemini TTS batch generator -> raw PCM files (24kHz, 16-bit, mono)
// Auth: gcloud Application Default Credentials (cloud-platform scope, in-memory
// refresh-token exchange; no API key). Endpoint: Vertex AI global.
// Usage: node tts_gen.mjs   (LIMIT=3 node tts_gen.mjs for a smoke test)

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(DIR, "pcm_out");
const VOICE = "Achernar";
const PROJECT = "project-7512206b-7586-4bc6-ab2";
const SAMPLE_RATE = 24000;
const MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
const ENDPOINT = (model) =>
  `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${model}:generateContent`;

// In-car wake replies. Tag is a documented Gemini TTS audio tag that steers
// delivery: invitations stay gentle so they are not read as commands.
const PHRASES = [
  { text: "Please speak", tag: "gently" },
  { text: "I'm here", tag: "warmly" },
  { text: "Hello", tag: "warmly" },
  { text: "Please instruct", tag: "gently" },
  { text: "Good morning", tag: "warmly" },
  { text: "Morning", tag: "warmly" },
  { text: "Hey there", tag: "warmly" },
  { text: "Good day", tag: "warmly" },
  { text: "Here I am", tag: "warmly" },
  { text: "Hi", tag: "warmly" },
  { text: "Nice to see you again", tag: "warmly" },
  { text: "Good noon", tag: "warmly" },
  { text: "Good afternoon", tag: "warmly" },
  { text: "Hello there", tag: "warmly" },
  { text: "Yes", tag: "warmly" },
  { text: "I'm listening", tag: "warmly" },
  { text: "Good evening", tag: "warmly" },
  { text: "Here", tag: "warmly" },
  { text: "Coming", tag: "warmly" },
  { text: "Please talk", tag: "gently" },
  { text: "Please speak", tag: "gently" },
  { text: "Good noon", tag: "warmly" },
];

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
Accent: Neutral American English.

### CONTEXT
One short acknowledgment after the wake word. This is an invitation to talk, not an order.

#### TRANSCRIPT
[${tag}] ${text}`;
}

function analyzePcm(buf) {
  const n = buf.length >> 1;
  let peak = 0;
  let sumSq = 0;
  let clip = 0;
  const win = 2400; // 100 ms
  const env = [];
  let winSq = 0;
  let winN = 0;
  for (let i = 0; i < n; i++) {
    const s = buf.readInt16LE(i * 2);
    const a = s < 0 ? -s : s;
    if (a > peak) peak = a;
    if (a >= 32767) clip++;
    sumSq += s * s;
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
  return {
    seconds: n / SAMPLE_RATE,
    peak,
    rms: n ? Math.sqrt(sumSq / n) : 0,
    clip,
    bursts,
  };
}

function qualityIssue(phrase, stats) {
  const words = phrase.text.trim().split(/\s+/).length;
  const minSec = 0.55;
  const maxSec = Math.min(3.2, 1.15 + 0.5 * words);
  if (stats.seconds < minSec) return `too short (${stats.seconds.toFixed(2)}s)`;
  if (stats.seconds > maxSec) return `too long (${stats.seconds.toFixed(2)}s, likely repeat or prompt read)`;
  if (stats.clip > 20) return `clipping (${stats.clip} samples)`;
  if (stats.bursts >= 3) return `too many bursts (${stats.bursts})`;
  if (stats.peak < 8000) return `too quiet (peak ${stats.peak})`;
  if (stats.peak > 23000) return `too intense (peak ${stats.peak})`;
  return null;
}

function scoreTake(stats) {
  // Prefer moderate in-car loudness (warm, not shouted) and a single speech burst.
  const mid = 16000;
  const peakPenalty = Math.abs(stats.peak - mid) / 400;
  const burstPenalty = Math.max(0, stats.bursts - 1) * 8;
  const clipPenalty = stats.clip * 2;
  return peakPenalty + burstPenalty + clipPenalty;
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

async function tts(phrase, model, headers, attempt = 1) {
  const body = {
    contents: [{ role: "user", parts: [{ text: buildPrompt(phrase) }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        languageCode: "en-US",
        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } },
      },
    },
  };
  const res = await fetch(ENDPOINT(model), {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if ((res.status === 429 || res.status >= 500) && attempt <= 5) {
    const wait = attempt * 4000;
    console.log(`HTTP ${res.status}, retry in ${wait / 1000}s...`);
    await sleep(wait);
    return tts(phrase, model, headers, attempt + 1);
  }
  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 250).replace(/\s+/g, " ")}`);
  }
  const data = await res.json();
  const part = data?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) {
    throw new Error(`No audio in response: ${JSON.stringify(data).slice(0, 250)}`);
  }
  return { mime: part.inlineData.mimeType || "", buf: Buffer.from(part.inlineData.data, "base64") };
}

async function goodTake(phrase, model, headers) {
  let best = null;
  const maxAttempts = 5;
  for (let i = 1; i <= maxAttempts; i++) {
    const { mime, buf } = await tts(phrase, model, headers);
    const stats = analyzePcm(buf);
    const take = { mime, buf, stats, score: scoreTake(stats), issue: qualityIssue(phrase, stats) };
    if (!take.issue) {
      if (!best || take.score < best.score) best = take;
      // Good enough: moderate in-car peak, single burst.
      if (take.stats.peak >= 10000 && take.stats.peak <= 21000 && take.stats.bursts <= 2) {
        return take;
      }
    } else if (!best || (take.issue && best.issue && take.score < best.score)) {
      // Keep a fallback only if we have nothing better; prefer valid takes.
      if (!best) best = take;
    }
    if (take.issue) {
      console.log(`  take ${i} rejected: ${take.issue} (peak ${take.stats.peak}, ${take.stats.seconds.toFixed(2)}s)`);
    } else {
      console.log(`  take ${i} ok-ish but intense (peak ${take.stats.peak}); trying another`);
    }
    await sleep(400);
  }
  if (!best) throw new Error("no audio returned");
  if (best.issue) {
    console.log(`  keeping least-bad take despite: ${best.issue}`);
  }
  return best;
}

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function fileName(index, text) {
  return `${String(index).padStart(2, "0")}-${slug(text)}.pcm`;
}

function writeProvenance(model, results) {
  const payload = {
    provider: "Google Vertex AI (Gemini API)",
    model,
    voice: VOICE,
    generatedAtLocal: new Date().toISOString().slice(0, 10),
    outputFormat: "raw PCM, 24000 Hz, 16-bit signed little-endian, mono",
    auth: "gcloud application default credentials (no API key)",
    style:
      "Warm, kind, welcoming in-car wake reply with a vocal smile; never angry/stern/commanding. Gemini TTS style prompt + [warmly]/[gently] tags.",
    outputDir: "pcm_out/",
    files: results.map((r) => ({
      file: r.name,
      text: r.text,
      bytes: r.bytes,
      seconds: Number(r.seconds.toFixed(2)),
      peak: r.peak,
    })),
    total: results.length,
    verification: "per-file duration/burst/clipping gate with up to 5 takes; style prompt used to avoid angry/commanding delivery",
  };
  writeFileSync(join(OUT_DIR, "provenance.json"), JSON.stringify(payload, null, 2) + "\n");
}

async function generateOne(index, phrase, model, headers) {
  const name = fileName(index, phrase.text);
  const take = await goodTake(phrase, model, headers);
  writeFileSync(join(OUT_DIR, name), take.buf);
  const { stats, mime } = take;
  console.log(
    `[${index}/${PHRASES.length}] "${phrase.text}" -> ${name} (${stats.seconds.toFixed(2)}s, peak ${stats.peak}, ${mime})`
  );
  return {
    name,
    text: phrase.text,
    bytes: take.buf.length,
    seconds: stats.seconds,
    peak: stats.peak,
  };
}

async function main() {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${await getAccessToken()}`,
  };

  mkdirSync(OUT_DIR, { recursive: true });

  const only = process.env.ONLY ? Number(process.env.ONLY) : null;
  if (only) {
    const phrase = PHRASES[only - 1];
    if (!phrase) {
      console.error(`ONLY=${only} is out of range (1-${PHRASES.length})`);
      process.exit(1);
    }
    try {
      await generateOne(only, phrase, MODELS[0], headers);
    } catch (e) {
      console.error(`FAILED: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  let model = null;
  for (const candidate of MODELS) {
    try {
      await tts(PHRASES[0], candidate, headers);
      model = candidate;
      console.log(`Using model: ${candidate}`);
      break;
    } catch (e) {
      console.log(`Model ${candidate} unavailable: ${e.message}`);
    }
  }
  if (!model) {
    console.error("No working TTS model found.");
    process.exit(1);
  }

  const limit = process.env.LIMIT ? Number(process.env.LIMIT) : PHRASES.length;
  const results = [];
  for (let i = 0; i < limit; i++) {
    process.stdout.write(`[${i + 1}/${limit}] "${PHRASES[i].text}" ...\n`);
    try {
      results.push(await generateOne(i + 1, PHRASES[i], model, headers));
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
    await sleep(500);
  }
  if (limit === PHRASES.length && results.length) {
    writeProvenance(model, results);
  }
  console.log(`\nDone: ${results.length}/${limit} files in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
