import { generateAdc, generateQnaAnswer } from './services/description.js';
import { setupSpeechRecognition, speakWithDeepgramOrFallback } from './services/voice.js';
import { loadMemory, saveMemory } from './services/memory.js';
import { selectBestCandidate, scoreCandidate } from './ranker.js';
import { currentMoment, memoryAt } from './services/match-memory.js';
import { captureVideoFrame, extractMomentFromFrame, formatVideoTimestamp } from './services/vision-extract.js';

let clips = [];
let annotationTasks = [];
let timeline = [];
let liveTimeline = [];
let liveMode = true;
let currentSeconds = 0;
let extractingSeconds = new Set();
let extractInterval = Number(window.MATCHVISION_EXTRACT_INTERVAL) || 4;
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
  if (mode === 'brief') return `${m.team_in_possession} are attacking ${m.direction}. The ball is ${m.ball_location}. ${m.event}.`;
  return m.summary || `${m.team_in_possession} — ${m.event}. Ball ${m.ball_location}.`;
}
function localAnswer(question) {
  const q = normalize(question);
  const mode = $('modeSelect')?.value || 'balanced';
  const recap = memoryAt(timeline, currentSeconds).map((m) => m.summary).filter(Boolean).join(' ');
  if (!recap) {
    return liveMode
      ? 'No match memory yet. Press play and wait for live frame analysis.'
      : 'Enable live vision extraction and press play first.';
  }
  if (q.includes('ball') || q.includes('where')) {
    const m = localMoment();
    return m.ball_location && m.ball_location !== 'unknown'
      ? `The ball is ${m.ball_location}.`
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

async function extractFrameAt(seconds, { allowPaused = false, describeAfter = false } = {}) {
  if (!liveMode || liveExtractBlocked) {
    if (describeAfter) await describeNow();
    return;
  }
  const video = $('clipVideo');
  if (!video || video.readyState < 2) {
    if (describeAfter) await describeNow();
    return;
  }
  if (video.paused && !allowPaused) return;

  const bucket = bucketSecond(seconds);
  if (liveTimeline.some((m) => m.atSecond === bucket)) {
    if (describeAfter) await describeNow();
    return;
  }
  if (extractingSeconds.has(bucket)) return;

  extractingSeconds.add(bucket);
  setExtractStatus(`Analyzing frame at ${formatVideoTimestamp(bucket)}…`);
  try {
    const imageBase64 = captureVideoFrame(video);
    if (!imageBase64) throw new Error('could not capture frame');
    const moment = await extractMomentFromFrame({ imageBase64, atSecond: bucket });
    moment.timestamp = formatVideoTimestamp(bucket);
    liveTimeline.push(moment);
    liveTimeline.sort((a, b) => a.atSecond - b.atSecond);
    timeline = liveTimeline;
    setExtractStatus(`Live: ${liveTimeline.length} moment(s) extracted (latest @ ${moment.timestamp})`);
    renderMoment();
    renderMemory();
    renderLiveJson();
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
    extractingSeconds.delete(bucket);
  }

  if (describeAfter) await describeNow();
}

async function maybeExtractFrame(seconds) {
  await extractFrameAt(seconds);
}

function renderMoment() {
  const m = localMoment();
  $('matchState').innerHTML = `
    <dl>
      <dt>Possession</dt><dd>${m.team_in_possession || 'unknown'}</dd>
      <dt>Direction</dt><dd>${m.direction || 'unknown'}</dd>
      <dt>Ball</dt><dd>${m.ball_location || 'unknown'}</dd>
      <dt>Visual event</dt><dd>${m.event || 'unknown'}</dd>
      <dt>Danger</dt><dd>${m.danger_level || 'unknown'}</dd>
    </dl>`;
}

function renderMemory() {
  const entries = memoryAt(timeline, currentSeconds);
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

function renderClip() {
  const clip = currentClip();
  liveTimeline = [];
  extractingSeconds.clear();
  liveExtractBlocked = false;
  timeline = [];
  currentSeconds = 0;
  if ($('clipVideo')) {
    $('clipVideo').src = clip.video_asset ? encodeURI(clip.video_asset) : '';
    $('clipVideo').style.display = clip.video_asset ? 'block' : 'none';
  }
  if ($('clipVisual')) {
    $('clipVisual').style.display = 'none';
  }
  renderMoment();
  renderRanker();
  renderMemory();
  renderLiveJson();
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
  maybeExtractFrame(seconds);
}

function onSeeked() {
  const video = $('clipVideo');
  if (!video) return;
  currentSeconds = Math.floor(video.currentTime);
  renderMoment();
  renderMemory();
  clearTimeout(seekTimer);
  seekTimer = setTimeout(() => {
    extractFrameAt(currentSeconds, { allowPaused: true, describeAfter: true });
  }, 250);
}

async function ask() {
  const clip = currentClip();
  const question = $('questionInput').value;
  const mode = $('modeSelect')?.value || 'balanced';
  $('answer').textContent = 'Thinking…';
  const memoryEntries = memoryAt(timeline, currentSeconds);
  $('answer').textContent = await generateQnaAnswer({
    question,
    memoryEntries,
    mode,
    fallback: () => localAnswer(question)
  });
  await saveMemory({ clip: clip.title, question, mode, ts: Date.now() });
}

async function describeNow() {
  const mode = $('modeSelect')?.value || 'balanced';
  $('answer').textContent = 'Describing…';
  $('answer').textContent = await generateAdc({
    memoryEntries: memoryAt(timeline, currentSeconds),
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
