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

// Champion prompt (Phase 3A, docs/TERAC_FINETUNE_PLAN.md): if real Terac
// preference data has been turned into data/prompts/champion_prompt.txt via
// scripts/optimize-prompt.mjs, use it as the system prompt for ADC/Q&A
// generation instead of the client-supplied default. Purely additive — when
// the file doesn't exist (the common case pre-launch / pre-labels) this is a
// no-op and /api/describe behaves exactly as before.
const CHAMPION_PROMPT_PATH = path.join(root, 'data', 'prompts', 'champion_prompt.txt');
let championPrompt = null;
try {
  championPrompt = fsSync.readFileSync(CHAMPION_PROMPT_PATH, 'utf8').trim() || null;
  if (championPrompt) console.log(`Loaded champion prompt from ${CHAMPION_PROMPT_PATH}`);
} catch {
  // No champion prompt yet — fall back to whatever system prompt the caller sends.
}

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
  // Champion prompt (if one has been learned from real Terac preference data)
  // takes over the system prompt for narration calls; falls back to whatever
  // the client sent (src/services/description.js's IMPROVED_SYSTEM) otherwise.
  const system = championPrompt || body.system;
  const args = { system, prompt: body.prompt, maxTokens };
  let result;
  if (provider === 'gemini') result = await callGemini(args);
  else if (provider === 'qwen') result = await callQwen(args);
  else if (provider === 'anthropic') result = await callAnthropic(args);
  else result = { fallback: true };
  send(res, 200, JSON.stringify({ provider, usedChampionPrompt: Boolean(championPrompt), ...result }), { 'content-type': 'application/json' });
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

function labelSubmissionId(body, req) {
  if (body.teracSubmissionId) return body.teracSubmissionId;
  if (body.submissionId) return body.submissionId;
  try {
    const ref = new URL(req.headers.referer || '');
    return ref.searchParams.get('teracSubmissionId') ?? ref.searchParams.get('submissionId') ?? null;
  } catch {
    return null;
  }
}
async function readLocalLabels() {
  try {
    const raw = await fs.readFile(path.join(root, 'data', 'labels.local.json'), 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}
async function writeLocalLabels(rows) {
  await fs.mkdir(path.join(root, 'data'), { recursive: true });
  await fs.writeFile(path.join(root, 'data', 'labels.local.json'), JSON.stringify(rows, null, 2));
}
async function labels(req, res) {
  if (req.method === 'POST') {
    const body = await readJson(req);
    const submissionId = labelSubmissionId(body, req);
    const row = {
      id: `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      annotation_type: body.annotation_type ?? 'ranking',
      task_id: body.task_id ?? null,
      clip_id: body.clip_id ?? null,
      commentary: body.commentary ?? body.transcription ?? '',
      transcription: body.transcription ?? body.commentary ?? '',
      ranking: body.ranking ?? [],
      reason_tags: body.reason_tags ?? [],
      why_best: body.why_best ?? '',
      is_calibration: body.is_calibration ?? false,
      calibration_passed: body.calibration_passed ?? null,
      terac_submission_id: submissionId,
      terac_task_id: body.teracTaskId ?? body.taskId ?? null,
      created_at: new Date().toISOString(),
    };
    const rows = await readLocalLabels();
    rows.unshift(row);
    await writeLocalLabels(rows);
    return send(res, 201, JSON.stringify({ ok: true, id: row.id, terac_submission_id: submissionId }), { 'content-type': 'application/json' });
  }
  if (req.method === 'GET') {
    const rows = await readLocalLabels();
    return send(res, 200, JSON.stringify({ count: rows.length, rows }), { 'content-type': 'application/json' });
  }
  send(res, 405, JSON.stringify({ error: 'Method not allowed' }), { 'content-type': 'application/json' });
}
// ── Gaze survey persistence ────────────────────────────────────────────────
// Eye-tracking sessions are large (hundreds–thousands of samples per clip), so
// they're stored separately from /api/labels: one JSON file per session under
// data/gaze/. On Vercel the equivalent handler (api/gaze.js) uses Upstash.
const GAZE_DIR = path.join(root, 'data', 'gaze');

function buildGazeSession(body, req) {
  const submissionId = labelSubmissionId(body, req);
  const clips = Array.isArray(body.clips) ? body.clips : [];
  return {
    id: `gaze_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    survey_id: body.survey_id ?? 'soccer_gaze_v1',
    terac_submission_id: submissionId,
    terac_task_id: body.teracTaskId ?? body.taskId ?? null,
    calibration: body.calibration ?? null,
    participant: body.participant ?? null,
    clips: clips.map((clip) => ({
      clip_id: clip.clip_id ?? null,
      video_src: clip.video_src ?? null,
      duration_seconds: clip.duration_seconds ?? null,
      watched_seconds: clip.watched_seconds ?? null,
      zoom: clip.zoom ?? 1,
      sample_count: Array.isArray(clip.samples) ? clip.samples.length : 0,
      samples: Array.isArray(clip.samples) ? clip.samples : [],
    })),
    created_at: new Date().toISOString(),
  };
}

function summarizeGazeSession(session) {
  return {
    id: session.id,
    survey_id: session.survey_id,
    terac_submission_id: session.terac_submission_id,
    calibration: session.calibration,
    created_at: session.created_at,
    clips: (session.clips ?? []).map((c) => ({
      clip_id: c.clip_id,
      video_src: c.video_src,
      duration_seconds: c.duration_seconds,
      watched_seconds: c.watched_seconds,
      zoom: c.zoom,
      sample_count: c.sample_count,
    })),
  };
}

async function readGazeSessions() {
  try {
    const files = await fs.readdir(GAZE_DIR);
    const sessions = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        sessions.push(JSON.parse(await fs.readFile(path.join(GAZE_DIR, file), 'utf8')));
      } catch { /* skip corrupt file */ }
    }
    sessions.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return sessions;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function gaze(req, res) {
  if (req.method === 'POST') {
    const body = await readJson(req);
    const session = buildGazeSession(body, req);
    await fs.mkdir(GAZE_DIR, { recursive: true });
    await fs.writeFile(path.join(GAZE_DIR, `${session.id}.json`), JSON.stringify(session, null, 2));
    const totalSamples = session.clips.reduce((n, c) => n + c.sample_count, 0);
    return send(res, 201, JSON.stringify({ ok: true, id: session.id, clips: session.clips.length, samples: totalSamples }), { 'content-type': 'application/json' });
  }
  if (req.method === 'GET') {
    const url = new URL(req.url, `http://localhost:${port}`);
    // Mirror the production read gate (api/gaze.js): if GAZE_ADMIN_TOKEN is set,
    // require it. Left unset locally so dev stays frictionless (localhost only).
    const adminToken = process.env.GAZE_ADMIN_TOKEN;
    if (adminToken) {
      const provided = url.searchParams.get('token') ?? req.headers['x-admin-token'];
      if (provided !== adminToken) return send(res, 401, JSON.stringify({ error: 'unauthorized' }), { 'content-type': 'application/json' });
    }
    const id = url.searchParams.get('id');
    const full = url.searchParams.get('full') === '1' || id;
    const sessions = await readGazeSessions();
    if (id) {
      const found = sessions.find((s) => s.id === id);
      if (!found) return send(res, 404, JSON.stringify({ error: 'not found' }), { 'content-type': 'application/json' });
      return send(res, 200, JSON.stringify(found), { 'content-type': 'application/json' });
    }
    const rows = full ? sessions : sessions.map(summarizeGazeSession);
    return send(res, 200, JSON.stringify({ count: rows.length, sessions: rows }), { 'content-type': 'application/json' });
  }
  if (req.method === 'DELETE') {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.searchParams.get('all') === '1') {
      try { await fs.rm(GAZE_DIR, { recursive: true, force: true }); } catch {}
      return send(res, 200, JSON.stringify({ ok: true, deleted: 'all' }), { 'content-type': 'application/json' });
    }
    const id = url.searchParams.get('id');
    if (!id) return send(res, 400, JSON.stringify({ error: 'provide ?id=<sessionId> or ?all=1' }), { 'content-type': 'application/json' });
    try {
      await fs.unlink(path.join(GAZE_DIR, `${id}.json`));
      return send(res, 200, JSON.stringify({ ok: true, deleted: id }), { 'content-type': 'application/json' });
    } catch (error) {
      return send(res, error.code === 'ENOENT' ? 404 : 500, JSON.stringify({ error: error.code === 'ENOENT' ? 'not found' : String(error) }), { 'content-type': 'application/json' });
    }
  }
  send(res, 405, JSON.stringify({ error: 'Method not allowed' }), { 'content-type': 'application/json' });
}

async function sessions(req, res) {
  if (req.method !== 'GET') return send(res, 405, JSON.stringify({ error: 'Method not allowed' }), { 'content-type': 'application/json' });
  const rows = await readLocalLabels();
  const bySession = new Map();
  for (const row of rows) {
    if (!row.terac_submission_id) continue;
    const current = bySession.get(row.terac_submission_id) ?? { terac_submission_id: row.terac_submission_id, vote_count: 0, calibration_passed: 0, calibration_failed: 0, last_seen: null };
    current.vote_count += 1;
    if (row.is_calibration) current[row.calibration_passed ? 'calibration_passed' : 'calibration_failed'] += 1;
    if (!current.last_seen || row.created_at > current.last_seen) current.last_seen = row.created_at;
    bySession.set(row.terac_submission_id, current);
  }
  const sessions = [...bySession.values()].map(session => {
    const total = session.calibration_passed + session.calibration_failed;
    return { ...session, quality_score: total > 0 ? Number((session.calibration_passed / total).toFixed(2)) : null };
  });
  send(res, 200, JSON.stringify({ count: sessions.length, sessions }), { 'content-type': 'application/json' });
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
    if (url.pathname === '/api/labels') return await labels(req, res);
    if (url.pathname === '/api/gaze') return await gaze(req, res);
    if (url.pathname === '/api/sessions') return await sessions(req, res);
    if (req.method === 'POST' && url.pathname === '/api/tts') return await tts(req, res);
    // Proxy mediapipe WASM assets for WebGazer (it hardcodes relative paths)
    if (url.pathname.startsWith('/mediapipe/')) {
      const upstream = `https://cdn.jsdelivr.net/npm/@mediapipe${url.pathname.slice('/mediapipe'.length)}`;
      const r = await fetch(upstream);
      if (!r.ok) return send(res, 404, 'Not found');
      const buf = Buffer.from(await r.arrayBuffer());
      const ct = r.headers.get('content-type') || 'application/octet-stream';
      return send(res, 200, buf, { 'content-type': ct, 'cache-control': 'public,max-age=86400' });
    }
    const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(root, pathname));
    if (!file.startsWith(root)) return send(res, 403, 'Forbidden');

    // Stream static files with HTTP range support so <video> can seek/scrub
    // (the survey player and the gaze-results timeline overlay both rely on this).
    const stat = await fs.stat(file);
    if (stat.isDirectory()) return send(res, 404, 'Not found');
    const ctype = mime[path.extname(file)] || 'application/octet-stream';
    const rangeHeader = req.headers.range;
    const m = rangeHeader && /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (m) {
      let start = m[1] === '' ? null : parseInt(m[1], 10);
      let end = m[2] === '' ? null : parseInt(m[2], 10);
      if (start === null) { start = Math.max(0, stat.size - (end ?? 0)); end = stat.size - 1; }
      else if (end === null || end >= stat.size) { end = stat.size - 1; }
      if (start > end || start >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
        return res.end();
      }
      res.writeHead(206, {
        'content-type': ctype,
        'accept-ranges': 'bytes',
        'content-range': `bytes ${start}-${end}/${stat.size}`,
        'content-length': end - start + 1,
      });
      if (req.method === 'HEAD') return res.end();
      return fsSync.createReadStream(file, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': ctype, 'accept-ranges': 'bytes', 'content-length': stat.size });
    if (req.method === 'HEAD') return res.end();
    fsSync.createReadStream(file).pipe(res);
  } catch (error) {
    send(res, error.code === 'ENOENT' ? 404 : 500, error.code === 'ENOENT' ? 'Not found' : String(error.stack || error));
  }
}).listen(port, () => console.log(`MatchVision server running at http://localhost:${port}`));
