import http from 'node:http';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

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
  if (process.env.DASHSCOPE_API_KEY) return 'qwen';
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic';
  return 'fallback';
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
  if (provider === 'qwen') result = await callQwen(args);
  else if (provider === 'anthropic') result = await callAnthropic(args);
  else result = { fallback: true };
  send(res, 200, JSON.stringify({ provider, ...result }), { 'content-type': 'application/json' });
}
async function callQwenVision({ imageBase64, atSecond }) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey || !imageBase64) return { fallback: true };
  const base = process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
  const prompt = `You extract soccer match state for a blind/low-vision accessibility assistant.

Look at this frame and output JSON only (no markdown). Fields:
- team_in_possession (string or "unknown")
- direction (string or "unknown")
- ball_location (string or "unknown")
- event (string, what is happening)
- danger_level ("low" | "medium" | "high" | "unknown")
- summary (one sentence a blind fan would need)

Do not invent team names or player names. Use "unknown" if unclear.`;
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.QWEN_VL_MODEL || 'qwen3-vl-plus',
      max_tokens: 350,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
          { type: 'text', text: prompt }
        ]
      }]
    })
  });
  if (!r.ok) return { fallback: true, error: await r.text() };
  const data = await r.json();
  const raw = data.choices?.[0]?.message?.content?.trim() || '';
  const jsonText = raw.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const moment = JSON.parse(jsonText);
    moment.atSecond = Number(atSecond) || 0;
    moment.source = 'live-vision';
    return { moment, raw };
  } catch {
    return { fallback: true, error: 'invalid JSON from vision model', raw };
  }
}

async function extract(req, res) {
  const body = await readJson(req);
  const result = await callQwenVision(body);
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
