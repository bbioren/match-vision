import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { buildVisionPrompt, interpretMoment, resolveContextAt, sanitizeVlmOutput } from './src/services/match-context.js';

// Load .env without external dependencies (gitignored; keys stay local).
try {
  for (const line of fsSync.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = val;
  }
} catch {
  // .env is optional
}

const port = Number(process.env.PORT || 5173);
const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.mp4': 'video/mp4', '.md': 'text/markdown' };

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
function resolveProvider() {
  const explicit = (process.env.LLM_PROVIDER || '').toLowerCase();
  if (explicit) return explicit;
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) return 'gemini';
  if (process.env.DASHSCOPE_API_KEY) return 'qwen';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'fallback';
}

async function callGemini({ system, prompt, maxTokens }) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return { fallback: true };
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.2, thinkingConfig: { thinkingBudget: 0 } }
    })
  });
  if (!r.ok) return { fallback: true, error: await r.text() };
  const data = await r.json();
  return { description: data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('\n').trim() || null };
}

async function callQwen({ system, prompt, maxTokens }) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return { fallback: true };
  const base = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: prompt });
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.QWEN_MODEL || 'qwen-flash', max_tokens: maxTokens, messages })
  });
  if (!r.ok) return { fallback: true, error: await r.text() };
  const data = await r.json();
  return { description: data.choices?.[0]?.message?.content?.trim() || null };
}

async function callAnthropic({ system, prompt, maxTokens }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { fallback: true };
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
      max_tokens: maxTokens,
      system: system || undefined,
      messages: [{ role: 'user', content: prompt }]
    })
  });
  if (!r.ok) return { fallback: true, error: await r.text() };
  const data = await r.json();
  return { description: data.content?.map((c) => c.text || '').join('\n').trim() || null };
}

async function describe(req, res) {
  const body = await readJson(req);
  const provider = resolveProvider();
  const maxTokens = Number(body.maxTokens) || 200;
  const args = { system: body.system, prompt: body.prompt, maxTokens };
  let result;
  if (provider === 'gemini') result = await callGemini(args);
  else if (provider === 'qwen') result = await callQwen(args);
  else if (provider === 'anthropic') result = await callAnthropic(args);
  else result = { fallback: true };
  send(res, 200, JSON.stringify({ provider, ...result }), { 'content-type': 'application/json' });
}
async function callQwenVision({ imageBase64, frames, atSecond, matchContext, priorMoments }) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const frameList = Array.isArray(frames) && frames.length
    ? frames
    : (imageBase64 ? [{ atSecond, imageBase64, is_current: true, timestamp: `${atSecond}s` }] : []);
  if (!apiKey || !frameList.length) return { fallback: true };

  const base = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
  const resolved = matchContext?.teams ? matchContext : null;
  const prompt = resolved
    ? buildVisionPrompt(resolved, { priorMoments: priorMoments || [], frames: frameList })
    : buildVisionPromptFallback(priorMoments, frameList);

  const content = [];
  const currentAt = frameList[frameList.length - 1].atSecond;
  for (let i = 0; i < frameList.length; i += 1) {
    const frame = frameList[i];
    const stamp = frame.timestamp || `${frame.atSecond}s`;
    const secondsAgo = Math.max(0, Math.round((currentAt - frame.atSecond) * 10) / 10);
    const label = frame.is_current
      ? `Image ${i + 1}/${frameList.length} — CURRENT moment (${stamp}, now):`
      : `Image ${i + 1}/${frameList.length} — ${secondsAgo}s in the PAST (${stamp}):`;
    content.push({ type: 'text', text: label });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/jpeg;base64,${frame.imageBase64}` }
    });
  }
  content.push({ type: 'text', text: prompt });

  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.QWEN_VL_MODEL || 'qwen3-vl-plus',
      max_tokens: 500,
      messages: [{ role: 'user', content }]
    })
  });
  if (!r.ok) return { fallback: true, error: await r.text() };
  const data = await r.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  const jsonText = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const vlm = JSON.parse(jsonText);
    vlm.atSecond = Number(atSecond) || 0;
    vlm.source = 'live-vision';
    vlm.frame_count = frameList.length;
    const cleaned = resolved ? sanitizeVlmOutput(vlm, resolved) : vlm;
    const moment = resolved ? interpretMoment(cleaned, resolved) : cleaned;
    return { moment, raw, vlm: cleaned };
  } catch {
    return { fallback: true, error: 'invalid JSON from vision model', raw };
  }
}

function buildVisionPromptFallback(priorMoments, frames) {
  const prior = priorMoments?.length
    ? `\nRecent memory:\n${priorMoments.map((m) => `- ${m.summary || m.event || ''}`).join('\n')}\n`
    : '';
  const multi = frames.length > 1
    ? `You receive ${frames.length} frames oldest-first. The LAST image is current.\n`
    : '';
  return `${multi}${prior}Extract visual soccer cues. Output JSON only with possession_kit, ball_screen_x, ball_screen_zone, play_moving, visual_event, danger_level, visual_summary.`;
}

async function extract(req, res) {
  const body = await readJson(req);
  const atSecond = Number(body.atSecond) || 0;
  const matchContext = body.matchContext?.teams
    ? body.matchContext
    : (body.matchContextRaw ? resolveContextAt(body.matchContextRaw, atSecond) : null);
  const result = await callQwenVision({ ...body, matchContext });
  send(res, 200, JSON.stringify({ provider: 'qwen-vl', ...result }), { 'content-type': 'application/json' });
}

async function tts(req, res) {
  const { text } = await readJson(req);
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return send(res, 204, '');
  const r = await fetch('https://api.deepgram.com/v1/speak?model=aura-2-thalia-en', {
    method: 'POST',
    headers: { authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text })
  });
  if (!r.ok) return send(res, 204, '');
  const buf = Buffer.from(await r.arrayBuffer());
  send(res, 200, buf, { 'content-type': r.headers.get('content-type') || 'audio/mpeg' });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (req.method === 'POST' && url.pathname === '/api/describe') return await describe(req, res);
    if (req.method === 'POST' && url.pathname === '/api/extract') return await extract(req, res);
    if (req.method === 'POST' && url.pathname === '/api/tts') return await tts(req, res);
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(root, pathname));
    if (!file.startsWith(root)) return send(res, 403, 'Forbidden');
    const data = await fs.readFile(file);
    send(res, 200, data, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  } catch (error) {
    send(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : String(error.stack || error));
  }
}).listen(port, () => console.log(`MatchVision server running at http://localhost:${port}`));
