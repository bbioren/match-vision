#!/usr/bin/env node
/**
 * terac-agent.mjs
 *
 * Runs the full MatchVision expert commentary loop via Terac MCP:
 *   1. terac_get_context   – verify balance
 *   2. terac_create_project (if needed)
 *   3. terac_create_opportunity – draft with task URL + quote
 *   4. terac_launch_draft_opportunity – go live
 *   5. Poll terac_get_submissions until fulfilled
 *   6. terac_approve_submission for each verified completion
 *
 * Usage:
 *   TERAC_API_KEY=tk_... node scripts/terac-agent.mjs [--dry-run]
 *
 * Budget guardrail: will not launch if estimated cost > MAX_SPEND_USD.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TERAC_API_KEY = process.env.TERAC_API_KEY;
const VERCEL_URL = process.env.VERCEL_URL ?? 'https://match-vision-q5a791kob-jstnzhous-projects.vercel.app';
const DRY_RUN = process.argv.includes('--dry-run');
const MAX_SPEND_USD = 160;
const NUM_PARTICIPANTS = Number(process.env.TERAC_NUM_PARTICIPANTS || 3);

// Which task to launch: "commentary" (default) or "gaze_survey" (eye-tracking).
// Select with TERAC_TASK=gaze_survey or the --survey flag.
const TASK_KIND = (process.env.TERAC_TASK ?? (process.argv.includes('--survey') ? 'gaze_survey' : 'commentary')).toLowerCase();

const COMMENTARY_BRIEF = `MatchVision is collecting high-quality soccer audio-description commentary for blind and low-vision fans.

You'll watch 10-second clips from England vs Croatia (FIFA World Cup 2026, first 9 minutes) and write voice-ready commentary. The commentary should be enthusiastic, natural, and useful, while staying factual.

Quality requirements:
- Write 2-4 concise sentences per clip.
- Prioritize the visual layer missing from normal broadcast commentary: ball location, direction of play, player spacing, pressure, danger, and why the moment matters.
- If player names are unknown, use shirt numbers when visible; otherwise use positions/roles such as goalkeeper, left back, right winger, nearest defender, player in white, or player in blue.
- Do not invent outcomes after the clip ends. If the clip ends before a shot, pass, foul call, or goal is resolved, say so.
- Make it engaging enough for a fan, not a dry object label. This will be used downstream in voice AI for blind/low-vision soccer accessibility.

The task page includes two expert examples (penalty setup + corner kick scramble), followed by 52 clips that need your commentary. Full context guide available in the task interface.`;

const SURVEY_BRIEF = `MatchVision is running a short eye-tracking study. We want to learn where soccer fans naturally look while watching a match, so we can automatically zoom and pan the video to the right spot for blind and low-vision fans who rely on screen magnification.

What you'll do (about 6-8 minutes):
- Open the task link on a laptop or desktop with a webcam and allow camera access.
- Complete a quick 9-dot calibration (look at each dot, then press Space).
- Watch 5 short soccer clips (about 40 seconds each). Just watch the game naturally — there is nothing to type or write.

Requirements:
- Use a laptop or desktop with a working webcam, in a reasonably well-lit room. Phones and tablets are NOT supported.
- Sit roughly an arm's length from the screen and keep your head fairly still.
- Allow camera access when your browser prompts you.

Privacy: All face processing happens in your browser via WebGazer. We only record anonymous gaze coordinates (where on each clip you looked) and timing — never any image or video of you.`;

const TASK_CONFIGS = {
  commentary: {
    projectName: 'MatchVision BVI Soccer Commentary',
    page: '/annotate.html',
    title: 'Write soccer audio-description commentary for blind fans',
    brief: COMMENTARY_BRIEF,
    defaultDuration: 25,
    screeningQuestions: [
      {
        key: 'soccer',
        text: 'How familiar are you with soccer (football)?',
        pick: 'one',
        answers: [
          { text: 'I watch it occasionally', qualify_logic: 'may' },
          { text: 'I watch it regularly', qualify_logic: 'may' },
          { text: 'I follow it closely', qualify_logic: 'may' },
          { text: 'I have coached, played competitively, commentated, or analyzed soccer', qualify_logic: 'may' },
        ],
      },
      {
        key: 'writing',
        text: 'Can you write vivid, factual English commentary suitable for blind or low-vision sports fans?',
        pick: 'one',
        answers: [
          { text: 'Yes', qualify_logic: 'may' },
          { text: 'No', qualify_logic: 'reject' },
        ],
      },
    ],
  },
  gaze_survey: {
    projectName: 'MatchVision Eye-Tracking Survey',
    page: '/survey.html',
    title: 'Eye-tracking study: watch 5 short soccer clips (webcam required)',
    brief: SURVEY_BRIEF,
    defaultDuration: 10,
    // Eye tracking needs a real screen + webcam, so hard-restrict to desktop and
    // screen out anyone unwilling to enable their camera.
    deviceTypes: ['desktop'],
    screeningQuestions: [
      {
        key: 'webcam',
        text: 'This task uses your webcam for in-browser eye tracking. No image or video of you is recorded or uploaded — only gaze coordinates (where you look on the screen). Are you willing to enable your webcam for the task?',
        pick: 'one',
        answers: [
          { text: 'Yes, I have a working webcam and will enable it', qualify_logic: 'may' },
          { text: 'No', qualify_logic: 'reject' },
        ],
      },
      {
        key: 'soccer',
        text: 'How often do you watch soccer (football)?',
        pick: 'one',
        answers: [
          { text: 'Rarely or never', qualify_logic: 'may' },
          { text: 'Occasionally', qualify_logic: 'may' },
          { text: 'Regularly', qualify_logic: 'may' },
          { text: 'I follow it closely or have played/coached/analyzed it', qualify_logic: 'may' },
        ],
      },
    ],
  },
};

const CFG = TASK_CONFIGS[TASK_KIND] ?? TASK_CONFIGS.commentary;
// Use only the origin of VERCEL_URL so a pasted full URL (e.g. ending in
// /survey.html) doesn't double up when we append the task page path.
function originOf(u) {
  try { return new URL(u).origin; } catch { return String(u).replace(/\/+$/, ''); }
}
const TASK_URL = `${originOf(VERCEL_URL)}${CFG.page}`;
const TASK_BRIEF = CFG.brief;
const TASK_DURATION_MINUTES = Number(process.env.TERAC_TASK_DURATION_MINUTES || CFG.defaultDuration);

if (!TERAC_API_KEY) {
  console.error('TERAC_API_KEY is required. Set it in .env.local or environment.');
  process.exit(1);
}

async function terac(toolName, args = {}) {
  const res = await fetch('https://terac.com/api/mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'x-api-key': TERAC_API_KEY,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });

  const text = await res.text();
  const match = text.match(/^data:\s*(.+)$/m);
  if (!match) throw new Error(`No SSE data from Terac for ${toolName}: ${text}`);
  const json = JSON.parse(match[1]);
  if (json.error) throw new Error(`Terac error (${toolName}): ${JSON.stringify(json.error)}`);
  const content = json.result?.content?.[0]?.text;
  try { return JSON.parse(content); } catch { return content; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
  console.log(`\n${'─'.repeat(60)}`);
  console.log('MatchVision × Terac Annotation Agent');
  console.log(`Task: ${TASK_KIND}`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no money spent)' : 'LIVE'}`);
  console.log(`Task URL: ${TASK_URL}`);
  console.log('─'.repeat(60));

  // ── Step 1: Get context ────────────────────────────────────────────────────
  console.log('\n[1/6] Checking Terac org context...');
  const ctx = await terac('terac_get_context');
  console.log(typeof ctx === 'string' ? ctx : JSON.stringify(ctx, null, 2));

  // ── Step 2: Create / find project ─────────────────────────────────────────
  console.log('\n[2/6] Creating project...');
  let projectId;
  try {
    const project = await terac('terac_create_project', {
      name: CFG.projectName,
    });
    projectId = project?.id ?? project?.project_id;
    console.log(`Project created: ${projectId}`);
  } catch (err) {
    console.warn('Project creation failed (may already exist):', err.message);
  }

  // ── Step 3: Draft opportunity ──────────────────────────────────────────────
  console.log('\n[3/6] Creating draft opportunity...');
  if (!projectId) {
    console.error('\n⛔ No project id available; cannot create opportunity (project_id is required). Aborting.');
    process.exit(1);
  }
  const draft = await terac('terac_create_opportunity', {
    title: CFG.title,
    project_id: projectId,
    num_participants: NUM_PARTICIPANTS,
    business_type: 'b2c',
    tasks: [{
      sequence: 1,
      task_type: 'activity',
      review_type: 'self_report',
      task_url: TASK_URL,
      duration_minutes: TASK_DURATION_MINUTES,
      instructions: TASK_BRIEF,
    }],
    screening_questions: CFG.screeningQuestions,
    ...(CFG.deviceTypes ? { device_types: CFG.deviceTypes } : {}),
  });

  const draftId = draft?.id ?? draft?.opportunity_id;
  const priceCents = draft?.pricing?.cost_per_participant_cents ?? draft?.cost_per_participant_cents;
  const totalCents = priceCents ? priceCents * NUM_PARTICIPANTS : null;
  const totalUSD = totalCents ? totalCents / 100 : null;

  console.log(`Draft ID: ${draftId}`);
  if (totalUSD !== null) {
    console.log(`Estimated cost: $${totalUSD.toFixed(2)} ($${(priceCents/100).toFixed(2)} × ${NUM_PARTICIPANTS} participants)`);
  } else {
    console.log('Pricing:', JSON.stringify(draft?.pricing ?? draft, null, 2));
  }

  // ── Budget guardrail ───────────────────────────────────────────────────────
  if (totalUSD !== null && totalUSD > MAX_SPEND_USD) {
    console.error(`\n⛔ Estimated cost $${totalUSD.toFixed(2)} exceeds guardrail $${MAX_SPEND_USD}. Aborting.`);
    console.error('Reduce NUM_PARTICIPANTS or TASK_DURATION_MINUTES and retry.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n✅ Dry run complete. Draft created but NOT launched. Run without --dry-run to go live.');
    process.exit(0);
  }

  // ── Step 4: Launch ─────────────────────────────────────────────────────────
  console.log('\n[4/6] Launching opportunity (this spends credits)...');
  const launch = await terac('terac_launch_draft_opportunity', { opportunityId: draftId });
  console.log('Launch result:', JSON.stringify(launch, null, 2));

  // ── Step 5: Poll for submissions ───────────────────────────────────────────
  console.log('\n[5/6] Polling for submissions (checks every 5 min)...');
  let fulfilled = false;
  let attempts = 0;
  const maxAttempts = 72; // up to 6 hours

  while (!fulfilled && attempts < maxAttempts) {
    attempts++;
    await sleep(5 * 60 * 1000);

    const opp = await terac('terac_get_opportunity', { opportunityId: draftId });
    const status = opp?.status ?? opp?.lifecycle_status;
    const submissions = await terac('terac_get_submissions', { opportunityId: draftId });
    const completed = Array.isArray(submissions)
      ? submissions.filter(s => s.status === 'APPROVED' || s.status === 'COMPLETED')
      : [];

    console.log(`[poll ${attempts}] Status: ${status} | Completed: ${completed.length}/${NUM_PARTICIPANTS}`);

    if (status === 'FULFILLED' || status === 'COMPLETED') {
      fulfilled = true;
      console.log('\n✅ Opportunity fulfilled!');

      // ── Step 6: Approve submissions ────────────────────────────────────────
      console.log('\n[6/6] Approving verified submissions...');
      const pending = Array.isArray(submissions)
        ? submissions.filter(s => s.status === 'PENDING' || s.status === 'SUBMITTED')
        : [];

      for (const sub of pending) {
        try {
          await terac('terac_approve_submission', { submissionId: sub.id });
          console.log(`  Approved: ${sub.id}`);
        } catch (err) {
          console.warn(`  Could not approve ${sub.id}:`, err.message);
        }
      }
    }
  }

  if (!fulfilled) {
    console.log('\n⚠ Max poll attempts reached. Check Terac dashboard for final status.');
    console.log(`  Opportunity ID: ${draftId}`);
  }

  if (TASK_KIND === 'gaze_survey') {
    const tokenHint = process.env.GAZE_ADMIN_TOKEN ? `?token=${process.env.GAZE_ADMIN_TOKEN}` : '?token=YOUR_GAZE_ADMIN_TOKEN';
    console.log('\nDone. View collected gaze heatmaps at ' + `${originOf(VERCEL_URL)}/gaze-results.html${tokenHint}` + ' (reading requires GAZE_ADMIN_TOKEN; raw JSON at /api/gaze?full=1&token=...).');
  } else {
    console.log('\nDone. Run scripts/build-preference-dataset.mjs to process collected labels.');
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
