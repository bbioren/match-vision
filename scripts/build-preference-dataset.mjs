/**
 * build-preference-dataset.mjs
 *
 * Reads label rows from /api/labels (or a local JSON dump) and produces
 * preference_pairs.jsonl for DPO / reward model training.
 *
 * Each 5-item ranking produces N*(N-1)/2 = 10 ordered pairs.
 * Only uses labels from raters who passed calibration checks.
 *
 * Usage:
 *   node scripts/build-preference-dataset.mjs [--api http://localhost:3000]
 */

import fs from 'node:fs';
import path from 'node:path';

const API_BASE = process.argv.find(a => a.startsWith('--api'))?.split('=')[1]
  ?? process.env.VERCEL_URL
  ?? 'http://localhost:3000';

async function fetchLabels() {
  const res = await fetch(`${API_BASE}/api/labels`);
  if (!res.ok) throw new Error(`Failed to fetch labels: ${res.status}`);
  const { rows } = await res.json();
  return rows;
}

async function fetchSessions() {
  const res = await fetch(`${API_BASE}/api/sessions`);
  if (!res.ok) return [];
  const { sessions } = await res.json();
  return sessions;
}

function buildPairs(rows, qualifiedSubmissionIds) {
  const pairs = [];

  for (const row of rows) {
    if (row.is_calibration) continue; // skip calibration rows

    // Filter to qualified raters (passed calibration or no calibration data yet)
    if (row.terac_submission_id && qualifiedSubmissionIds.size > 0) {
      if (!qualifiedSubmissionIds.has(row.terac_submission_id)) continue;
    }

    const ranking = row.ranking; // [{ id, text }, ...] ordered best→worst
    if (!ranking || ranking.length < 2) continue;

    // Expand into all ordered pairs (winner, loser)
    for (let i = 0; i < ranking.length; i++) {
      for (let j = i + 1; j < ranking.length; j++) {
        const winner = ranking[i];
        const loser = ranking[j];
        pairs.push({
          task_id: row.task_id,
          prompt: `Describe this soccer moment for a blind or low-vision fan: ${row.task_id}`,
          chosen: winner.text,
          rejected: loser.text,
          chosen_rank: i + 1,
          rejected_rank: j + 1,
          rank_gap: j - i,
          reason_tags: row.reason_tags ?? [],
          why_best: row.why_best ?? '',
          terac_submission_id: row.terac_submission_id,
          created_at: row.created_at,
        });
      }
    }
  }

  return pairs;
}

async function run() {
  console.log(`Fetching labels from ${API_BASE}...`);
  const [rows, sessions] = await Promise.all([fetchLabels(), fetchSessions()]);
  console.log(`  ${rows.length} label rows, ${sessions.length} rater sessions`);

  // Qualified raters: passed more calibration checks than they failed
  const qualifiedSubmissionIds = new Set(
    sessions
      .filter(s => s.quality_score === null || s.quality_score >= 0.5)
      .map(s => s.terac_submission_id)
      .filter(Boolean)
  );
  console.log(`  ${qualifiedSubmissionIds.size} qualified raters (passed calibration)`);

  const realRows = rows.filter(r => !r.is_calibration);
  const calRows = rows.filter(r => r.is_calibration);
  console.log(`  ${realRows.length} real labels, ${calRows.length} calibration labels`);

  const pairs = buildPairs(rows, qualifiedSubmissionIds);
  console.log(`  Generated ${pairs.length} preference pairs`);

  // Win rate by candidate id (which commentary style wins most)
  const winCounts = {};
  for (const p of pairs) {
    // We don't have strategy tags yet, so track by position in pair
    const taskPairs = pairs.filter(pp => pp.task_id === p.task_id && pp.rank_gap === 1);
    // Simple: tally chosen texts by first 40 chars as proxy
    const key = p.chosen.slice(0, 40);
    winCounts[key] = (winCounts[key] ?? 0) + 1;
  }

  // Output
  const outDir = 'data/training';
  fs.mkdirSync(outDir, { recursive: true });

  const outFile = path.join(outDir, 'preference_pairs.jsonl');
  fs.writeFileSync(outFile, pairs.map(p => JSON.stringify(p)).join('\n'));
  console.log(`\nWrote ${pairs.length} pairs to ${outFile}`);

  // Summary stats
  const summary = {
    total_label_rows: rows.length,
    real_labels: realRows.length,
    calibration_labels: calRows.length,
    qualified_raters: qualifiedSubmissionIds.size,
    total_preference_pairs: pairs.length,
    high_confidence_pairs: pairs.filter(p => p.rank_gap >= 2).length,
    generated_at: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2)
  );
  console.log('\nSummary:');
  console.log(JSON.stringify(summary, null, 2));
}

run().catch(err => { console.error(err); process.exit(1); });
