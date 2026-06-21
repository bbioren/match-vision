import { generateAdc, generateQnaAnswer } from './services/description.js';
import { setupWakeWordListening, speakWithDeepgramOrFallback, stopSpeaking } from './services/voice.js';
import { saveMemory } from './services/memory.js';
import { currentMoment, memoryAt } from './services/match-memory.js';
import { resolveContextAt, formatContextSummary } from './services/match-context.js';
import { captureVideoFrameSequence, extractMomentFromFrame, formatVideoTimestamp, resetProbeVideo } from './services/vision-extract.js';

let clips = [];
let timeline = [];
let liveTimeline = [];
let liveMode = true;
// True for clips loaded from a precomputed ground-truth timeline_asset
// (e.g. StatsBomb/socceraction analytics replay) instead of live video +
// VLM extraction. Disables the live-extraction toggle/video element for
// that clip without touching the live-vision path used by video clips.
let isAnalyticsReplay = false;
let currentSeconds = 0;
let pendingBuckets = new Set();
let bucketWaiters = new Map();
let queueRunning = false;
let priorityBucket = null;
let extractTimings = [];
let extractInterval = Number(window.MATCHVISION_EXTRACT_INTERVAL) || 2;
let liveExtractBlocked = false;
let seekTimer = null;
// Live caption + auto-speak: track the last moment captioned/spoken so we
// don't re-caption an unchanged moment on every timeupdate tick, and don't
// re-speak a key moment the user has already heard (e.g. re-seeking nearby).
let lastCaptionKey = null;
let lastSpokenKey = null;
let lastSpokenAtSecond = -Infinity;
// Generated commentary lines take a few seconds to speak even when short;
// without a minimum gap, moments arriving faster than that would constantly
// interrupt each other before finishing. Key moments (goals/danger) always
// cut through immediately regardless of this gap.
const MIN_CAPTION_GAP_SECONDS = 3;
// True while a wake-word question is being answered — the live ticker keeps
// updating captions visually but stays silent so it doesn't talk over the
// answer, then resumes once the spoken answer finishes.
let commentaryMuted = false;
// The most recent ADC/Q&A answer text — there's no visible answer panel
// (voice is the primary interface), so this is just internal state for
// speak()'s default argument and for re-speaking after a clip/mode change.
let lastAnswerText = '';
const $ = (id) => document.getElementById(id);

function momentKey(m) {
  return `${m?.atSecond ?? ''}|${m?.event || m?.summary || ''}`;
}

// "Key" moments (goals, high-danger plays) get spoken aloud automatically as
// the video plays; everything else only updates the visible caption text —
// speaking every single pass/touch nonstop would be unusable, not helpful.
function isKeyMoment(m) {
  if (!m) return false;
  const danger = (m.danger_level || m.urgency_level || '').toLowerCase();
  return danger === 'high' || /goal/i.test(m.event || '');
}

function renderCaption(m) {
  const el = $('liveCaption');
  if (!el) return;
  const text = m?.commentary || m?.summary || m?.event;
  if (!text) {
    el.classList.remove('visible', 'key-moment');
    return;
  }
  const key = momentKey(m);
  if (key === lastCaptionKey) return;

  const isKey = isKeyMoment(m);
  const gapElapsed = (m.atSecond ?? 0) - lastSpokenAtSecond >= MIN_CAPTION_GAP_SECONDS;
  if (!isKey && !gapElapsed) return; // too soon after the last caption — let it finish, skip this one

  lastCaptionKey = key;
  el.textContent = text;
  el.classList.add('visible');
  el.classList.toggle('key-moment', isKey);
  // Speak every caption that makes it through the gap above — interrupt-
  // replace (newest wins) is handled inside speakWithDeepgramOrFallback/
  // speechSynthesis, so back-to-back moments cut cleanly into each other.
  // While a voice question is being answered, keep updating the caption
  // text but stay silent so the ticker doesn't talk over the answer.
  if (key !== lastSpokenKey) {
    lastSpokenKey = key;
    lastSpokenAtSecond = m.atSecond ?? lastSpokenAtSecond;
    if (!commentaryMuted) speakWithDeepgramOrFallback(text, { shouldSpeak: () => !commentaryMuted });
  }
}

function currentClip() {
  return clips[$('clipSelect').selectedIndex];
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
  return m.commentary || m.summary || `${m.team_in_possession} — ${m.phase || m.event}. ${m.ball_zone || m.ball_location}.`;
}
function localAnswer(question) {
  const q = normalize(question);
  const recap = currentMemory().map((m) => m.commentary || m.summary).filter(Boolean).join(' ');
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
  return recap;
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
  if (isAnalyticsReplay || !liveMode || liveExtractBlocked) return;
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
  renderCaption(m);
  renderMatchContext();
}

function renderMemory() {
  const entries = currentMemory();
  $('memoryList').innerHTML = entries.length
    ? entries.map((m) => `<li><strong>${m.timestamp || ''}</strong> ${m.commentary || m.summary || m.event || ''}</li>`).join('')
    : `<li>${liveMode ? 'Waiting for live frame analysis…' : 'No match memory yet.'}</li>`;
}

function encodeVideoPath(assetPath) {
  return assetPath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function renderClip() {
  const clip = currentClip();
  liveTimeline = [];
  pendingBuckets.clear();
  bucketWaiters.clear();
  priorityBucket = null;
  extractTimings = [];
  liveExtractBlocked = false;
  timeline = [];
  currentSeconds = 0;
  lastCaptionKey = null;
  lastSpokenKey = null;
  lastSpokenAtSecond = -Infinity;
  isAnalyticsReplay = Boolean(clip?.timeline_asset);
  resetProbeVideo();

  if ($('liveExtractToggle')) {
    $('liveExtractToggle').disabled = isAnalyticsReplay;
    $('liveExtractToggle').checked = isAnalyticsReplay ? false : liveMode;
  }

  if (isAnalyticsReplay) {
    // Ground-truth analytics replay (e.g. StatsBomb/socceraction) — no VLM
    // extraction. Load the precomputed moment timeline directly and reuse
    // the existing live-vision rendering path. If the clip ALSO has a
    // video_asset (a real match replay synced to this timeline), play it —
    // onTimeUpdate/onSeeked drive currentSeconds from video time via
    // videoToMatchSeconds() instead of doing live frame extraction.
    if ($('clipVideo')) {
      $('clipVideo').src = clip.video_asset ? encodeVideoPath(clip.video_asset) : '';
      $('clipVideo').style.display = clip.video_asset ? 'block' : 'none';
    }
    if ($('clipVisual')) $('clipVisual').style.display = 'none';
    try {
      const res = await fetch(clip.timeline_asset);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      timeline = await res.json();
    } catch (error) {
      console.warn('Failed to load timeline_asset', clip.timeline_asset, error);
      timeline = [];
    }
    liveTimeline = timeline;
    setExtractStatus(clip.video_asset
      ? `Analytics replay — ${timeline.length} ground-truth moment(s), synced to real video (no live VLM extraction).`
      : `Analytics replay — ${timeline.length} ground-truth moment(s) loaded (no live video or VLM extraction for this clip).`);
  } else {
    if ($('clipVideo')) {
      $('clipVideo').src = clip.video_asset ? encodeVideoPath(clip.video_asset) : '';
      $('clipVideo').style.display = clip.video_asset ? 'block' : 'none';
    }
    if ($('clipVisual')) {
      $('clipVisual').style.display = 'none';
    }
    setExtractStatus(liveMode ? 'Live extraction on — press play to analyze frames' : 'Live extraction off — enable above and press play');
  }

  renderMoment();
  renderMemory();
  renderMatchContext();
  lastAnswerText = localAdc('balanced');
}

// For clips that pair real video with a precomputed timeline_asset (e.g. a
// full match replay synced to ground-truth analytics), the timeline's
// atSecond is real match-clock time, but the video itself has dead time
// (pre-match buildup, halftime coverage, mid-match production cutaways) that
// inflates video runtime without advancing the match clock — so a single
// constant offset only holds within one contiguous broadcast segment, not
// across the whole match. video_sync_anchors is a list of [videoSeconds,
// matchSeconds] pairs (read directly off the broadcast's own clock overlay
// at each videoSeconds) that we piecewise-linearly interpolate/extrapolate
// between. video_offset_seconds (a single constant) is still supported as a
// simpler fallback for clips with no mid-match dead time.
function videoToMatchSeconds(videoSeconds) {
  const anchors = currentClip()?.video_sync_anchors;
  if (!anchors?.length) {
    const offset = currentClip()?.video_offset_seconds || 0;
    return Math.max(0, Math.floor(videoSeconds - offset));
  }
  if (videoSeconds <= anchors[0][0]) {
    return Math.max(0, Math.floor(anchors[0][1] - (anchors[0][0] - videoSeconds)));
  }
  for (let i = 0; i < anchors.length - 1; i += 1) {
    const [v0, m0] = anchors[i];
    const [v1, m1] = anchors[i + 1];
    if (videoSeconds <= v1) {
      const t = (videoSeconds - v0) / (v1 - v0);
      return Math.max(0, Math.floor(m0 + t * (m1 - m0)));
    }
  }
  // Past the last anchor: extrapolate using the final segment's slope.
  const [v0, m0] = anchors[anchors.length - 2];
  const [v1, m1] = anchors[anchors.length - 1];
  const slope = v1 !== v0 ? (m1 - m0) / (v1 - v0) : 1;
  return Math.max(0, Math.floor(m1 + (videoSeconds - v1) * slope));
}

function onTimeUpdate() {
  const video = $('clipVideo');
  if (!video) return;
  const seconds = isAnalyticsReplay ? videoToMatchSeconds(video.currentTime) : Math.floor(video.currentTime);
  if (seconds === currentSeconds) return;
  currentSeconds = seconds;
  renderMoment();
  renderMemory();
  scheduleExtraction(seconds);
}

function onSeeked() {
  const video = $('clipVideo');
  if (!video) return;
  currentSeconds = isAnalyticsReplay ? videoToMatchSeconds(video.currentTime) : Math.floor(video.currentTime);
  renderMoment();
  renderMemory();
  clearTimeout(seekTimer);
  seekTimer = setTimeout(async () => {
    if (!isAnalyticsReplay && liveMode && !liveExtractBlocked) {
      const bucket = bucketSecond(currentSeconds);
      enqueueBucketsUpTo(currentSeconds);
      priorityBucket = bucket;
      drainQueue();
      await waitForBucket(bucket);
    }
    await describeNow();
  }, 250);
}

async function ask(question) {
  const clip = currentClip();
  const mode = 'balanced';
  lastAnswerText = 'Thinking…';
  const memoryEntries = currentMemory();
  const matchContext = getResolvedContext();
  const answer = await generateQnaAnswer({
    question,
    memoryEntries,
    matchContext,
    mode,
    fallback: () => localAnswer(question)
  });
  lastAnswerText = answer;
  await saveMemory({ clip: clip.title, question, mode, ts: Date.now() });
  return answer;
}

async function describeNow() {
  const mode = 'balanced';
  lastAnswerText = await generateAdc({
    memoryEntries: currentMemory(),
    matchContext: getResolvedContext(),
    mode,
    fallback: () => localAdc(mode)
  });
  speak();
}

function speak(text = lastAnswerText) {
  return speakWithDeepgramOrFallback(text);
}

function setVoiceStatus(message) {
  const el = $('voiceStatus');
  if (el) el.textContent = message;
}

// Wake word heard ("Match Vision, <question>") — mute the live ticker so it
// doesn't talk over the answer, ask, speak the answer, then resume.
async function handleVoiceQuestion(question) {
  commentaryMuted = true;
  stopSpeaking();
  setVoiceStatus(`🎙️ Heard: "${question}" — thinking…`);
  const answer = await ask(question);
  setVoiceStatus('🎙️ Answering…');
  await speak(answer);
  commentaryMuted = false;
  setVoiceStatus('🎙️ Always listening — say "Match Vision" then your question.');
}

async function init() {
  clips = await fetch('data/clips.json').then((r) => r.json());
  const select = $('clipSelect');
  clips.forEach((clip) => {
    const option = document.createElement('option');
    option.value = clip.clip_id;
    option.textContent = clip.title;
    select.appendChild(option);
  });
  if ($('liveExtractToggle')) $('liveExtractToggle').checked = liveMode;
  select.addEventListener('change', renderClip);
  $('liveExtractToggle')?.addEventListener('change', (event) => {
    liveMode = event.target.checked;
    renderClip();
  });
  $('clipVideo')?.addEventListener('timeupdate', onTimeUpdate);
  $('clipVideo')?.addEventListener('seeked', onSeeked);
  setupWakeWordListening({ onQuestion: handleVoiceQuestion, onStatusChange: setVoiceStatus });
  await renderClip();
}

init().catch((error) => {
  console.error(error);
  setVoiceStatus('⚠️ Failed to load demo data.');
});
