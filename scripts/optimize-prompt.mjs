#!/usr/bin/env node
/**
 * optimize-prompt.mjs  (Phase 3A — "champion prompt", see docs/TERAC_FINETUNE_PLAN.md)
 *
 * Reads data/training/preference_pairs.jsonl (produced by
 * scripts/build-preference-dataset.mjs from real Terac rankings) and:
 *   1. Tallies which prompt_strategy wins most often across pairs.
 *   2. Extracts common linguistic patterns from winning texts (ball-location
 *      mentions, direction mentions, sentence length, hedging language).
 *   3. Writes a "champion prompt" to data/prompts/champion_prompt.txt that
 *      encodes those winning patterns explicitly as instructions.
 *   4. Evaluates champion vs. a generic baseline prompt on held-out clips
 *      using the same automated metrics as scripts/compute-metrics.mjs
 *      (ball location rate, direction mentioned, hallucination estimate).
 *
 * Gracefully reports "no preference data yet" instead of crashing when
 * data/training/preference_pairs.jsonl does not exist — this is expected
 * until real Terac labels have been collected and run through
 * build-preference-dataset.mjs.
 *
 * Usage:
 *   node scripts/optimize-prompt.mjs
 *   node scripts/optimize-prompt.mjs --pairs data/training/preference_pairs.jsonl
 *
 * How to produce the input file once real labels exist:
 *   1. Collect rankings via the Annotation Lab (annotate.html -> POST /api/labels,
 *      stored in data/labels.local.json by local-server.mjs, or via Terac's
 *      hosted flow -> /api/labels + /api/sessions).
 *   2. node scripts/build-preference-dataset.mjs --api http://localhost:5173
 *      -> writes data/training/preference_pairs.jsonl
 *   3. node scripts/optimize-prompt.mjs
 *      -> writes data/prompts/champion_prompt.txt + prints eval metrics
 */

import fs from 'node:fs';
import path from 'node:path';

const PAIRS_PATH = process.argv.find((a) => a.startsWith('--pairs'))?.split('=')[1]
  ?? 'data/training/preference_pairs.jsonl';
const OUT_DIR = 'data/prompts';
const OUT_PATH = path.join(OUT_DIR, 'champion_prompt.txt');
const TASKS_PATH = 'data/annotation_tasks.json';

// ── Linguistic feature heuristics (mirrors scripts/compute-metrics.mjs rates) ─
const BALL_LOCATION_WORDS = /\b(penalty area|six-yard|six yard|box|midfield|wing|flank|touchline|edge of the area|near post|far post|center circle|halfway line|corner|byline)\b/i;
const DIRECTION_WORDS = /\b(left|right|forward|backward|toward goal|toward the goal|advancing|attacking|drives? (?:left|right|forward)|moving (?:left|right|forward))\b/i;
const HEDGING_WORDS = /\b(maybe|perhaps|seems to|appears to|might|possibly|i think|looks like)\b/i;
const SPECULATIVE_OUTCOME_WORDS = /\b(scores?|saves?|goal!|strikes it in|nets it|wins? the (?:match|game))\b/i;

function sentenceCount(text) {
  return (text.match(/[.!?]+/g) || []).length || 1;
}
function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function readPairs(pairsPath) {
  const raw = fs.readFileSync(pairsPath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

// Pairs from build-preference-dataset.mjs don't currently carry a
// prompt_strategy tag (the dataset only has chosen/rejected text + task_id) —
// join back to annotation_tasks.json's commentary_variations to recover which
// strategy id produced each winning/losing text, when available.
function loadStrategyIndex() {
  if (!fs.existsSync(TASKS_PATH)) return new Map();
  const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
  const index = new Map(); // text -> { id, label }
  for (const task of tasks) {
    for (const c of task.commentary_variations || task.candidates || []) {
      const text = (c.text || c.description || '').trim();
      if (text) index.set(text, { id: c.id, label: c.label });
    }
  }
  return index;
}

function strategyFor(text, index) {
  return index.get((text || '').trim()) || null;
}

function tallyStrategyWins(pairs, strategyIndex) {
  const wins = {};
  const losses = {};
  for (const p of pairs) {
    const chosenStrategy = strategyFor(p.chosen, strategyIndex);
    const rejectedStrategy = strategyFor(p.rejected, strategyIndex);
    if (chosenStrategy) {
      const key = `${chosenStrategy.id}:${chosenStrategy.label}`;
      wins[key] = (wins[key] || 0) + 1;
    }
    if (rejectedStrategy) {
      const key = `${rejectedStrategy.id}:${rejectedStrategy.label}`;
      losses[key] = (losses[key] || 0) + 1;
    }
  }
  return { wins, losses };
}

function extractPatterns(pairs) {
  const chosenTexts = pairs.map((p) => p.chosen).filter(Boolean);
  const rejectedTexts = pairs.map((p) => p.rejected).filter(Boolean);

  const rate = (texts, re) => texts.length
    ? texts.filter((t) => re.test(t)).length / texts.length
    : 0;
  const avg = (texts, fn) => texts.length
    ? texts.reduce((s, t) => s + fn(t), 0) / texts.length
    : 0;

  return {
    chosen_count: chosenTexts.length,
    rejected_count: rejectedTexts.length,
    ball_location_rate_chosen: rate(chosenTexts, BALL_LOCATION_WORDS),
    ball_location_rate_rejected: rate(rejectedTexts, BALL_LOCATION_WORDS),
    direction_rate_chosen: rate(chosenTexts, DIRECTION_WORDS),
    direction_rate_rejected: rate(rejectedTexts, DIRECTION_WORDS),
    hedging_rate_chosen: rate(chosenTexts, HEDGING_WORDS),
    hedging_rate_rejected: rate(rejectedTexts, HEDGING_WORDS),
    speculative_outcome_rate_chosen: rate(chosenTexts, SPECULATIVE_OUTCOME_WORDS),
    speculative_outcome_rate_rejected: rate(rejectedTexts, SPECULATIVE_OUTCOME_WORDS),
    avg_sentences_chosen: avg(chosenTexts, sentenceCount),
    avg_sentences_rejected: avg(rejectedTexts, sentenceCount),
    avg_words_chosen: avg(chosenTexts, wordCount),
    avg_words_rejected: avg(rejectedTexts, wordCount),
  };
}

function buildChampionPrompt({ winningStrategy, patterns }) {
  const lines = [];
  lines.push('You are an audio description specialist for blind and low-vision soccer fans.');
  lines.push('');
  lines.push('This prompt was learned from real Terac human rankings of AI-generated commentary');
  lines.push('candidates (see docs/TERAC_FINETUNE_PLAN.md, Phase 3A). It encodes the linguistic');
  lines.push('patterns that won most often when humans ranked candidates head-to-head.');
  lines.push('');
  if (winningStrategy) {
    lines.push(`Winning strategy from preference data: "${winningStrategy.label}" (id ${winningStrategy.id}).`);
    lines.push('Write in that voice: prioritize the qualities that made it win.');
    lines.push('');
  }

  const target = (rate) => Math.round(rate * 100);
  if (patterns.ball_location_rate_chosen > patterns.ball_location_rate_rejected) {
    lines.push(`- ALWAYS name a specific field zone (e.g. "penalty area", "six-yard box", "midfield", "the wing"). Winning commentary mentioned ball location ${target(patterns.ball_location_rate_chosen)}% of the time vs ${target(patterns.ball_location_rate_rejected)}% for losing commentary.`);
  }
  if (patterns.direction_rate_chosen > patterns.direction_rate_rejected) {
    lines.push(`- ALWAYS state the direction of play (left/right/toward goal). Winning commentary mentioned direction ${target(patterns.direction_rate_chosen)}% of the time vs ${target(patterns.direction_rate_rejected)}% for losing commentary.`);
  }
  if (patterns.hedging_rate_chosen < patterns.hedging_rate_rejected) {
    lines.push(`- AVOID hedging language ("maybe", "seems to", "might"). State facts plainly — losing commentary hedged ${target(patterns.hedging_rate_rejected)}% of the time vs ${target(patterns.hedging_rate_chosen)}% for winning commentary.`);
  }
  if (patterns.speculative_outcome_rate_chosen < patterns.speculative_outcome_rate_rejected) {
    lines.push('- NEVER speculate about the outcome (no "scores", "saves", "wins the match") — describe only the visible moment.');
  }
  const wordTarget = Math.round(patterns.avg_words_chosen) || 30;
  lines.push(`- Target roughly ${wordTarget} words — winning commentary averaged ${patterns.avg_words_chosen.toFixed(1)} words vs ${patterns.avg_words_rejected.toFixed(1)} for losing commentary.`);
  lines.push('');
  lines.push('CRITICAL RULES — violating any of these makes your output unusable:');
  lines.push('- Describe ONLY what is visible/known right now from the provided match memory and context.');
  lines.push('- NEVER invent players, positions, or events not present in the provided data.');
  lines.push('- If something is unknown, say what is unknown rather than guessing.');
  lines.push('- Always include ball zone and which team has possession when known.');
  return lines.join('\n') + '\n';
}

// ── Held-out evaluation: champion vs. generic baseline prompt ────────────────
// Uses the same automated metrics as scripts/compute-metrics.mjs, computed
// directly over text (no LLM call needed) so this works offline.
function scoreText(text) {
  return {
    mentions_ball_location: BALL_LOCATION_WORDS.test(text),
    mentions_direction: DIRECTION_WORDS.test(text),
    hedges: HEDGING_WORDS.test(text),
    speculative_outcome: SPECULATIVE_OUTCOME_WORDS.test(text),
    words: wordCount(text),
  };
}

function evalHeldOut(strategyIndex) {
  if (!fs.existsSync(TASKS_PATH)) return null;
  const tasks = JSON.parse(fs.readFileSync(TASKS_PATH, 'utf8'));
  const withCandidates = tasks.filter((t) => (t.commentary_variations || t.candidates || []).length);
  if (!withCandidates.length) return null;

  // Held-out = candidates not present in the preference pairs' text set
  // (a quick stand-in for "clips the rater never saw"); falls back to all
  // candidates if everything has been seen.
  const baselineTexts = [];
  const otherTexts = [];
  for (const t of withCandidates) {
    for (const c of t.commentary_variations || t.candidates || []) {
      const text = c.text || c.description;
      if (!text) continue;
      if (c.id === 'e' || c.label === 'Baseline') baselineTexts.push(text);
      else otherTexts.push(text);
    }
  }

  const summarize = (texts) => {
    const scored = texts.map(scoreText);
    const rate = (key) => scored.length ? scored.filter((s) => s[key]).length / scored.length : 0;
    return {
      n: scored.length,
      ball_location_rate: rate('mentions_ball_location'),
      direction_rate: rate('mentions_direction'),
      hedging_rate: rate('hedges'),
      speculative_outcome_rate: rate('speculative_outcome'),
      avg_words: scored.length ? scored.reduce((s, x) => s + x.words, 0) / scored.length : 0,
    };
  };

  return {
    baseline_strategy: summarize(baselineTexts),
    other_strategies_combined: summarize(otherTexts),
    note: 'Heuristic text-pattern eval over existing candidates (no LLM call). ' +
      'Re-run after generate-candidates.mjs + a real champion-prompt-driven generation pass for a true held-out comparison.',
  };
}

function main() {
  if (!fs.existsSync(PAIRS_PATH)) {
    console.log(`No preference data yet at ${PAIRS_PATH}.`);
    console.log('');
    console.log('To generate it once real Terac labels exist:');
    console.log('  1. Collect rankings via annotate.html (writes to data/labels.local.json via /api/labels).');
    console.log('  2. node scripts/build-preference-dataset.mjs --api=http://localhost:5173');
    console.log('     -> writes data/training/preference_pairs.jsonl');
    console.log('  3. node scripts/optimize-prompt.mjs');
    console.log('     -> writes data/prompts/champion_prompt.txt + prints eval metrics');
    console.log('');
    console.log('Nothing written. Exiting cleanly (this is expected pre-launch).');
    return;
  }

  const pairs = readPairs(PAIRS_PATH);
  if (!pairs.length) {
    console.log(`${PAIRS_PATH} exists but contains 0 pairs. Nothing to optimize yet.`);
    return;
  }

  console.log(`Loaded ${pairs.length} preference pairs from ${PAIRS_PATH}`);

  const strategyIndex = loadStrategyIndex();
  const { wins, losses } = tallyStrategyWins(pairs, strategyIndex);
  const rankedWins = Object.entries(wins).sort((a, b) => b[1] - a[1]);
  console.log('\nStrategy win counts (chosen side of pairs):');
  if (rankedWins.length) {
    for (const [key, count] of rankedWins) console.log(`  ${key}: ${count} wins (${losses[key] || 0} losses)`);
  } else {
    console.log('  (no strategy tags resolved — annotation_tasks.json candidates may not match pair text verbatim)');
  }

  const topKey = rankedWins[0]?.[0];
  const winningStrategy = topKey ? { id: topKey.split(':')[0], label: topKey.split(':')[1] } : null;

  const patterns = extractPatterns(pairs);
  console.log('\nLinguistic patterns (chosen vs rejected):');
  console.log(JSON.stringify(patterns, null, 2));

  const champion = buildChampionPrompt({ winningStrategy, patterns });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, champion);
  console.log(`\nWrote champion prompt -> ${OUT_PATH}`);

  const evalResult = evalHeldOut(strategyIndex);
  if (evalResult) {
    console.log('\nHeld-out-style eval (baseline strategy vs all others, heuristic text metrics):');
    console.log(JSON.stringify(evalResult, null, 2));
    fs.writeFileSync(path.join(OUT_DIR, 'champion_eval.json'), JSON.stringify({
      generated_at: new Date().toISOString(),
      winning_strategy: winningStrategy,
      patterns,
      held_out_eval: evalResult,
    }, null, 2));
    console.log(`Wrote eval -> ${path.join(OUT_DIR, 'champion_eval.json')}`);
  } else {
    console.log('\nNo candidates in data/annotation_tasks.json yet to run held-out eval against.');
    console.log('Run scripts/generate-candidates.mjs first to populate real AI candidates.');
  }
}

main();
