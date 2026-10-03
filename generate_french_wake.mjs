import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUTPUT = join(ROOT, 'output/speech/aoede-french-wake-2026-10-03');
const PROJECT = 'project-7512206b-7586-4bc6-ab2';
const MODEL = 'gemini-3.1-flash-tts-preview';
const RATE = 24000;
const PHRASES = [
  ['01-salut', 'Salut !', '嗨！'],
  ['02-bonjour', 'Bonjour !', '你好！'],
  ['03-je-suis-la', 'Je suis là.', '我在。'],
  ['04-je-vous-ecoute', 'Je vous écoute.', '我在听。'],
  ['05-oui', 'Oui ?', '嗯？'],
  ['06-allez-y', 'Allez-y.', '请说。'],
  ['07-dites-moi', 'Dites-moi.', '你说。'],
  ['08-je-peux-vous-aider', 'Je peux vous aider ?', '有什么需要帮忙的吗？'],
];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

async function accessToken() {
  const paths = [process.env.GOOGLE_APPLICATION_CREDENTIALS, join(homedir(), '.config/gcloud/application_default_credentials.json')].filter(Boolean);
  const path = paths.find(existsSync);
  if (!path) throw new Error('GCP ADC credentials not found.');
  const adc = JSON.parse(readFileSync(path, 'utf8'));
  if (adc.type !== 'authorized_user') throw new Error('Expected authorized_user ADC credentials.');
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: adc.client_id, client_secret: adc.client_secret, refresh_token: adc.refresh_token, grant_type: 'refresh_token' }),
  });
  if (!response.ok) throw new Error(`GCP authentication failed: HTTP ${response.status}`);
  const result = await response.json();
  if (!result.access_token) throw new Error('GCP authentication returned no access token.');
  return result.access_token;
}

function wav(pcm) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(RATE, 24); header.writeUInt32LE(RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function synthesize(text, token) {
  const prompt = `Generate one short French wake-word acknowledgment for an in-car voice assistant. Speak only the exact transcript below, once. Natural French from France, warm and friendly, concise conversational pace, with a gentle inviting tone. No preamble, extra words, repetition, music or sound effects. The question "Oui ?" should sound attentive and welcoming. These directions must not be spoken.\n\nTRANSCRIPT:\n${text}`;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const started = performance.now();
    const response = await fetch(`https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${MODEL}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['AUDIO'], speechConfig: { languageCode: 'fr-FR', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } } } }),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 5) {
      await response.text();
      console.log(`HTTP ${response.status}; retry ${attempt}/4 in ${attempt * 10}s`);
      await pause(attempt * 10000); continue;
    }
    if (!response.ok) throw new Error(`Synthesis failed: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const result = await response.json();
    const audioParts = result.candidates?.[0]?.content?.parts?.filter(p => p.inlineData) || [];
    if (!audioParts.length) throw new Error('No audio returned.');
    for (const p of audioParts) {
      if (!/^audio\/(L16|pcm)/i.test(p.inlineData.mimeType || '')) throw new Error(`Unexpected format ${p.inlineData.mimeType}`);
      const rate = /rate=(\d+)/i.exec(p.inlineData.mimeType)?.[1];
      if (rate && Number(rate) !== RATE) throw new Error(`Unexpected sample rate ${rate}`);
    }
    const pcm = Buffer.concat(audioParts.map(p => Buffer.from(p.inlineData.data, 'base64')));
    if (pcm.length < RATE / 2 || pcm.length % 2) throw new Error('Empty, too short, or invalid PCM data.');
    return { pcm, requestMs: Math.round(performance.now() - started), mimeType: audioParts[0].inlineData.mimeType, prompt };
  }
}

function writePage(rows) {
  const cards = rows.map((r, i) => `<article><div class="number">${String(i + 1).padStart(2, '0')}</div><div class="text"><h2 lang="fr">${escape(r.text)}</h2><p>${escape(r.translation)} <span>· ${r.seconds.toFixed(2)} 秒</span></p><audio controls preload="metadata" src="${r.id}.wav" aria-label="${escape(r.text)}"></audio><div class="downloads"><a download href="${r.id}.wav">下载 WAV</a><a download href="${r.id}.pcm">下载 PCM</a></div></div></article>`).join('\n');
  writeFileSync(join(OUTPUT, 'index.html'), `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Aoede · 法语唤醒应答</title><style>
:root{color-scheme:dark;--bg:#10131a;--card:#191e29;--line:#303847;--text:#eef2f7;--muted:#a6b1c0;--accent:#8ee0c4}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:940px;margin:0 auto;padding:42px 20px}header small{color:var(--accent);letter-spacing:.1em}h1{margin:10px 0;font-size:clamp(26px,5vw,40px)}header p,footer{color:var(--muted)}.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:24px 0}button,a{font:inherit;border:1px solid var(--line);border-radius:8px;padding:8px 13px;background:var(--card);color:var(--text);text-decoration:none;cursor:pointer}button:hover,a:hover{border-color:var(--accent)}button:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:3px}#status{font-size:14px;color:var(--accent)}section{display:grid;grid-template-columns:1fr 1fr;gap:14px}article{display:flex;gap:15px;padding:22px;background:var(--card);border:1px solid var(--line);border-radius:14px}article.active{border-color:var(--accent)}.number{font-size:13px;color:var(--accent);padding-top:6px}.text{min-width:0;flex:1}h2{margin:0;font-size:23px;font-weight:600}.text p{font-size:14px;color:var(--muted);margin:7px 0 16px}.text p span{white-space:nowrap}audio{width:100%;height:40px}.downloads{display:flex;gap:8px;margin-top:15px}.downloads a{font-size:13px;padding:6px 10px}footer{font-size:13px;line-height:1.8;margin-top:28px}footer a{font-size:13px;background:none;padding:0;border:0;color:var(--accent)}@media(max-width:650px){section{grid-template-columns:1fr}main{padding:26px 16px}article{padding:18px}}
</style></head><body><main><header><small>AOEDE / FR-FR</small><h1>法语唤醒应答 · 8 条短句</h1><p>轻松、温和的助手应答。逐条检查发音和语气，或连续试听全部。</p></header><div class="toolbar"><button id="all">连续播放全部</button><button id="stop">停止</button><span id="status" role="status" aria-live="polite">等待试听</span></div><section>${cards}</section><footer>语音由 AI 生成 · ${MODEL}<br>WAV 与 PCM 来自同一次合成。PCM：24,000 Hz / 16-bit signed little-endian / 单声道 / 无文件头。浏览器通过 WAV 试听。<br><a href="aoede-french-wake.zip" download>下载全部 WAV + PCM（ZIP）</a></footer></main><script>
const audios=[...document.querySelectorAll('audio')],cards=[...document.querySelectorAll('article')],status=document.getElementById('status');let queue=false;
function halt(){queue=false;audios.forEach(a=>{a.pause();a.currentTime=0});cards.forEach(c=>c.classList.remove('active'))}
function playAt(i){audios[i].currentTime=0;audios[i].play().catch(e=>{queue=false;status.textContent='播放失败：'+e.message})}
audios.forEach((a,i)=>{a.addEventListener('play',()=>{audios.forEach((other,j)=>{if(j!==i)other.pause()});cards.forEach((c,j)=>c.classList.toggle('active',j===i));status.textContent='正在播放 '+(i+1)+' / '+audios.length});a.addEventListener('ended',()=>{cards[i].classList.remove('active');if(queue&&i+1<audios.length)playAt(i+1);else{queue=false;status.textContent='播放结束'}});a.addEventListener('error',()=>{queue=false;status.textContent='音频加载失败，请确认 WAV 文件与网页在同一目录'});a.addEventListener('pointerdown',()=>{queue=false});a.addEventListener('keydown',()=>{queue=false})});
document.getElementById('all').onclick=()=>{halt();queue=true;playAt(0)};document.getElementById('stop').onclick=()=>{halt();status.textContent='已停止'};
</script></body></html>`);
}

async function main() {
  mkdirSync(OUTPUT, { recursive: true });
  const manifestPath = join(OUTPUT, 'manifest.json');
  const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')).clips : [];
  const token = await accessToken();
  const rows = [];
  for (const [id, text, translation] of PHRASES) {
    let row = previous.find(r => r.id === id && r.text === text);
    if (!row || !existsSync(join(OUTPUT, `${id}.wav`)) || !existsSync(join(OUTPUT, `${id}.pcm`))) {
      console.log(`Generating ${id}: ${text}`);
      const take = await synthesize(text, token);
      writeFileSync(join(OUTPUT, `${id}.pcm`), take.pcm);
      writeFileSync(join(OUTPUT, `${id}.wav`), wav(take.pcm));
      row = { id, text, translation, seconds: take.pcm.length / 2 / RATE, pcmBytes: take.pcm.length, requestMs: take.requestMs, returnedMimeType: take.mimeType, prompt: take.prompt, generatedAt: new Date().toISOString() };
    }
    rows.push(row);
    writeFileSync(manifestPath, JSON.stringify({ model: MODEL, voice: 'Aoede', locale: 'fr-FR', sampleRate: RATE, channels: 1, encoding: 'signed 16-bit little-endian PCM', clips: rows }, null, 2) + '\n');
    console.log(`${id}: ${row.seconds.toFixed(2)}s`);
    if (rows.length < PHRASES.length) await pause(6500);
  }
  writePage(rows);
  console.log(`Ready: ${join(OUTPUT, 'index.html')}`);
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
