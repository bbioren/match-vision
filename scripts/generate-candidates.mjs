#!/usr/bin/env node
/**
 * generate-candidates.mjs
 *
 * For each clip in annotation_tasks.json:
 *   1. Extract 4 frames from the video with ffmpeg
 *   2. Send frames to Claude vision to auto-generate clip_summary
 *   3. Call Claude 5× with different prompt strategies to generate
 *      real AI commentary candidates
 *   4. Write results back to annotation_tasks.json
 *
 * Usage:
 *   node --env-file=.env.local scripts/generate-candidates.mjs
 *   node --env-file=.env.local scripts/generate-candidates.mjs --clip yt_eng_cro_12
 *   node --env-file=.env.local scripts/generate-candidates.mjs --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MODEL = 'claude-opus-4-5';
const DRY_RUN = process.argv.includes('--dry-run');
const clipFlagIdx = process.argv.indexOf('--clip');
const ONLY_CLIP = clipFlagIdx !== -1 ? process.argv[clipFlagIdx + 1] : null;

if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY required');
  process.exit(1);
}

// ── Claude API call ──────────────────────────────────────────────────────────
async function claude(system, userContent) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      system,
      messages: [{ role: 'user', content: userContent }],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content[0].text.trim();
}

// ── Extract frames from video ─────────────────────────────────────────────────
function extractFrames(videoPath, count = 4) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'matchvision-'));
  const pattern = path.join(dir, 'frame%d.jpg');
  // Spread frames evenly across the clip
  execSync(
    `ffmpeg -i "${videoPath}" -vf "fps=1/2.5" -vframes ${count} -q:v 4 "${pattern}" -y 2>/dev/null`,
    { stdio: 'pipe' }
  );
  const frames = fs.readdirSync(dir)
    .filter(f => f.endsWith('.jpg'))
    .sort()
    .map(f => path.join(dir, f));
  return { frames, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

// ── Build vision content blocks ───────────────────────────────────────────────
function framesToContent(frames, text) {
  const imageBlocks = frames.map(f => ({
    type: 'image',
    source: {
      type: 'base64',
      media_type: 'image/jpeg',
      data: fs.readFileSync(f).toString('base64'),
    },
  }));
  return [...imageBlocks, { type: 'text', text }];
}

// ── Step 1: Auto-generate clip_summary from frames ───────────────────────────
async function generateClipSummary(frames) {
  const system = `You are a soccer broadcast analyst. Given video frames from a 10-second soccer clip, 
write a single concise paragraph (2-3 sentences) describing exactly what is happening visually: 
which team has the ball, where the ball is on the pitch, what action is occurring, and the key moment 
or decision point. Be factual and specific. Do not editorialize.`;

  const content = framesToContent(frames,
    'These are 4 evenly-spaced frames from a 10-second soccer clip. Describe what is happening.'
  );

  return claude(system, content);
}

// ── Step 2: Generate 5 commentary candidates ─────────────────────────────────
const STRATEGIES = [
  {
    id: 'a',
    label: 'Spatial',
    system: `You are an audio description specialist for blind and low-vision soccer fans.
Write ONE sentence of live commentary that prioritizes exact spatial information: 
where the ball is, which direction play is moving, and where key players are positioned.
Be specific about field zones (e.g. "right edge of the penalty area", "six yards from goal").
No more than 30 words.`,
  },
  {
    id: 'b',
    label: 'Tactical',
    system: `You are a tactically-minded soccer commentator writing for blind fans.
Write ONE sentence that explains the tactical situation: team shape, pressure, space available, 
and what the key decision or danger is. Help the listener understand WHY this moment matters.
No more than 35 words.`,
  },
  {
    id: 'c',
    label: 'Concise live',
    system: `You are a live radio commentator writing a single punchy line for blind and low-vision fans.
Write ONE short, natural-sounding sentence (under 20 words) capturing the essential action right now.
It should sound like something said on air mid-play.`,
  },
  {
    id: 'd',
    label: 'Narrative',
    system: `You are writing audio description for a blind soccer fan who wants to feel the moment.
Write ONE sentence (25-35 words) that combines spatial fact with the emotional weight of the moment.
Name the key player if clearly identifiable. Make the listener feel present.`,
  },
  {
    id: 'e',
    label: 'Baseline',
    system: `Describe what is happening in this soccer clip in one plain sentence. 
Be brief and generic. Under 15 words.`,
  },
];

async function generateCandidates(clipSummary, frames, manualSummary = false) {
  // If summary was manually written, use text-only to avoid frames overriding it
  const userPrompt = manualSummary
    ? `Soccer clip context: ${clipSummary}\n\nWrite your commentary based on the context above.`
    : framesToContent(frames,
        `Soccer clip context: ${clipSummary}\n\nWrite your commentary based on the frames and context above.`
      );

  const results = [];
  for (const strategy of STRATEGIES) {
    process.stdout.write(`    [${strategy.id}] ${strategy.label}... `);
    try {
      const text = await claude(strategy.system, userPrompt);
      results.push({ id: strategy.id, label: strategy.label, text });
      console.log('✓');
    } catch (err) {
      console.log(`✗ ${err.message}`);
      results.push({ id: strategy.id, label: strategy.label, text: `[generation failed: ${err.message}]` });
    }
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }
  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function run() {
  const tasksPath = 'data/annotation_tasks.json';
  const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));

  const toProcess = ONLY_CLIP
    ? tasks.filter(t => t.task_id === ONLY_CLIP || t.clip_id === ONLY_CLIP)
    : tasks.filter(t => t.video_src); // only tasks with video

  if (!toProcess.length) {
    console.error(`No tasks found${ONLY_CLIP ? ` for clip "${ONLY_CLIP}"` : ' with video_src'}`);
    process.exit(1);
  }

  console.log(`\nGenerating candidates for ${toProcess.length} clip(s)...\n`);

  let updated = 0;
  for (const task of toProcess) {
    console.log(`\n── ${task.task_id} (${task.clip_id})`);

    if (!task.video_src || !fs.existsSync(task.video_src)) {
      console.log(`  ⚠ Video not found: ${task.video_src} — skipping`);
      continue;
    }

    if (DRY_RUN) {
      console.log('  [dry-run] would extract frames and call Claude');
      continue;
    }

    // Extract frames
    process.stdout.write('  Extracting frames... ');
    const { frames, cleanup } = extractFrames(task.video_src);
    console.log(`${frames.length} frames`);

    try {
      // Auto-generate clip_summary from vision, unless manually overridden
      let clipSummary;
      if (task.clip_summary_source === 'manual') {
        clipSummary = task.clip_summary;
        console.log('  Using manual clip_summary (skipping vision)');
        console.log(`  → "${clipSummary.slice(0, 80)}..."`);
      } else {
        process.stdout.write('  Generating clip_summary... ');
        clipSummary = await generateClipSummary(frames);
        console.log('✓');
        console.log(`  → "${clipSummary.slice(0, 80)}..."`);
      }

      // Generate 5 candidates
      console.log('  Generating commentary candidates:');
      const isManual = task.clip_summary_source === 'manual';
      const candidates = await generateCandidates(clipSummary, frames, isManual);

      // Update task in place
      const taskInFull = tasks.find(t => t.task_id === task.task_id);
      taskInFull.clip_summary = clipSummary;
      taskInFull.commentary_variations = candidates;
      taskInFull.candidates = candidates.map(c => ({
        id: c.id,
        label: c.label,
        description: c.text,
      }));
      taskInFull.generated_at = new Date().toISOString();
      taskInFull.generation_model = MODEL;

      updated++;
    } finally {
      cleanup();
    }
  }

  if (!DRY_RUN && updated > 0) {
    fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2));
    console.log(`\n✅ Updated ${updated} task(s) in ${tasksPath}`);
  }

  console.log('\nDone.');
}

run().catch(err => { console.error(err); process.exit(1); });
