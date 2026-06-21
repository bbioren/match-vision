// POST /api/tts – proxy text to Deepgram TTS, returning audio bytes.
// Returns 204 (no body) if no Deepgram key is configured or the call fails,
// so the client can fall back to browser TTS without treating it as an error.
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) return res.status(204).end();

  const r = await fetch('https://api.deepgram.com/v1/speak?model=aura-2-thalia-en', {
    method: 'POST',
    headers: { authorization: `Token ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ text: body.text })
  });
  if (!r.ok) return res.status(204).end();

  const buf = Buffer.from(await r.arrayBuffer());
  res.setHeader('content-type', r.headers.get('content-type') || 'audio/mpeg');
  return res.status(200).send(buf);
}
