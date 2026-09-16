// Gemini TTS batch generator -> raw PCM files (24kHz, 16-bit, mono)
// Auth: gcloud Application Default Credentials (cloud-platform scope, in-memory
// refresh-token exchange; no API key). Endpoint: Vertex AI global.
// Usage: node tts_gen.mjs   (LIMIT=3 node tts_gen.mjs for a smoke test)

import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(DIR, "pcm_out");
const VOICE = "Achernar";
const PROJECT = "project-7512206b-7586-4bc6-ab2";
const MODELS = ["gemini-3.1-flash-tts-preview", "gemini-2.5-flash-preview-tts"];
const ENDPOINT = (model) =>
  `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${model}:generateContent`;

const PHRASES = [
  "Please speak",
  "I'm here",
  "Hello",
  "Please instruct",
  "Good morning",
  "Morning",
  "Hey there",
  "Good day",
  "Here I am",
  "Hi",
  "Nice to see you again",
  "Good noon",
  "Good afternoon",
  "Hello there",
  "Yes",
  "I'm listening",
  "Good evening",
  "Here",
  "Coming",
  "Please talk",
  "Please speak",
  "Good noon",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exchange the ADC refresh token for an access token, entirely in memory.
async function getAccessToken() {
  const adcPath = join(
    process.env.APPDATA,
    "gcloud",
    "application_default_credentials.json"
  );
  const adc = JSON.parse(readFileSync(adcPath, "utf8"));
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

async function tts(text, model, headers, attempt = 1) {
  const body = {
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      responseModalities: ["AUDIO"],
      speechConfig: {
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
    return tts(text, model, headers, attempt + 1);
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

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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
    const name = `${String(only).padStart(2, "0")}-${slug(phrase)}.pcm`;
    try {
      const { mime, buf } = await tts(phrase, MODELS[0], headers);
      writeFileSync(join(OUT_DIR, name), buf);
      console.log(`Regenerated ${name}: "${phrase}" (${buf.length} bytes, ${mime})`);
    } catch (e) {
      console.error(`FAILED: ${e.message}`);
      process.exit(1);
    }
    return;
  }

  // Resolve the first model that actually serves TTS.
  let model = null;
  for (const candidate of MODELS) {
    try {
      const { mime, buf } = await tts(PHRASES[0], candidate, headers);
      const name = `01-${slug(PHRASES[0])}.pcm`;
      writeFileSync(join(OUT_DIR, name), buf);
      model = candidate;
      console.log(`[1] "${PHRASES[0]}" -> ${name} (model: ${candidate}, ${buf.length} bytes, ${mime})`);
      break;
    } catch (e) {
      console.log(`Model ${candidate} unavailable: ${e.message}`);
    }
  }
  if (!model) {
    console.error("No working TTS model found.");
    process.exit(1);
  }

  let ok = 1;
  for (let i = 1; i < PHRASES.length; i++) {
    const phrase = PHRASES[i];
    const name = `${String(i + 1).padStart(2, "0")}-${slug(phrase)}.pcm`;
    process.stdout.write(`[${i + 1}/${PHRASES.length}] "${phrase}" -> ${name} ... `);
    try {
      const { mime, buf } = await tts(phrase, model, headers);
      writeFileSync(join(OUT_DIR, name), buf);
      console.log(`ok (${buf.length} bytes, ${mime})`);
      ok++;
    } catch (e) {
      console.log(`FAILED: ${e.message}`);
    }
    await sleep(500); // gentle pacing
  }
  console.log(`\nDone: ${ok}/${PHRASES.length} files in ${OUT_DIR}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
