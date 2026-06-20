import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const port = Number(process.env.PORT || 5173);
const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown' };

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
async function describe(req, res) {
  const body = await readJson(req);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return send(res, 200, JSON.stringify({ description: null, fallback: true }), { 'content-type': 'application/json' });
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({ model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest', max_tokens: 180, messages: [{ role: 'user', content: body.prompt }] })
  });
  if (!r.ok) return send(res, 200, JSON.stringify({ description: null, fallback: true, error: await r.text() }), { 'content-type': 'application/json' });
  const data = await r.json();
  const description = data.content?.map((c) => c.text || '').join('\n').trim();
  send(res, 200, JSON.stringify({ description }), { 'content-type': 'application/json' });
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
