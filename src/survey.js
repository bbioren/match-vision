/**
 * survey.js — MatchVision eye-tracking survey.
 *
 * Flow: consent → WebGazer 9-point calibration (+ quick validation) →
 * watch 5 soccer clips (≥30s each) while gaze is sampled at ~20 Hz →
 * POST the whole session to /api/gaze.
 *
 * Gaze is recorded in video-frame-normalized coordinates (0..1), i.e. "where on
 * the clip the person looked", with the full frame visible (no zoom/pan) so the
 * data cleanly answers "what are people looking at".
 */

// ── Terac submission linking (same convention as src/annotate.js) ───────────
const urlParams = new URLSearchParams(location.search);
const TERAC_SUBMISSION_ID =
  urlParams.get('teracSubmissionId') ??
  urlParams.get('submissionId') ??
  localStorage.getItem('teracSubmissionId') ??
  null;
const TERAC_TASK_ID = urlParams.get('taskId') ?? localStorage.getItem('teracTaskId') ?? null;
if (TERAC_SUBMISSION_ID) localStorage.setItem('teracSubmissionId', TERAC_SUBMISSION_ID);
if (TERAC_TASK_ID) localStorage.setItem('teracTaskId', TERAC_TASK_ID);

const $ = (id) => document.getElementById(id);

// ── Config ──────────────────────────────────────────────────────────────────
const SAMPLE_HZ = 20; // gaze samples per second
const CALIBRATION_POINTS = [
  [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
  [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
  [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
];
const DOT_COLORS = ['#ff4444', '#ff8800', '#ffdd00', '#44ff44', '#00ddff',
                    '#4488ff', '#cc44ff', '#ff44cc', '#ffffff'];

let survey = null;          // survey_clips.json
let minWatch = 30;          // seconds required per clip
let clipIndex = 0;
const results = [];         // one entry per clip { clip_id, video_src, ..., samples: [] }

// Live gaze (screen-space pixels), updated by WebGazer's listener
let lastGaze = null;        // { x, y }
let sampling = false;
let sampleTimer = null;
let watchedSeconds = 0;     // accumulated playback time for the current clip
let watchTickLast = 0;

// ── Screen helpers ────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.survey-screen').forEach((el) => el.classList.remove('active'));
  $(id).classList.add('active');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function setStatus(el, text, kind = '') {
  if (!el) return;
  el.style.display = 'inline-flex';
  el.textContent = text;
  el.className = `status-pill${kind ? ' ' + kind : ''}`;
}

// ── WebGazer loader ─────────────────────────────────────────────────────────
function loadWebGazer() {
  return new Promise((resolve, reject) => {
    if (typeof webgazer !== 'undefined') return resolve();
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/webgazer';
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load WebGazer from CDN'));
    document.head.appendChild(s);
  });
}

// ── Calibration overlay ──────────────────────────────────────────────────────
function runCalibration() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '999999', background: 'rgba(0,0,0,0.92)',
      color: '#fff', fontFamily: 'system-ui, sans-serif',
    });

    const msg = document.createElement('div');
    Object.assign(msg.style, {
      position: 'fixed', top: '32px', left: '50%', transform: 'translateX(-50%)',
      textAlign: 'center', fontSize: '1.05rem', lineHeight: '1.6', maxWidth: '520px',
      background: 'rgba(0,0,0,0.75)', padding: '12px 20px', borderRadius: '10px', pointerEvents: 'none',
    });
    msg.innerHTML = '<strong>Calibration</strong><br>Look straight at each dot, then press <kbd style="background:#333;border:1px solid #666;border-radius:4px;padding:1px 6px;font-family:monospace;">Space</kbd> (or click it).';
    overlay.appendChild(msg);

    const progress = document.createElement('div');
    Object.assign(progress.style, {
      position: 'fixed', bottom: '28px', left: '50%', transform: 'translateX(-50%)',
      fontSize: '0.9rem', color: 'rgba(255,255,255,0.65)', pointerEvents: 'none',
    });
    overlay.appendChild(progress);

    document.body.appendChild(overlay);
    let i = 0;

    function showPoint() {
      overlay.querySelector('.cal-dot')?.remove();
      if (i >= CALIBRATION_POINTS.length) { overlay.remove(); resolve(); return; }

      const [fx, fy] = CALIBRATION_POINTS[i];
      const dot = document.createElement('div');
      dot.className = 'cal-dot';
      Object.assign(dot.style, {
        position: 'fixed', width: '40px', height: '40px', borderRadius: '50%',
        background: DOT_COLORS[i % DOT_COLORS.length], border: '3px solid #fff',
        boxShadow: '0 0 18px rgba(255,255,255,0.6)', cursor: 'pointer',
        left: `${fx * window.innerWidth - 20}px`, top: `${fy * window.innerHeight - 20}px`,
        zIndex: '1000000', transition: 'transform 0.15s, opacity 0.15s', transform: 'scale(0.6)', opacity: '0',
      });
      overlay.appendChild(dot);
      requestAnimationFrame(() => requestAnimationFrame(() => { dot.style.transform = 'scale(1)'; dot.style.opacity = '1'; }));
      progress.textContent = `Point ${i + 1} of ${CALIBRATION_POINTS.length}`;

      const advance = () => {
        const dx = fx * window.innerWidth;
        const dy = fy * window.innerHeight;
        // Record the same point a few times to give the regression more weight
        for (let k = 0; k < 5; k++) { try { webgazer.recordScreenPosition(dx, dy, 'click'); } catch (_) {} }
        dot.style.transform = 'scale(1.4)'; dot.style.opacity = '0';
        i++; setTimeout(showPoint, 200);
      };
      const onKey = (e) => { if (e.code === 'Space') { e.preventDefault(); document.removeEventListener('keydown', onKey); advance(); } };
      document.addEventListener('keydown', onKey);
      dot.addEventListener('click', (e) => { e.stopPropagation(); document.removeEventListener('keydown', onKey); advance(); }, { once: true });
    }
    showPoint();
  });
}

// Quick accuracy check: show a centre dot, sample gaze for ~2.5s, return a 0–100 score.
function runValidation() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '999999', background: 'rgba(0,0,0,0.92)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff',
      fontFamily: 'system-ui, sans-serif',
    });
    const label = document.createElement('div');
    Object.assign(label.style, { position: 'fixed', top: '32px', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', fontSize: '1.05rem' });
    label.textContent = 'Keep looking at the centre dot…';
    overlay.appendChild(label);

    const cx = window.innerWidth / 2;
    const cy = window.innerHeight / 2;
    const dot = document.createElement('div');
    Object.assign(dot.style, {
      position: 'fixed', width: '26px', height: '26px', borderRadius: '50%', background: '#a4ff9f',
      boxShadow: '0 0 22px rgba(164,255,159,0.9)', left: `${cx - 13}px`, top: `${cy - 13}px`,
    });
    overlay.appendChild(dot);
    document.body.appendChild(overlay);

    const errors = [];
    const diag = Math.hypot(window.innerWidth, window.innerHeight);
    const startedAt = Date.now();
    const id = setInterval(() => {
      if (lastGaze) errors.push(Math.hypot(lastGaze.x - cx, lastGaze.y - cy));
      if (Date.now() - startedAt > 2500) {
        clearInterval(id);
        overlay.remove();
        if (!errors.length) return resolve(null);
        // Ignore the first ~0.5s while gaze settles
        const stable = errors.slice(Math.floor(errors.length * 0.25));
        const mean = stable.reduce((a, b) => a + b, 0) / stable.length;
        const score = Math.max(0, Math.min(100, Math.round(100 * (1 - mean / (diag * 0.18)))));
        resolve(score);
      }
    }, 60);
  });
}

// ── Gaze sampling ─────────────────────────────────────────────────────────
const video = () => $('surveyVideo');
const gazeDot = () => $('gazeDot');

function updateGazeDot() {
  if (!lastGaze) return;
  const d = gazeDot();
  d.style.display = 'block';
  d.style.left = `${lastGaze.x}px`;
  d.style.top = `${lastGaze.y}px`;
}

function sampleOnce(clipStart) {
  if (!sampling || !lastGaze) return;
  const v = video();
  if (v.paused || v.ended) return;
  const rect = v.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // Map screen gaze → normalized video-frame coords (full frame visible, no pan)
  const x = (lastGaze.x - rect.left) / rect.width;
  const y = (lastGaze.y - rect.top) / rect.height;
  results[clipIndex].samples.push({
    t: Date.now() - clipStart,
    vt: Math.round(v.currentTime * 100) / 100,
    x: Math.round(x * 1e4) / 1e4,
    y: Math.round(y * 1e4) / 1e4,
    sx: Math.round(lastGaze.x),
    sy: Math.round(lastGaze.y),
  });
}

// ── Clip flow ─────────────────────────────────────────────────────────────
function renderStepDots() {
  const wrap = $('stepDots');
  wrap.innerHTML = '';
  survey.clips.forEach((_, i) => {
    const d = document.createElement('div');
    d.className = 'step-dot' + (i < clipIndex ? ' done' : i === clipIndex ? ' current' : '');
    wrap.appendChild(d);
  });
}

function startClip() {
  const clip = survey.clips[clipIndex];
  results[clipIndex] = {
    clip_id: clip.clip_id,
    video_src: clip.video_src,
    duration_seconds: clip.duration_seconds ?? null,
    zoom: 1,
    watched_seconds: 0,
    samples: [],
  };

  $('clipBadge').textContent = `Clip ${clipIndex + 1} of ${survey.clips.length}`;
  $('clipTitle').textContent = clip.title ?? `Clip ${clipIndex + 1}`;
  renderStepDots();

  const v = video();
  v.poster = clip.poster ?? '';
  v.src = clip.video_src;
  v.currentTime = 0;
  watchedSeconds = 0;
  watchTickLast = 0;
  $('watchFill').style.width = '0%';
  $('nextBtn').disabled = true;
  setStatus($('watchStatus'), `Watch at least ${minWatch}s…`, 'tracking');
  $('playPauseBtn').textContent = '⏸️ Pause';

  showScreen('screen-clip');

  v.play().catch(() => {
    // Autoplay may be blocked until interaction; surface a play prompt
    $('playPauseBtn').textContent = '▶️ Play';
    setStatus($('watchStatus'), 'Press Play to start the clip', 'tracking');
  });

  const clipStart = Date.now();
  sampling = true;
  clearInterval(sampleTimer);
  sampleTimer = setInterval(() => sampleOnce(clipStart), Math.round(1000 / SAMPLE_HZ));
}

function tickWatched() {
  const v = video();
  if (v.paused || v.ended) { watchTickLast = 0; return; }
  const now = performance.now();
  if (watchTickLast) {
    watchedSeconds += (now - watchTickLast) / 1000;
    const pct = Math.min(100, (watchedSeconds / minWatch) * 100);
    $('watchFill').style.width = `${pct}%`;
    if (watchedSeconds >= minWatch && $('nextBtn').disabled) {
      $('nextBtn').disabled = false;
      setStatus($('watchStatus'), '✓ You can continue', 'tracking');
    }
  }
  watchTickLast = now;
}

function endClip() {
  sampling = false;
  clearInterval(sampleTimer);
  results[clipIndex].watched_seconds = Math.round(watchedSeconds * 10) / 10;
}

async function nextClip() {
  endClip();
  if (clipIndex < survey.clips.length - 1) {
    clipIndex += 1;
    startClip();
  } else {
    await finish();
  }
}

// ── Submit ──────────────────────────────────────────────────────────────────
async function finish() {
  showScreen('screen-done');
  gazeDot().style.display = 'none';
  try { webgazer.clearGazeListener(); webgazer.end(); } catch (_) {}

  const payload = {
    survey_id: survey.survey_id ?? 'soccer_gaze_v1',
    teracSubmissionId: TERAC_SUBMISSION_ID,
    teracTaskId: TERAC_TASK_ID,
    calibration: window.__calibration ?? null,
    participant: {
      screen: { w: window.screen.width, h: window.screen.height },
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dpr: window.devicePixelRatio,
      userAgent: navigator.userAgent,
    },
    clips: results,
  };

  const totalSamples = results.reduce((n, c) => n + c.samples.length, 0);
  $('doneSummary').textContent = 'Saving your gaze data…';
  try {
    const r = await fetch('/api/gaze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    $('doneSummary').textContent = '✅ Your gaze data has been saved.';
    $('doneDetails').innerHTML =
      `Recorded <strong>${totalSamples.toLocaleString()}</strong> gaze samples across ` +
      `<strong>${results.length}</strong> clips.<br>Session ID: <code>${data.id}</code>` +
      (TERAC_SUBMISSION_ID ? `<br>Terac session: <code>${TERAC_SUBMISSION_ID}</code>` : '');
  } catch (err) {
    // Don't lose the data — stash it locally as a fallback
    try {
      const stash = JSON.parse(localStorage.getItem('matchvision_gaze_fallback') || '[]');
      stash.push({ ...payload, _failed_at: new Date().toISOString() });
      localStorage.setItem('matchvision_gaze_fallback', JSON.stringify(stash));
    } catch (_) {}
    $('doneSummary').textContent = '⚠️ Could not reach the server.';
    $('doneDetails').innerHTML =
      `Your ${totalSamples.toLocaleString()} gaze samples were saved <strong>locally in this browser</strong> ` +
      `as a fallback (key <code>matchvision_gaze_fallback</code>). Error: ${err.message}`;
  }
}

// ── Init / wiring ─────────────────────────────────────────────────────────
async function begin() {
  const introStatus = $('introStatus');
  $('beginBtn').disabled = true;
  setStatus(introStatus, 'Loading eye tracker…');

  try {
    await loadWebGazer();
    webgazer.setRegression('ridge').showVideoPreview(false).showFaceOverlay(false).showFaceFeedbackBox(false);
    try { webgazer.saveDataAcrossSessions(false); } catch (_) { /* not in all builds */ }

    showScreen('screen-calibrate');
    setStatus($('calibrateStatus'), 'Starting camera…');

    await new Promise((resolve, reject) => {
      try { webgazer.begin(); setTimeout(resolve, 900); } catch (e) { reject(e); }
    });

    // Live gaze feed (single listener for the whole survey)
    webgazer.setGazeListener((data) => {
      if (!data) return;
      lastGaze = { x: data.x, y: data.y };
      updateGazeDot();
    });

    await runCalibration();
    setStatus($('calibrateStatus'), 'Checking accuracy…');
    const score = await runValidation();
    window.__calibration = { points: CALIBRATION_POINTS.length, score };

    clipIndex = 0;
    startClip();
  } catch (err) {
    showScreen('screen-intro');
    $('beginBtn').disabled = false;
    setStatus(introStatus, `Couldn't start tracking: ${err.message}. Check camera permission and try again.`, 'error');
  }
}

function wireClipControls() {
  const v = video();
  v.addEventListener('timeupdate', tickWatched);
  v.addEventListener('playing', () => { watchTickLast = 0; $('playPauseBtn').textContent = '⏸️ Pause'; });
  v.addEventListener('pause', () => { watchTickLast = 0; if (!v.ended) $('playPauseBtn').textContent = '▶️ Play'; });
  v.addEventListener('ended', () => {
    // Safety: if the participant paused enough to fall short of the minimum, replay.
    if (watchedSeconds < minWatch) { v.currentTime = 0; v.play().catch(() => {}); }
  });

  $('playPauseBtn').addEventListener('click', () => {
    if (v.paused) v.play().catch(() => {}); else v.pause();
  });
  $('muteBtn').addEventListener('click', () => {
    v.muted = !v.muted;
    $('muteBtn').textContent = v.muted ? '🔊 Unmute' : '🔇 Mute';
  });
  $('nextBtn').addEventListener('click', () => { nextClip(); });
}

async function init() {
  if (TERAC_SUBMISSION_ID) {
    const badge = $('submissionBadge');
    badge.textContent = `Terac session: ${TERAC_SUBMISSION_ID.slice(0, 12)}…`;
    badge.hidden = false;
  }

  try {
    survey = await fetch('data/survey_clips.json').then((r) => r.json());
  } catch (err) {
    setStatus($('introStatus'), `Could not load survey config: ${err.message}`, 'error');
    return;
  }
  minWatch = survey.min_watch_seconds ?? 30;

  wireClipControls();
  $('beginBtn').addEventListener('click', begin);
  $('restartBtn').addEventListener('click', () => location.reload());
}

init();
