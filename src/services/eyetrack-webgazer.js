/**
 * eyetrack-webgazer.js
 * WebGazer.js (Brown University) gaze tracking backend for MatchVision.
 * Exports the same API as eyetrack-real.js — drop-in replacement.
 */

let isTracking = false;
let currentZoomLevel = 2.0;
let currentVideoElement = null;
let gazeListenerActive = false;
let panInterval = null;
let calibrationOverlay = null;

// Raw screen-space gaze from WebGazer (pixels)
let gazeScreenX = null;
let gazeScreenY = null;

// EMA-smoothed gaze (what the PID actually sees)
let smoothX = null;
let smoothY = null;

let currentPanX = 0;
let currentPanY = 0;

// PID state
let _pidIntX = 0, _pidIntY = 0;
let _pidPrevErrX = 0, _pidPrevErrY = 0;
let _pidLastTime = 0;

const INT_LIMIT = 3.0; // anti-windup clamp

const params = {
  panSpeed: 6,
  kP: 0.08,   // proportional — how fast it chases gaze
  kI: 0.02,   // integral — eliminates steady-state offset from miscalibration
  kD: 0.04,   // derivative — damps overshoot (only useful after gaze is smoothed)
  gazeSmooth: 0.12, // EMA factor on raw WebGazer output (lower = smoother but laggier)
};

// ---------------------------------------------------------------------------
// WebGazer loader
// ---------------------------------------------------------------------------
function loadWebGazer() {
  return new Promise((resolve, reject) => {
    if (typeof webgazer !== 'undefined') { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/webgazer';
    s.crossOrigin = 'anonymous';
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error('Failed to load WebGazer from CDN'));
    document.head.appendChild(s);
  });
}

// ---------------------------------------------------------------------------
// PID pan — drives video so the gaze point moves toward the video center
// ---------------------------------------------------------------------------
function pidUpdate(videoElement, zoomLevel) {
  if (!videoElement || !isTracking || smoothX === null) return;

  // Video container's position on screen
  const rect = videoElement.parentElement.getBoundingClientRect();
  const centerX = rect.left + rect.width  / 2;
  const centerY = rect.top  + rect.height / 2;

  // Error: how far smoothed gaze is from video center, normalized to -1…1
  const errX = (smoothX - centerX) / (rect.width  / 2);
  const errY = (smoothY - centerY) / (rect.height / 2);

  const now = Date.now();
  const dt  = _pidLastTime ? Math.min((now - _pidLastTime) / 1000, 0.1) : 0.016;
  _pidLastTime = now;

  // Integral — accumulates steady-state error (e.g. calibration offset)
  _pidIntX = Math.max(-INT_LIMIT, Math.min(INT_LIMIT, _pidIntX + errX * dt));
  _pidIntY = Math.max(-INT_LIMIT, Math.min(INT_LIMIT, _pidIntY + errY * dt));

  // Derivative (damping)
  const dX = dt > 0 ? (errX - _pidPrevErrX) / dt : 0;
  const dY = dt > 0 ? (errY - _pidPrevErrY) / dt : 0;
  _pidPrevErrX = errX;
  _pidPrevErrY = errY;

  // Full PID output
  const outX = params.kP * errX + params.kI * _pidIntX + params.kD * dX;
  const outY = params.kP * errY + params.kI * _pidIntY + params.kD * dY;

  // translate(x%, y%) percentages are relative to the element's own dimensions.
  // A 16:9 video means 1% Y covers only 9/16 as many pixels as 1% X.
  // Multiply Y pan by the aspect ratio so equal errors produce equal visual displacement.
  const aspect = rect.width / rect.height;

  const edge = (zoomLevel - 1) / zoomLevel * 50;
  currentPanX = Math.max(-edge, Math.min(edge, currentPanX - outX * params.panSpeed));
  currentPanY = Math.max(-edge, Math.min(edge, currentPanY - outY * params.panSpeed * aspect));

  videoElement.style.transform = `scale(${zoomLevel}) translate(${currentPanX}%, ${currentPanY}%)`;
}

// ---------------------------------------------------------------------------
// Calibration overlay
// ---------------------------------------------------------------------------
const CALIBRATION_POINTS = [
  // 9-point grid: [xFraction, yFraction]
  [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
  [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
  [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
];
const DOT_COLORS = ['#ff4444', '#ff8800', '#ffdd00', '#44ff44', '#00ddff',
                    '#4488ff', '#cc44ff', '#ff44cc', '#ffffff'];

function runCalibration() {
  return new Promise((resolve) => {
    // Build overlay
    const overlay = document.createElement('div');
    overlay.id = 'webgazer-calibration-overlay';
    Object.assign(overlay.style, {
      position:        'fixed',
      inset:           '0',
      zIndex:          '999999',
      background:      'rgba(0,0,0,0.92)',
      display:         'flex',
      alignItems:      'center',
      justifyContent:  'center',
      flexDirection:   'column',
      color:           '#fff',
      fontFamily:      'system-ui, sans-serif',
    });

    const msg = document.createElement('div');
    Object.assign(msg.style, {
      position:   'fixed',
      top:        '32px',
      left:       '50%',
      transform:  'translateX(-50%)',
      textAlign:  'center',
      fontSize:   '1.1rem',
      lineHeight: '1.6',
      maxWidth:   '480px',
      background: 'rgba(0,0,0,0.75)',
      padding:    '12px 20px',
      borderRadius: '10px',
      pointerEvents: 'none',
    });
    msg.innerHTML = '<strong>Eye-tracking calibration</strong><br>Look at each dot, then press <kbd style="background:#333;border:1px solid #666;border-radius:4px;padding:1px 6px;font-family:monospace;">Space</kbd> to record it.';
    overlay.appendChild(msg);

    const progress = document.createElement('div');
    Object.assign(progress.style, {
      position:    'fixed',
      bottom:      '28px',
      left:        '50%',
      transform:   'translateX(-50%)',
      fontSize:    '0.9rem',
      color:       'rgba(255,255,255,0.65)',
      pointerEvents: 'none',
    });
    overlay.appendChild(progress);

    document.body.appendChild(overlay);
    calibrationOverlay = overlay;

    let pointIndex = 0;

    function showPoint() {
      // Remove previous dot
      const prev = overlay.querySelector('.cal-dot');
      if (prev) prev.remove();

      if (pointIndex >= CALIBRATION_POINTS.length) {
        // Done
        overlay.remove();
        calibrationOverlay = null;
        resolve();
        return;
      }

      const [fx, fy] = CALIBRATION_POINTS[pointIndex];
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const dot = document.createElement('div');
      dot.className = 'cal-dot';
      Object.assign(dot.style, {
        position:      'fixed',
        width:         '40px',
        height:        '40px',
        borderRadius:  '50%',
        background:    DOT_COLORS[pointIndex % DOT_COLORS.length],
        border:        '3px solid #fff',
        boxShadow:     '0 0 18px rgba(255,255,255,0.6)',
        cursor:        'pointer',
        left:          `${fx * vw - 20}px`,
        top:           `${fy * vh - 20}px`,
        zIndex:        '1000000',
        transition:    'transform 0.15s, opacity 0.15s',
        transform:     'scale(0.6)',
        opacity:       '0',
      });

      overlay.appendChild(dot);

      // Animate in
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          dot.style.transform = 'scale(1)';
          dot.style.opacity   = '1';
        });
      });

      progress.textContent = `Point ${pointIndex + 1} of ${CALIBRATION_POINTS.length} — look at the dot, then press Space`;

      function advance() {
        // Record the dot's center position for WebGazer's ridge regression
        const dotX = fx * window.innerWidth;
        const dotY = fy * window.innerHeight;
        try { webgazer.recordScreenPosition(dotX, dotY, 'click'); } catch (_) {}

        dot.style.transform = 'scale(1.4)';
        dot.style.opacity   = '0';
        pointIndex++;
        setTimeout(showPoint, 220);
      }

      // Spacebar advances; clicking the dot still works as a fallback
      const onKey = (e) => {
        if (e.code === 'Space') { e.preventDefault(); document.removeEventListener('keydown', onKey); advance(); }
      };
      document.addEventListener('keydown', onKey);

      dot.addEventListener('click', (e) => {
        e.stopPropagation();
        document.removeEventListener('keydown', onKey);
        advance();
      }, { once: true });
    }

    showPoint();
  });
}

// ---------------------------------------------------------------------------
// Gaze listener — maps screen coords to video-relative 0-1
// ---------------------------------------------------------------------------
function attachGazeListener(videoElement) {
  if (gazeListenerActive) return;
  gazeListenerActive = true;

  // EMA-smooth raw WebGazer output before PID sees it
  webgazer.setGazeListener((data) => {
    if (!data || !isTracking) return;
    gazeScreenX = data.x;
    gazeScreenY = data.y;
    const a = params.gazeSmooth;
    smoothX = smoothX === null ? data.x : smoothX + a * (data.x - smoothX);
    smoothY = smoothY === null ? data.y : smoothY + a * (data.y - smoothY);
  });

  // PID loop at ~20 fps
  panInterval = setInterval(() => {
    if (isTracking && currentVideoElement) {
      pidUpdate(currentVideoElement, currentZoomLevel);
    }
  }, 50);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function initEyeTracking(videoElement, zoomLevel = 2.0) {
  if (isTracking) return true;
  currentZoomLevel = zoomLevel;
  currentVideoElement = videoElement;

  try {
    console.log('📹 Loading WebGazer.js...');
    await loadWebGazer();

    // Configure WebGazer before begin()
    webgazer
      .setRegression('ridge')
      .showVideoPreview(false)
      .showFaceOverlay(false)
      .showFaceFeedbackBox(false);

    // Pause WebGazer's built-in gaze listener until after calibration
    webgazer.pause();

    console.log('🎯 Starting calibration...');
    // Begin must be called before calibration so the camera is initialised
    // (webgazer.begin() starts the camera + model internally)
    await new Promise((resolve, reject) => {
      try {
        webgazer.begin();
        // Give WebGazer ~800ms to spin up the camera before calibration
        setTimeout(resolve, 800);
      } catch (err) {
        reject(err);
      }
    });

    // Show calibration UI (user clicks 9 dots)
    await runCalibration();

    console.log('✅ Calibration done — resuming gaze tracking');
    webgazer.resume();

    // Attach our listener and start the pan loop
    isTracking = true;
    attachGazeListener(videoElement);

    return true;
  } catch (err) {
    console.error('❌ WebGazer init failed:', err);
    if (calibrationOverlay) { calibrationOverlay.remove(); calibrationOverlay = null; }
    isTracking = false;
    try { webgazer.end(); } catch (_) {}
    return false;
  }
}

export async function stopEyeTracking() {
  isTracking = false;
  gazeListenerActive = false;

  if (panInterval) { clearInterval(panInterval); panInterval = null; }
  if (calibrationOverlay) { calibrationOverlay.remove(); calibrationOverlay = null; }

  try {
    webgazer.clearGazeListener();
    webgazer.end();
  } catch (_) {}

  gazeScreenX = null; gazeScreenY = null;
  smoothX = null; smoothY = null;
  currentPanX = 0; currentPanY = 0;
  _pidIntX = 0; _pidIntY = 0;
  _pidPrevErrX = 0; _pidPrevErrY = 0;
  _pidLastTime = 0;
  currentVideoElement = null;
}

export async function toggleEyeTracking(videoElement, zoomLevel = 2.0) {
  if (isTracking) {
    await stopEyeTracking();
    if (videoElement) videoElement.style.transform = '';
    return false;
  }
  return await initEyeTracking(videoElement, zoomLevel);
}

export function updateZoom(videoElement, zoomLevel) {
  currentZoomLevel = zoomLevel;
  currentVideoElement = videoElement;
  updateVideoZoom(videoElement, zoomLevel);
}

export function setZoomLevel(videoElement, zoomLevel) { updateZoom(videoElement, zoomLevel); }
export function isTrackingActive() { return isTracking; }
export function getGazePosition()  { return { x: gazeX, y: gazeY }; }
export function setDebugDot(el)    { debugDotEl = el; }
export function setDebugHud(el)    { hudEl = el; }

export function setParams({ panSpeed, kP, kI, kD, gazeSmooth } = {}) {
  if (panSpeed    !== undefined) params.panSpeed    = panSpeed;
  if (kP          !== undefined) params.kP          = kP;
  if (kI          !== undefined) params.kI          = kI;
  if (kD          !== undefined) params.kD          = kD;
  if (gazeSmooth  !== undefined) params.gazeSmooth  = gazeSmooth;
}
