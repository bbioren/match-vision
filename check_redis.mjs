import { Redis } from '@upstash/redis';

const redis = new Redis({
  url: 'https://finer-fawn-151978.upstash.io',
  token: 'gQAAAAAAAlGqAAIgcDI4MTRjZGJkOTg4YjU0OGQ5OWNjZjM0MGQzNjg3N2FmYw'
});

try {
  // Get all labels
  const labels = await redis.lrange('matchvision:labels', 0, -1);
  console.log(`\n=== Labels in Upstash (${labels.length} total) ===\n`);
  
  labels.forEach((raw, i) => {
    const row = typeof raw === 'string' ? JSON.parse(raw) : raw;
    console.log(`[${i+1}] ${row.id}`);
    console.log(`    Terac ID: ${row.terac_submission_id || '(none)'}`);
    console.log(`    Task: ${row.task_id || row.clip_id}`);
    console.log(`    Type: ${row.annotation_type || 'unknown'}`);
    if (row.commentary || row.transcription) {
      const text = (row.commentary || row.transcription);
      console.log(`    Commentary: "${text.slice(0, 70)}..."`);
    }
    console.log();
  });
  
  process.exit(0);
} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
}
