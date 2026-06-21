import { generateAdc, generateQnaAnswer } from './services/description.js';
import { setupSpeechRecognition, speakWithDeepgramOrFallback } from './services/voice.js';
import { loadMemory, saveMemory } from './services/memory.js';
import { selectBestCandidate, scoreCandidate } from './ranker.js';
import { currentMoment, memoryAt } from './services/match-memory.js';
import { resolveContextAt, formatContextSummary } from './services/match-context.js';
import { captureVideoFrameSequence, extractMomentFromFrame, formatVideoTimestamp, resetProbeVideo } from './services/vision-extract.js';

let clips = [];
let annotationTasks = [];
let timeline = [];
let liveTimeline = [];
let liveMode = true;
let currentSeconds = 0;
let pendingBuckets = new Set();
let bucketWaiters = new Map();
let queueRunning = false;
let priorityBucket = null;
let extractTimings = [];
let extractInterval = Number(window.MATCHVISION_EXTRACT_INTERVAL) || 2;
let liveExtractBlocked = false;
let seekTimer = null;
const $ = (id) => document.getElementById(id);

function currentClip() {
  return clips[$('clipSelect').selectedIndex];
}

function currentAnnotationTask() {
  const clip = currentClip();
  return annotationTasks.find((task) => task.clip_id === clip?.clip_id);
}

function getResolvedContext(seconds = currentSeconds) {
  const clip = currentClip();
  if (!clip?.match_context) return null;
  return resolveContextAt(clip.match_context, seconds);
}

function currentMemory() {
  const ctx = getResolvedContext();
  return memoryAt(timeline, currentSeconds, 4, 16, ctx?.match_half ?? null);
}

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

// Local, deterministic fallbacks used when no LLM credentials are configured.
function localMoment() {
  if (!timeline.length) {
    return {
      team_in_possession: 'unknown',
      direction: 'unknown',
      ball_location: 'unknown',
      event: liveMode ? 'Waiting for live frame analysis…' : 'unknown',
      danger_level: 'unknown',
      summary: liveMode ? 'Press play with live extraction enabled.' : ''
    };
  }
  return currentMoment(timeline, currentSeconds);
}
function localAdc(mode) {
  const m = localMoment();
  if (!timeline.length) {
    return liveMode
      ? 'Press play to analyze the video. Match memory builds live from each frame.'
      : 'Enable live vision extraction and press play to build match memory.';
  }
  if (mode === 'brief') {
    const zone = m.ball_zone || m.ball_location;
    return `${m.team_in_possession} in possession. Ball in ${zone}. ${m.phase || m.event}.`;
  }
  return m.summary || `${m.team_in_possession} — ${m.phase || m.event}. ${m.ball_zone || m.ball_location}.`;
}
function localAnswer(question) {
  const q = normalize(question);
  const mode = $('modeSelect')?.value || 'balanced';
  const recap = currentMemory().map((m) => m.summary).filter(Boolean).join(' ');
  if (!recap) {
    return liveMode
      ? 'No match memory yet. Press play and wait for live frame analysis.'
      : 'Enable live vision extraction and press play first.';
  }
  if (q.includes('ball') || q.includes('where')) {
    const m = localMoment();
    const zone = m.ball_zone || m.ball_location;
    return zone && zone !== 'unknown'
      ? `${m.team_in_possession !== 'unknown' ? `${m.team_in_possession} have the ball in ${zone}.` : `The ball is in ${zone}.`}`
      : recap;
  }
  if (q.includes('miss') || q.includes('recent') || q.includes('happen')) return recap;
  if (mode !== 'balanced') return localAdc(mode);
  return recap;
}

function renderLiveJson() {
  const el = $('liveJson');
  if (!el) return;
  if (!liveMode) {
    el.textContent = 'Live extraction off — enable the checkbox above and press play.';
    return;
  }
  el.textContent = JSON.stringify(liveTimeline, null, 2) || 'Waiting for first frame analysis…';
}

function setExtractStatus(msg) {
  const el = $('extractStatus');
  if (el) el.textContent = msg;
}

function bucketSecond(seconds) {
  return Math.floor(seconds / extractInterval) * extractInterval;
}

function priorMemoryForExtract(bucket) {
  const ctx = getResolvedContext(bucket);
  return memoryAt(timeline, Math.max(0, bucket - 0.001), 3, 10, ctx?.match_half ?? null)
    .filter((m) => m.atSecond < bucket);
}

function resolveBucketWaiters(bucket) {
  const waiters = bucketWaiters.get(bucket);
  if (!waiters) return;
  bucketWaiters.delete(bucket);
  waiters.forEach((resolve) => resolve());
}

function waitForBucket(bucket) {
  if (liveTimeline.some((m) => m.atSecond === bucket)) return Promise.resolve();
  return new Promise((resolve) => {
    const arr = bucketWaiters.get(bucket) || [];
    arr.push(resolve);
    bucketWaiters.set(bucket, arr);
  });
}

// Enqueue every 2s bucket from 0..seconds that has not been analyzed yet.
function enqueueBucketsUpTo(seconds) {
  for (let b = 0; b <= seconds; b += extractInterval) {
    if (liveTimeline.some((m) => m.atSecond === b)) continue;
    pendingBuckets.add(b);
  }
}

// Process oldest-first so the timeline fills contiguously every 2s (0, 2, 4, …).
// A one-shot priorityBucket lets a user seek jump the queue for a responsive
// "describe here" without breaking contiguous coverage of normal playback.
function nextPendingBucket() {
  if (priorityBucket != null && pendingBuckets.has(priorityBucket)) {
    const b = priorityBucket;
    priorityBucket = null;
    return b;
  }
  let best = null;
  for (const b of pendingBuckets) {
    if (best == null || b < best) best = b;
  }
  return best;
}

// Analyze a single 2s bucket from the independent probe video (5 lead-up frames).
async function runExtraction(bucket) {
  const ctx = getResolvedContext(bucket);
  const stale = liveTimeline.find((m) => m.atSecond === bucket && ctx && m.match_half != null && m.match_half !== ctx.match_half);
  if (stale) liveTimeline = liveTimeline.filter((m) => m.atSecond !== bucket);
  if (liveTimeline.some((m) => m.atSecond === bucket)) return;

  const video = $('clipVideo');
  if (!video || video.readyState < 2) throw new Error('video not ready');

  setExtractStatus(`Analyzing 5 frames @ ${formatVideoTimestamp(bucket)}…`);
  const priorMoments = priorMemoryForExtract(bucket);

  const t0 = performance.now();
  const frames = await captureVideoFrameSequence(video, bucket);
  if (!frames.length) throw new Error('could not capture frames');
  const tFrames = performance.now();

  const moment = await extractMomentFromFrame({
    frames,
    atSecond: bucket,
    priorMoments,
    matchContext: ctx,
    matchContextRaw: currentClip()?.match_context
  });
  const tApi = performance.now();

  const captureMs = Math.round(tFrames - t0);
  const apiMs = Math.round(tApi - tFrames);
  const totalMs = Math.round(tApi - t0);
  extractTimings.push({ bucket, captureMs, apiMs, totalMs });
  const avg = (key) => Math.round(extractTimings.reduce((s, t) => s + t[key], 0) / extractTimings.length);
  console.log(
    `[extract @ ${formatVideoTimestamp(bucket)}] capture=${captureMs}ms api=${apiMs}ms total=${totalMs}ms ` +
    `| avg over ${extractTimings.length}: capture=${avg('captureMs')}ms api=${avg('apiMs')}ms total=${avg('totalMs')}ms`
  );

  moment.timestamp = formatVideoTimestamp(bucket);
  liveTimeline.push(moment);
  liveTimeline.sort((a, b) => a.atSecond - b.atSecond);
  timeline = liveTimeline;
  setExtractStatus(
    `Live: ${liveTimeline.length} moment(s) — last ${(totalMs / 1000).toFixed(1)}s ` +
    `(api ${(apiMs / 1000).toFixed(1)}s), avg ${(avg('totalMs') / 1000).toFixed(1)}s`
  );
  renderMoment();
  renderMemory();
  renderLiveJson();
}

// Single sequential worker: drains pending buckets one at a time, guaranteeing
// every 2s bucket is analyzed even when a call takes longer than the interval.
async function drainQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (liveMode && !liveExtractBlocked && pendingBuckets.size) {
      const bucket = nextPendingBucket();
      if (bucket == null) break;
      pendingBuckets.delete(bucket);
      try {
        await runExtraction(bucket);
      } catch (error) {
        if (error.message === 'INVALID_API_KEY') {
          liveExtractBlocked = true;
          setExtractStatus('DashScope API key rejected. Update DASHSCOPE_API_KEY in .env, restart ./run.sh, then reload.');
          if ($('liveJson')) $('liveJson').textContent = 'API key invalid — live extraction paused.\n\nFix: get a new key from Alibaba Model Studio → paste in .env → restart server.';
        } else if (error.message === 'MODEL_NOT_FOUND') {
          liveExtractBlocked = true;
          setExtractStatus('Vision model not found on US endpoint. Set QWEN_VL_MODEL=qwen3-vl-plus in .env and restart server.');
        } else {
          console.warn('Live extraction failed', error);
          setExtractStatus(`Extraction failed @ ${formatVideoTimestamp(bucket)} — ${error.message}`);
        }
      } finally {
        resolveBucketWaiters(bucket);
      }
    }
  } finally {
    queueRunning = false;
  }
}

function scheduleExtraction(seconds) {
  if (!liveMode || liveExtractBlocked) return;
  enqueueBucketsUpTo(seconds);
  drainQueue();
}

function renderMatchContext() {
  const el = $('matchContext');
  if (!el) return;
  const ctx = getResolvedContext();
  el.textContent = ctx ? formatContextSummary(ctx) : 'No match context configured for this clip.';
}

function renderMoment() {
  const m = localMoment();
  $('matchState').innerHTML = `
    <dl>
      <dt>Possession</dt><dd>${m.team_in_possession || 'unknown'}</dd>
      <dt>Phase</dt><dd>${m.phase || 'unknown'}</dd>
      <dt>Ball zone</dt><dd>${m.ball_zone || m.ball_location || 'unknown'}</dd>
      <dt>Direction</dt><dd>${m.direction || 'unknown'}</dd>
      <dt>Visual event</dt><dd>${m.event || 'unknown'}</dd>
      <dt>Danger</dt><dd>${m.danger_level || 'unknown'}</dd>
    </dl>`;
  renderMatchContext();
}

function renderMemory() {
  const entries = currentMemory();
  $('memoryList').innerHTML = entries.length
    ? entries.map((m) => `<li><strong>${m.timestamp || ''}</strong> ${m.summary || m.event || ''}</li>`).join('')
    : `<li>${liveMode ? 'Waiting for live frame analysis…' : 'No match memory yet.'}</li>`;
}

function renderRanker() {
  const task = currentAnnotationTask();
  if (!task) {
    $('baseline').textContent = '—';
    $('improved').textContent = 'No Terac labels for this clip yet.';
    if ($('rankerDetails')) $('rankerDetails').innerHTML = '';
    return;
  }
  const selected = selectBestCandidate(task.candidates);
  $('baseline').textContent = task.baseline;
  $('improved').textContent = selected.description;
  const ranker = $('rankerDetails');
  if (ranker) {
    ranker.innerHTML = task.candidates
      .map((c) => `<div class="metric"><span>${c.label || c.id}</span><strong>${scoreCandidate(c).toFixed(1)}</strong></div>`)
      .join('');
  }
}

function encodeVideoPath(assetPath) {
  return assetPath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function renderClip() {
  const clip = currentClip();
  liveTimeline = [];
  pendingBuckets.clear();
  bucketWaiters.clear();
  priorityBucket = null;
  extractTimings = [];
  liveExtractBlocked = false;
  timeline = [];
  currentSeconds = 0;
  resetProbeVideo();
  if ($('clipVideo')) {
    $('clipVideo').src = clip.video_asset ? encodeVideoPath(clip.video_asset) : '';
    $('clipVideo').style.display = clip.video_asset ? 'block' : 'none';
  }
  if ($('clipVisual')) {
    $('clipVisual').style.display = 'none';
  }
  renderMoment();
  renderRanker();
  renderMemory();
  renderLiveJson();
  renderMatchContext();
  setExtractStatus(liveMode ? 'Live extraction on — press play to analyze frames' : 'Live extraction off — enable above and press play');
  $('answer').textContent = localAdc($('modeSelect')?.value || 'balanced');
}

function onTimeUpdate() {
  const video = $('clipVideo');
  if (!video) return;
  const seconds = Math.floor(video.currentTime);
  if (seconds === currentSeconds) return;
  currentSeconds = seconds;
  renderMoment();
  renderMemory();
  scheduleExtraction(seconds);
}

function onSeeked() {
  const video = $('clipVideo');
  if (!video) return;
  currentSeconds = Math.floor(video.currentTime);
  renderMoment();
  renderMemory();
  clearTimeout(seekTimer);
  seekTimer = setTimeout(async () => {
    if (liveMode && !liveExtractBlocked) {
      const bucket = bucketSecond(currentSeconds);
      enqueueBucketsUpTo(currentSeconds);
      priorityBucket = bucket;
      drainQueue();
      await waitForBucket(bucket);
    }
    await describeNow();
  }, 250);
}

async function ask() {
  const clip = currentClip();
  const question = $('questionInput').value;
  const mode = $('modeSelect')?.value || 'balanced';
  $('answer').textContent = 'Thinking…';
  const memoryEntries = currentMemory();
  const matchContext = getResolvedContext();
  $('answer').textContent = await generateQnaAnswer({
    question,
    memoryEntries,
    matchContext,
    mode,
    fallback: () => localAnswer(question)
  });
  await saveMemory({ clip: clip.title, question, mode, ts: Date.now() });
}

async function describeNow() {
  const mode = $('modeSelect')?.value || 'balanced';
  $('answer').textContent = 'Describing…';
  $('answer').textContent = await generateAdc({
    memoryEntries: currentMemory(),
    matchContext: getResolvedContext(),
    mode,
    fallback: () => localAdc(mode)
  });
  speak();
}

function speak() {
  speakWithDeepgramOrFallback($('answer').textContent);
}

function setupVoiceInput() {
  setupSpeechRecognition({
    button: $('voiceBtn'),
    onTranscript: async (transcript) => {
      $('questionInput').value = transcript;
      await ask();
      speak();
    }
  });
}

async function init() {
  [clips, annotationTasks] = await Promise.all([
    fetch('data/clips.json').then((r) => r.json()),
    fetch('data/annotation_tasks.json').then((r) => r.json())
  ]);
  const select = $('clipSelect');
  clips.forEach((clip) => {
    const option = document.createElement('option');
    option.value = clip.clip_id;
    option.textContent = clip.title;
    select.appendChild(option);
  });
  if ($('liveExtractToggle')) $('liveExtractToggle').checked = liveMode;
  select.addEventListener('change', renderClip);
  $('modeSelect')?.addEventListener('change', () => {
    $('answer').textContent = localAdc($('modeSelect').value);
  });
  $('askBtn').addEventListener('click', ask);
  $('speakBtn').addEventListener('click', speak);
  $('describeBtn')?.addEventListener('click', describeNow);
  $('liveExtractToggle')?.addEventListener('change', (event) => {
    liveMode = event.target.checked;
    renderClip();
  });
  $('clipVideo')?.addEventListener('timeupdate', onTimeUpdate);
  $('clipVideo')?.addEventListener('seeked', onSeeked);
  $('questionInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') ask();
  });
  setupVoiceInput();
  renderClip();
}

init().catch((error) => {
  console.error(error);
  $('answer').textContent = 'Failed to load demo data.';
});
