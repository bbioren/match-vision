// POST /api/gaze        – store one eye-tracking survey session (immutable)
// GET  /api/gaze         – list session summaries (no raw samples)
// GET  /api/gaze?full=1  – list full sessions including samples
// GET  /api/gaze?id=<id> – fetch one full session
//
// Gaze sessions are large (hundreds–thousands of samples per clip), so they're
// kept in their own Redis list, separate from /api/labels.
import { Redis as UpstashRedis } from '@upstash/redis';

const KEY = 'matchvision:gaze';

// Reused across warm invocations so we don't open a new TCP socket every call.
let _ioredis;

// Returns a store exposing lpush/lrange/hincrby/hset, or null if nothing is
// configured. Two backends are supported so it works with whatever the host
// provides:
//   1. Upstash REST (ideal for serverless) — UPSTASH_KV_REST_API_URL/TOKEN
//      (also accepts the KV_/UPSTASH_REDIS_ aliases the integrations inject).
//   2. A redis:// / rediss:// connection string (e.g. REDIS_URL) via ioredis.
async function getStore() {
  const restUrl =
    process.env.UPSTASH_KV_REST_API_URL ||
    process.env.KV_REST_API_URL ||
    process.env.UPSTASH_REDIS_REST_URL;
  const restToken =
    process.env.UPSTASH_KV_REST_API_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    process.env.UPSTASH_REDIS_REST_TOKEN;
  if (restUrl && restToken) {
    return new UpstashRedis({ url: restUrl, token: restToken });
  }

  const conn = process.env.REDIS_URL || process.env.KV_URL || process.env.UPSTASH_REDIS_URL;
  if (conn) {
    if (!_ioredis) {
      const { default: IORedis } = await import('ioredis');
      _ioredis = new IORedis(conn, { maxRetriesPerRequest: 3, connectTimeout: 8000 });
      _ioredis.on('error', (e) => console.error('ioredis error:', e?.message));
    }
    return _ioredis;
  }
  return null;
}

function submissionIdFromRequest(body, req) {
  if (body.teracSubmissionId) return body.teracSubmissionId;
  if (body.submissionId) return body.submissionId;
  try {
    const ref = new URL(req.headers.get?.('referer') ?? req.headers['referer'] ?? '');
    return ref.searchParams.get('teracSubmissionId') ?? ref.searchParams.get('submissionId') ?? null;
  } catch {
    return null;
  }
}

function summarize(session) {
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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (req.method === 'OPTIONS') return res.status(200).end();

  let redis;
  try {
    redis = await getStore();
  } catch (err) {
    return res.status(502).json({ error: 'storage_unavailable', message: err?.message });
  }
  if (!redis) {
    return res.status(503).json({
      error: 'storage_not_configured',
      message: 'Set REDIS_URL (or UPSTASH_KV_REST_API_URL + UPSTASH_KV_REST_API_TOKEN) in the Vercel project env (Production), then redeploy.',
    });
  }

  if (req.method === 'POST') {
    let body;
    try {
      body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const submissionId = submissionIdFromRequest(body, req);
    const clips = Array.isArray(body.clips) ? body.clips : [];
    const session = {
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

    await redis.lpush(KEY, JSON.stringify(session));

    if (submissionId) {
      const sessionKey = `matchvision:gaze_session:${submissionId}`;
      await redis.hincrby(sessionKey, 'survey_count', 1);
      await redis.hset(sessionKey, { last_seen: session.created_at, terac_submission_id: submissionId });
    }

    const totalSamples = session.clips.reduce((n, c) => n + c.sample_count, 0);
    return res.status(201).json({ ok: true, id: session.id, clips: session.clips.length, samples: totalSamples });
  }

  if (req.method === 'GET') {
    // Gaze sessions are participant research data — reads require an admin token.
    // Writing (POST) stays open so survey participants can still submit. Fails
    // closed: if no token is configured, reading is disabled entirely.
    const adminToken = process.env.GAZE_ADMIN_TOKEN;
    const provided = req.query?.token ?? req.headers['x-admin-token'];
    if (!adminToken) {
      return res.status(503).json({
        error: 'admin_token_not_configured',
        message: 'Reading gaze data is disabled until GAZE_ADMIN_TOKEN is set in the Vercel project env (Production). Set it and redeploy, then pass ?token=<value> or the x-admin-token header.',
      });
    }
    if (provided !== adminToken) {
      return res.status(401).json({ error: 'unauthorized', message: 'Provide the admin token via ?token= or the x-admin-token header.' });
    }

    const raw = await redis.lrange(KEY, 0, -1);
    const sessions = raw.map((r) => (typeof r === 'string' ? JSON.parse(r) : r));
    const id = req.query?.id;
    if (id) {
      const found = sessions.find((s) => s.id === id);
      if (!found) return res.status(404).json({ error: 'not found' });
      return res.status(200).json(found);
    }
    const full = req.query?.full === '1';
    const rows = full ? sessions : sessions.map(summarize);
    return res.status(200).json({ count: rows.length, sessions: rows });
  }

  if (req.method === 'DELETE') {
    const all = req.query?.all === '1';
    const id = req.query?.id;
    // Optional guard: if GAZE_ADMIN_TOKEN is set, a flush (?all=1) requires it.
    const adminToken = process.env.GAZE_ADMIN_TOKEN;
    const provided = req.query?.token ?? req.headers['x-admin-token'];

    if (all) {
      if (adminToken && provided !== adminToken) return res.status(403).json({ error: 'forbidden' });
      await redis.del(KEY);
      return res.status(200).json({ ok: true, deleted: 'all' });
    }
    if (!id) return res.status(400).json({ error: 'provide ?id=<sessionId> or ?all=1' });

    const raw = await redis.lrange(KEY, 0, -1);
    const target = raw.find((r) => {
      try { return (typeof r === 'string' ? JSON.parse(r) : r).id === id; } catch { return false; }
    });
    if (target === undefined) return res.status(404).json({ error: 'not found' });
    await redis.lrem(KEY, 1, target);
    return res.status(200).json({ ok: true, deleted: id });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
