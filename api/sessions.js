// GET /api/sessions – per-rater quality scores for analysis
import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: process.env.UPSTASH_KV_REST_API_URL,
  token: process.env.UPSTASH_KV_REST_API_TOKEN,
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const keys = await redis.keys('matchvision:session:*');
  if (!keys.length) return res.status(200).json({ count: 0, sessions: [] });

  const sessions = await Promise.all(
    keys.map(async (key) => {
      const data = await redis.hgetall(key);
      const passed = Number(data.calibration_passed ?? 0);
      const failed = Number(data.calibration_failed ?? 0);
      const total = passed + failed;
      return {
        ...data,
        vote_count: Number(data.vote_count ?? 0),
        calibration_passed: passed,
        calibration_failed: failed,
        quality_score: total > 0 ? Number((passed / total).toFixed(2)) : null,
      };
    })
  );

  return res.status(200).json({ count: sessions.length, sessions });
}
