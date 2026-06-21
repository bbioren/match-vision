// POST /api/labels  – store an immutable label row
// GET  /api/labels  – list all rows (for analysis)
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL,
  token: process.env.UPSTASH_KV_REST_API_TOKEN,
});

function submissionIdFromRequest(body, req) {
  // Primary: client sends it in the body
  if (body.teracSubmissionId) return body.teracSubmissionId;
  if (body.submissionId) return body.submissionId;
  // Fallback: parse it from the Referer header
  try {
    const ref = new URL(req.headers.get?.('referer') ?? req.headers['referer'] ?? '');
    return ref.searchParams.get('teracSubmissionId') ?? ref.searchParams.get('submissionId') ?? null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const submissionId = submissionIdFromRequest(body, req);

    const row = {
      id: `label_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      annotation_type: body.annotation_type ?? 'ranking',
      task_id: body.task_id ?? null,
      clip_id: body.clip_id ?? null,
      commentary: body.commentary ?? body.transcription ?? '',
      transcription: body.transcription ?? body.commentary ?? '',
      ranking: body.ranking ?? [],           // [{ id, text }] ordered best→worst
      reason_tags: body.reason_tags ?? [],   // e.g. ['ball_location', 'concise']
      why_best: body.why_best ?? '',
      is_calibration: body.is_calibration ?? false,
      calibration_passed: body.calibration_passed ?? null,
      terac_submission_id: submissionId,
      terac_task_id: body.teracTaskId ?? body.taskId ?? null,
      created_at: new Date().toISOString(),
    };

    // Immutable append — never update or delete
    await redis.lpush('matchvision:labels', JSON.stringify(row));

    // Per-rater session tracking
    if (submissionId) {
      const sessionKey = `matchvision:session:${submissionId}`;
      await redis.hincrby(sessionKey, 'vote_count', 1);
      if (row.is_calibration) {
        const field = row.calibration_passed ? 'calibration_passed' : 'calibration_failed';
        await redis.hincrby(sessionKey, field, 1);
      }
      await redis.hset(sessionKey, { last_seen: row.created_at, terac_submission_id: submissionId });
    }

    return res.status(201).json({ ok: true, id: row.id, terac_submission_id: submissionId });
  }

  if (req.method === 'GET') {
    const raw = await redis.lrange('matchvision:labels', 0, -1);
    const rows = raw.map(r => typeof r === 'string' ? JSON.parse(r) : r);
    return res.status(200).json({ count: rows.length, rows });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
