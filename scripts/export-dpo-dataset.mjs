#!/usr/bin/env node
/**
 * export-dpo-dataset.mjs
 *
 * Converts data/training/preference_pairs.jsonl (built by
 * scripts/build-preference-dataset.mjs from real Terac rankings) into a
 * strict DPO-style fine-tune file: one JSON object per line with exactly
 * {prompt, chosen, rejected} — the format expected by most fine-tuning APIs
 * (OpenAI, local `trl` DPO trainers, etc.), per Option B in
 * docs/TERAC_FINETUNE_PLAN.md.
 *
 * preference_pairs.jsonl already carries a `prompt` field plus extra
 * metadata (task_id, rank_gap, reason_tags, ...) useful for debugging/eval;
 * this script strips that down to the minimal fine-tune-ready shape and
 * (optionally) filters to higher-confidence pairs only.
 *
 * Gracefully reports "no preference data yet" instead of crashing if the
 * input file doesn't exist.
 *
 * Usage:
 *   node scripts/export-dpo-dataset.mjs
 *   node scripts/export-dpo-dataset.mjs --in=data/training/preference_pairs.jsonl --out=data/training/dpo_dataset.jsonl
 *   node scripts/export-dpo-dataset.mjs --min-rank-gap=2   # only keep high-confidence pairs (rank gap >= 2)
 */

import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;

const IN_PATH = arg('in', 'data/training/preference_pairs.jsonl');
const OUT_PATH = arg('out', 'data/training/dpo_dataset.jsonl');
const MIN_RANK_GAP = Number(arg('min-rank-gap', 1));

function main() {
  if (!fs.existsSync(IN_PATH)) {
    console.log(`No preference data yet at ${IN_PATH}.`);
    console.log('Run scripts/build-preference-dataset.mjs first once real Terac labels exist:');
    console.log('  node scripts/build-preference-dataset.mjs --api=http://localhost:5173');
    console.log('Nothing written. Exiting cleanly.');
    return;
  }

  const raw = fs.readFileSync(IN_PATH, 'utf8').trim();
  const pairs = raw ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
  if (!pairs.length) {
    console.log(`${IN_PATH} exists but contains 0 pairs. Nothing to export.`);
    return;
  }

  const filtered = pairs.filter((p) => (p.rank_gap ?? 1) >= MIN_RANK_GAP);
  const dpoRows = filtered
    .filter((p) => p.prompt && p.chosen && p.rejected)
    .map((p) => ({ prompt: p.prompt, chosen: p.chosen, rejected: p.rejected }));

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, dpoRows.map((r) => JSON.stringify(r)).join('\n') + (dpoRows.length ? '\n' : ''));

  console.log(`Read ${pairs.length} preference pairs from ${IN_PATH}`);
  console.log(`Kept ${filtered.length} pairs with rank_gap >= ${MIN_RANK_GAP}`);
  console.log(`Wrote ${dpoRows.length} DPO rows -> ${OUT_PATH}`);
  console.log('\nFormat (one per line): {"prompt": "...", "chosen": "...", "rejected": "..."}');
  console.log('Ready for: OpenAI fine-tuning, local trl DPOTrainer, or Anthropic fine-tuning API once available.');
}

main();
