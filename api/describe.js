// POST /api/describe – generate an accessible description via whichever LLM
// provider has credentials configured (Gemini, Qwen, or Anthropic), falling
// back to a flag the client uses to fall back to its own local description.
import fs from 'node:fs';
import path from 'node:path';

// If real Terac preference data has been turned into a champion prompt via
// scripts/optimize-prompt.mjs, use it as the system prompt instead of
// whatever the client sent. Purely additive — a no-op if the file isn't
// present in this deployment.
const CHAMPION_PROMPT_PATH = path.join(process.cwd(), 'data', 'prompts', 'champion_prompt.txt');
let championPrompt = null;
try {
  championPrompt = fs.readFileSync(CHAMPION_PROMPT_PATH, 'utf8').trim() || null;
} catch {
  // No champion prompt in this deployment — fall back to the client's system prompt.
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

  const provider = resolveProvider();
  const maxTokens = Number(body.maxTokens) || 200;
  const system = championPrompt || body.system;
  const args = { system, prompt: body.prompt, maxTokens };

  let result;
  if (provider === 'gemini') result = await callGemini(args);
  else if (provider === 'qwen') result = await callQwen(args);
  else if (provider === 'anthropic') result = await callAnthropic(args);
  else result = { fallback: true };

  return res.status(200).json({ provider, usedChampionPrompt: Boolean(championPrompt), ...result });
}
