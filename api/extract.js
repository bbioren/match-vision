// POST /api/extract – live vision extraction via Qwen-VL: turns recent video
// frames into structured match state (ball location, possession, danger level).
import { buildVisionPrompt, interpretMoment, resolveContextAt, sanitizeVlmOutput } from '../src/services/match-context.js';

function buildVisionPromptFallback(priorMoments, frames) {
  const prior = priorMoments?.length
    ? `\nRecent memory:\n${priorMoments.map((m) => `- ${m.summary || m.event || ''}`).join('\n')}\n`
    : '';
  const multi = frames.length > 1
    ? `You receive ${frames.length} frames oldest-first. The LAST image is current.\n`
    : '';
  return `${multi}${prior}Extract visual soccer cues. Output JSON only with possession_kit, ball_screen_x, ball_screen_zone, play_moving, visual_event, danger_level, visual_summary.`;
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

  const atSecond = Number(body.atSecond) || 0;
  const matchContext = body.matchContext?.teams
    ? body.matchContext
    : (body.matchContextRaw ? resolveContextAt(body.matchContextRaw, atSecond) : null);
  const result = await callQwenVision({ ...body, matchContext });
  return res.status(200).json({ provider: 'qwen-vl', ...result });
}
