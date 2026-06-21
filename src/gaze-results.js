/**
 * gaze-results.js — aggregate every saved gaze session into per-clip heatmaps.
 * Pulls full sessions from /api/gaze?full=1 and the clip catalogue from
 * data/survey_clips.json, then paints a heatmap of all gaze samples over each
 * clip's poster frame.
 */
const $ = (id) => document.getElementById(id);

// Reading gaze data requires an admin token (see api/gaze.js). The token is
// taken from ?token= in the URL (then remembered for the tab), else prompted.
function adminToken() {
  const fromUrl = new URLSearchParams(location.search).get('token');
  if (fromUrl) { sessionStorage.setItem('gazeAdminToken', fromUrl); return fromUrl; }
  return sessionStorage.getItem('gazeAdminToken') || '';
}

function fetchSessions(token) {
  return fetch('/api/gaze?full=1', { headers: token ? { 'x-admin-token': token } : {} }).catch(() => null);
}

async function load() {
  const survey = await fetch('data/survey_clips.json').then((r) => r.json()).catch(() => ({ clips: [] }));

  let token = adminToken();
  let res = await fetchSessions(token);
  if (res && (res.status === 401 || res.status === 403)) {
    token = (window.prompt('Enter the gaze admin token to view results:') || '').trim();
    if (token) { sessionStorage.setItem('gazeAdminToken', token); res = await fetchSessions(token); }
  }
  if (!res || !res.ok) {
    let info = {};
    try { info = await res.json(); } catch { /* non-JSON error */ }
    return { survey, sessions: [], token, authError: { status: res ? res.status : 0, ...info } };
  }
  const data = await res.json().catch(() => ({ sessions: [] }));
  return { survey, sessions: data.sessions ?? [], token };
}

// Group all samples by clip_id across every session.
function groupByClip(sessions) {
  const byClip = new Map();
  for (const session of sessions) {
    for (const clip of session.clips ?? []) {
      if (!clip.clip_id) continue;
      const entry = byClip.get(clip.clip_id) ?? { samples: [], sessions: 0, watched: 0 };
      entry.sessions += 1;
      entry.watched += clip.watched_seconds ?? 0;
      for (const s of clip.samples ?? []) entry.samples.push(s);
      byClip.set(clip.clip_id, entry);
    }
  }
  return byClip;
}

// ── Heatmap rendering ──────────────────────────────────────────────────────
// Heatmaps are smooth blobs, so a fixed internal resolution scaled by CSS looks
// fine and keeps per-frame playback cheap. We accumulate density into a float
// buffer (no 8-bit clipping), normalise against a peak, then colour-map with a
// gamma > 1 so only genuinely concentrated gaze reads as warm/red.
const RW = 800;
const RH = 450;
const GAMMA = 1.7;

const onFrame = (s) => Number.isFinite(s.x) && Number.isFinite(s.y) && s.x >= 0 && s.x <= 1 && s.y >= 0 && s.y <= 1;

// Accumulate a density field for `samples` at w×h. Returns { acc, max }.
// The peak value is ~resolution-independent (it counts overlapping samples via a
// 0..1 falloff), so a norm computed at low res is valid for a high-res render.
function accumulate(samples, w, h) {
  const acc = new Float32Array(w * h);
  const radius = Math.max(4, Math.round(w * 0.03));
  const r2 = radius * radius;
  let max = 0;
  for (const s of samples) {
    const cx = s.x * w;
    const cy = s.y * h;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const x1 = Math.min(w - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const y1 = Math.min(h - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const row = y * w;
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const d2 = dx * dx + dy * dy;
        if (d2 > r2) continue;
        const f = 1 - d2 / r2; // 1 at centre → 0 at edge
        const idx = row + x;
        const v = acc[idx] + f * f;
        acc[idx] = v;
        if (v > max) max = v;
      }
    }
  }
  return { acc, max };
}

function paint(ctx, acc, normMax) {
  ctx.clearRect(0, 0, RW, RH);
  if (!(normMax > 0)) return;
  const out = ctx.createImageData(RW, RH);
  const od = out.data;
  for (let i = 0; i < acc.length; i++) {
    const v = acc[i];
    const o = i * 4;
    if (v <= 0) { od[o + 3] = 0; continue; }
    const t = Math.pow(Math.min(1, v / normMax), GAMMA);
    if (t < 0.08) { od[o + 3] = 0; continue; } // hide near-zero noise
    const [r, g, b] = ramp(t);
    od[o] = r; od[o + 1] = g; od[o + 2] = b;
    od[o + 3] = Math.round((0.18 + 0.7 * t) * 255);
  }
  ctx.putImageData(out, 0, 0);
}

function ramp(t) {
  // 0 blue → .4 green → .7 yellow → 1 red
  const stops = [
    [0.0, [40, 90, 255]],
    [0.4, [60, 230, 120]],
    [0.7, [255, 220, 60]],
    [1.0, [255, 50, 60]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return c0.map((c, k) => Math.round(c + (c1[k] - c) * f));
    }
  }
  return stops[stops.length - 1][1];
}

// First index in the sorted array whose value is >= target (binary search).
function lowerBound(arr, target) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Half-width of the "Live" time window, in seconds (so the overlay shows gaze
// within ±LIVE_HALF of the current playback time).
const LIVE_HALF = 0.6;

function renderClipCard(clip, entry) {
  const card = document.createElement('section');
  card.className = 'card';
  card.style.marginBottom = '18px';

  const all = (entry?.samples ?? []).filter(onFrame);
  const n = entry?.samples.length ?? 0;
  const sessions = entry?.sessions ?? 0;
  const avgWatch = sessions ? (entry.watched / sessions).toFixed(1) : '0';
  const hasVideo = Boolean(clip.video_src) && all.length > 0;

  card.innerHTML = `
    <div class="heat-meta">
      <h2 style="margin:0;">${clip.title ?? clip.clip_id}</h2>
      <span class="small">${sessions} session${sessions === 1 ? '' : 's'} · ${n.toLocaleString()} samples · avg watched ${avgWatch}s</span>
    </div>
    <div class="heat-box" style="margin-top:12px; ${clip.poster ? `background-image:url('${clip.poster}');` : ''}">
      ${hasVideo ? `<video playsinline muted preload="metadata" ${clip.poster ? `poster="${clip.poster}"` : ''} src="${clip.video_src}"></video>` : ''}
      <canvas></canvas>
    </div>
    ${hasVideo ? `
    <div class="heat-controls">
      <button class="hc-play" type="button">▶ Play</button>
      <input class="hc-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Scrub clip" />
      <span class="hc-time small">0.0s</span>
      <select class="hc-mode small" aria-label="Overlay mode">
        <option value="live">Live window (±${LIVE_HALF}s)</option>
        <option value="cumulative">Cumulative trail</option>
        <option value="all">Aggregate (all)</option>
      </select>
    </div>` : ''}
    ${n === 0 ? '<p class="hint" style="margin-top:10px;">No gaze data yet for this clip.</p>' : ''}
  `;
  $('clipGrid').appendChild(card);

  const canvas = card.querySelector('canvas');
  canvas.width = RW;
  canvas.height = RH;
  const ctx = canvas.getContext('2d');

  // The full-clip aggregate is computed once and reused for the static view,
  // the "Aggregate" overlay mode, and as the normalisation peak for cumulative.
  const aggregate = accumulate(all, RW, RH);
  paint(ctx, aggregate.acc, aggregate.max);
  if (!hasVideo) return;

  // Timeline data: samples that carry a video timestamp, sorted by it.
  const timed = all.filter((s) => Number.isFinite(s.vt)).sort((a, b) => a.vt - b.vt);
  const vts = timed.map((s) => s.vt);

  const video = card.querySelector('video');
  const playBtn = card.querySelector('.hc-play');
  const seek = card.querySelector('.hc-seek');
  const timeLbl = card.querySelector('.hc-time');
  const modeSel = card.querySelector('.hc-mode');

  // Live-window normalisation: the densest window across the clip, so warm/red
  // stays comparable from frame to frame instead of flickering. Computed at low
  // res (cheap; peak is resolution-independent). Falls back to the aggregate peak.
  let liveNorm = aggregate.max * 0.3;
  function computeLiveNorm(duration) {
    let norm = 0;
    for (let c = 0; c <= duration + LIVE_HALF; c += LIVE_HALF) {
      const lo = lowerBound(vts, c - LIVE_HALF);
      const hi = lowerBound(vts, c + LIVE_HALF);
      if (hi <= lo) continue;
      const { max } = accumulate(timed.slice(lo, hi), 320, 180);
      if (max > norm) norm = max;
    }
    liveNorm = norm || aggregate.max;
  }

  function renderAt(tc) {
    const mode = modeSel.value;
    if (mode === 'all') { paint(ctx, aggregate.acc, aggregate.max); return; }
    let lo;
    let hi;
    let normMax;
    if (mode === 'cumulative') {
      lo = 0;
      hi = lowerBound(vts, tc);
      normMax = aggregate.max;
    } else {
      lo = lowerBound(vts, tc - LIVE_HALF);
      hi = lowerBound(vts, tc + LIVE_HALF);
      normMax = liveNorm;
    }
    const { acc } = accumulate(timed.slice(lo, hi), RW, RH);
    paint(ctx, acc, normMax);
  }

  function syncUI() {
    const d = video.duration || 0;
    if (d) seek.value = String(Math.round((video.currentTime / d) * 1000));
    timeLbl.textContent = `${video.currentTime.toFixed(1)}s`;
  }

  let raf = 0;
  function loop() {
    renderAt(video.currentTime);
    syncUI();
    if (!video.paused && !video.ended) raf = requestAnimationFrame(loop);
  }

  video.addEventListener('loadedmetadata', () => {
    computeLiveNorm(video.duration || 40);
    // Match the box to the real frame so x/y (normalised to the frame) line up.
    if (video.videoWidth && video.videoHeight) {
      card.querySelector('.heat-box').style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
    }
  });
  playBtn.addEventListener('click', () => {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  });
  video.addEventListener('play', () => { playBtn.textContent = '⏸ Pause'; cancelAnimationFrame(raf); loop(); });
  video.addEventListener('pause', () => { playBtn.textContent = '▶ Play'; cancelAnimationFrame(raf); });
  video.addEventListener('ended', () => { playBtn.textContent = '↻ Replay'; cancelAnimationFrame(raf); });
  seek.addEventListener('input', () => {
    const d = video.duration || 0;
    video.currentTime = (Number(seek.value) / 1000) * d;
    timeLbl.textContent = `${video.currentTime.toFixed(1)}s`;
    if (video.paused) renderAt(video.currentTime);
  });
  modeSel.addEventListener('change', () => renderAt(video.currentTime));
}

async function main() {
  const { survey, sessions, token, authError } = await load();

  // Wire the "Raw JSON" link with the token so it works for an authorised admin.
  const rawLink = document.querySelector('a[href^="/api/gaze"]');
  if (rawLink) rawLink.href = token ? `/api/gaze?full=1&token=${encodeURIComponent(token)}` : '/api/gaze?full=1';

  if (authError) {
    const hint = $('emptyHint');
    hint.style.display = 'block';
    if (authError.status === 503 || authError.error === 'admin_token_not_configured') {
      hint.innerHTML = 'Gaze data viewing is locked. Set <code>GAZE_ADMIN_TOKEN</code> in the deployment environment and redeploy, then open this page with <code>?token=YOUR_TOKEN</code>.';
    } else {
      hint.innerHTML = 'Access restricted — a valid admin token is required. Open this page with <code>?token=YOUR_TOKEN</code>, or reload to re-enter it.';
    }
    return;
  }

  const byClip = groupByClip(sessions);

  const totalSamples = [...byClip.values()].reduce((a, e) => a + e.samples.length, 0);
  const clipsWithData = [...byClip.values()].filter((e) => e.samples.length).length;
  const calibScores = sessions.map((s) => s.calibration?.score).filter((s) => typeof s === 'number');
  const avgCalib = calibScores.length ? Math.round(calibScores.reduce((a, b) => a + b, 0) / calibScores.length) : null;

  $('statSessions').textContent = sessions.length.toLocaleString();
  $('statSamples').textContent = totalSamples.toLocaleString();
  $('statClips').textContent = clipsWithData.toLocaleString();
  $('statCalib').textContent = avgCalib === null ? '—' : `${avgCalib}%`;

  if (!sessions.length) {
    const hint = $('emptyHint');
    hint.style.display = 'block';
    hint.innerHTML = 'No sessions recorded yet. <a class="link" href="survey.html">Take the survey →</a> and your gaze data will show up here.';
  }

  const clips = survey.clips?.length ? survey.clips : [...byClip.keys()].map((id) => ({ clip_id: id }));
  clips.forEach((clip) => renderClipCard(clip, byClip.get(clip.clip_id)));
}

main();
