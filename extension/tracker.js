// MatchVision content script — receives gaze from the side panel; applies zoom/pan
(function () {
  'use strict';
  if (window._mvContentLoaded) return;
  window._mvContentLoaded = true;

  // ── State ──────────────────────────────────────────────────────────────────
  let isTracking = false;
  let targetVideo = null;
  let zoomLevel = 2.0;
  let smoothX = null, smoothY = null;
  let currentPanX = 0, currentPanY = 0;
  let _pidIntX = 0, _pidIntY = 0;
  let _pidPrevErrX = 0, _pidPrevErrY = 0;
  let _pidLastTime = 0;
  const INT_LIMIT = 3.0;
  const params = { panSpeed: 6, kP: 0.08, kI: 0.02, kD: 0.04, gazeSmooth: 0.12 };
  let panInterval = null;
  let calibrationOverlay = null;
  let debugDot = null;
  let naturalVideoRect = null; // video rect captured before any transforms

  // ── Video detection ────────────────────────────────────────────────────────
  function findBestVideo() {
    const all = [...document.querySelectorAll('video')]
      .filter(v => v.offsetWidth > 0 && v.offsetHeight > 0);
    if (!all.length) return null;
    const playing = all.filter(v => !v.paused && !v.ended);
    const pool = playing.length ? playing : all;
    return pool.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
  }

  // ── PID pan ────────────────────────────────────────────────────────────────
  function pidUpdate() {
    if (!targetVideo || !isTracking || smoothX === null) return;
    const rect = naturalVideoRect;
    if (!rect || !rect.width || !rect.height) return;

    const errX = (smoothX - (rect.left + rect.width  / 2)) / (rect.width  / 2);
    const errY = (smoothY - (rect.top  + rect.height / 2)) / (rect.height / 2);

    const now = Date.now();
    const dt  = _pidLastTime ? Math.min((now - _pidLastTime) / 1000, 0.1) : 0.016;
    _pidLastTime = now;

    _pidIntX = Math.max(-INT_LIMIT, Math.min(INT_LIMIT, _pidIntX + errX * dt));
    _pidIntY = Math.max(-INT_LIMIT, Math.min(INT_LIMIT, _pidIntY + errY * dt));

    const dX = dt > 0 ? (errX - _pidPrevErrX) / dt : 0;
    const dY = dt > 0 ? (errY - _pidPrevErrY) / dt : 0;
    _pidPrevErrX = errX;
    _pidPrevErrY = errY;

    const outX = params.kP * errX + params.kI * _pidIntX + params.kD * dX;
    const outY = params.kP * errY + params.kI * _pidIntY + params.kD * dY;

    const aspect = rect.width / rect.height;
    const edge   = (zoomLevel - 1) / zoomLevel * 50;
    currentPanX = Math.max(-edge, Math.min(edge, currentPanX - outX * params.panSpeed));
    currentPanY = Math.max(-edge, Math.min(edge, currentPanY - outY * params.panSpeed * aspect));

    targetVideo.style.transform       = `scale(${zoomLevel}) translate(${currentPanX}%, ${currentPanY}%)`;
    targetVideo.style.transformOrigin = 'center';
  }

  // ── EMA gaze smoother + debug dot ─────────────────────────────────────────
  function applyGaze(x, y) {
    const a = params.gazeSmooth;
    smoothX = smoothX === null ? x : smoothX + a * (x - smoothX);
    smoothY = smoothY === null ? y : smoothY + a * (y - smoothY);
    if (debugDot) {
      debugDot.style.left = smoothX + 'px';
      debugDot.style.top  = smoothY + 'px';
    }
  }

  function createDebugDot() {
    if (debugDot) return;
    debugDot = document.createElement('div');
    Object.assign(debugDot.style, {
      position: 'fixed', width: '18px', height: '18px', borderRadius: '50%',
      background: 'rgba(255, 60, 60, 0.75)', border: '2px solid #fff',
      boxShadow: '0 0 10px rgba(255,60,60,0.5)', pointerEvents: 'none',
      zIndex: '2147483647', transform: 'translate(-50%,-50%)',
      transition: 'left 0.05s linear, top 0.05s linear',
    });
    document.body.appendChild(debugDot);
  }

  function removeDebugDot() {
    if (debugDot) { debugDot.remove(); debugDot = null; }
  }

  // ── Calibration overlay — dots on the page; points sent to panel via message ─
  const CAL_POINTS = [
    [0.1,0.1],[0.5,0.1],[0.9,0.1],
    [0.1,0.5],[0.5,0.5],[0.9,0.5],
    [0.1,0.9],[0.5,0.9],[0.9,0.9],
  ];
  const DOT_COLORS = ['#ff4444','#ff8800','#ffdd00','#44ff44','#00ddff',
                      '#4488ff','#cc44ff','#ff44cc','#ffffff'];

  function runCalibration() {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', zIndex: '2147483646',
        background: 'rgba(0,0,0,0.92)', fontFamily: 'system-ui,sans-serif',
      });

      const msg = document.createElement('div');
      Object.assign(msg.style, {
        position: 'fixed', top: '32px', left: '50%',
        transform: 'translateX(-50%)', textAlign: 'center',
        fontSize: '1.1rem', lineHeight: '1.6', color: '#fff',
        maxWidth: '480px', background: 'rgba(0,0,0,0.8)',
        padding: '12px 20px', borderRadius: '10px',
        pointerEvents: 'none', zIndex: '2147483647',
      });
      const strong = document.createElement('strong');
      strong.textContent = 'Eye-tracking calibration';
      const code = document.createElement('code');
      code.textContent = 'Space';
      code.style.cssText = 'background:#333;padding:2px 7px;border-radius:4px;font-family:monospace';
      msg.appendChild(strong);
      msg.appendChild(document.createElement('br'));
      msg.appendChild(document.createTextNode('Look at each dot, then press '));
      msg.appendChild(code);
      msg.appendChild(document.createTextNode(' to record it.'));
      overlay.appendChild(msg);

      const prog = document.createElement('div');
      Object.assign(prog.style, {
        position: 'fixed', bottom: '28px', left: '50%',
        transform: 'translateX(-50%)', fontSize: '0.9rem',
        color: 'rgba(255,255,255,0.6)', pointerEvents: 'none',
        zIndex: '2147483647',
      });
      overlay.appendChild(prog);
      document.body.appendChild(overlay);
      calibrationOverlay = overlay;

      let idx = 0;
      function showPoint() {
        overlay.querySelector('.mv-cal-dot')?.remove();
        if (idx >= CAL_POINTS.length) {
          overlay.remove();
          calibrationOverlay = null;
          chrome.runtime.sendMessage({ type: 'calibration-done' }).catch(() => {});
          resolve();
          return;
        }
        const [fx, fy] = CAL_POINTS[idx];
        const dot = document.createElement('div');
        dot.className = 'mv-cal-dot';
        Object.assign(dot.style, {
          position: 'fixed',
          width: '40px', height: '40px', borderRadius: '50%',
          background: DOT_COLORS[idx % DOT_COLORS.length],
          border: '3px solid #fff',
          boxShadow: '0 0 20px rgba(255,255,255,0.6)',
          cursor: 'pointer',
          left: `${fx * window.innerWidth  - 20}px`,
          top:  `${fy * window.innerHeight - 20}px`,
          zIndex: '2147483647',
          transition: 'transform 0.15s, opacity 0.15s',
          transform: 'scale(0.5)', opacity: '0',
        });
        overlay.appendChild(dot);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          dot.style.transform = 'scale(1)'; dot.style.opacity = '1';
        }));
        prog.textContent = `Point ${idx + 1} / ${CAL_POINTS.length} — look at the dot, press Space`;

        function advance() {
          chrome.runtime.sendMessage({
            type: 'calibration-point',
            x: fx * window.innerWidth,
            y: fy * window.innerHeight,
          }).catch(() => {});
          dot.style.transform = 'scale(1.5)'; dot.style.opacity = '0';
          idx++;
          setTimeout(showPoint, 220);
        }

        const onKey = e => {
          if (e.code === 'Space') {
            e.preventDefault();
            document.removeEventListener('keydown', onKey);
            advance();
          }
        };
        document.addEventListener('keydown', onKey);
        dot.addEventListener('click', e => {
          e.stopPropagation();
          document.removeEventListener('keydown', onKey);
          advance();
        }, { once: true });
      }
      showPoint();
    });
  }

  // ── Fullscreen support ─────────────────────────────────────────────────────
  document.addEventListener('fullscreenchange', () => {
    if (!isTracking || !targetVideo) return;
    setTimeout(() => {
      // Re-capture naturalVideoRect in the new layout (fullscreen or windowed).
      // Temporarily clear the transform so getBoundingClientRect returns the natural bounds.
      const savedTransform = targetVideo.style.transform;
      const savedOrigin    = targetVideo.style.transformOrigin;
      targetVideo.style.transform       = '';
      targetVideo.style.transformOrigin = '';
      naturalVideoRect = targetVideo.getBoundingClientRect();
      targetVideo.style.transform       = savedTransform;
      targetVideo.style.transformOrigin = savedOrigin;

      // Reset pan state to avoid a jarring jump.
      currentPanX = 0; currentPanY = 0;
      _pidIntX = 0; _pidIntY = 0;
      _pidPrevErrX = 0; _pidPrevErrY = 0;

      // Move debug dot into the fullscreen element so it renders over the content.
      if (debugDot) {
        const container = document.fullscreenElement || document.body;
        container.appendChild(debugDot);
      }
    }, 200);
  });

  // ── Start / stop ───────────────────────────────────────────────────────────
  function startTracking(initZoom, initParams) {
    if (isTracking) return;
    targetVideo = findBestVideo();
    if (!targetVideo) return;
    if (initZoom  !== undefined) zoomLevel = initZoom;
    if (initParams !== undefined) Object.assign(params, initParams);

    // Capture natural rect NOW, before any transform is applied.
    // getBoundingClientRect() on a scaled video returns the zoomed visual rect
    // whose center drifts toward screen center — we always want the original center.
    naturalVideoRect = targetVideo.getBoundingClientRect();

    // Clip zoom overflow to the video's own bounding box
    targetVideo._mvClip = targetVideo.style.clipPath;
    targetVideo.style.clipPath = 'inset(0)';

    isTracking = true;
    createDebugDot();
    panInterval = setInterval(() => { if (isTracking) pidUpdate(); }, 50);
  }

  function stopTracking() {
    isTracking = false;
    clearInterval(panInterval); panInterval = null;
    calibrationOverlay?.remove(); calibrationOverlay = null;
    removeDebugDot();
    if (targetVideo) {
      targetVideo.style.transform       = '';
      targetVideo.style.transformOrigin = '';
      if ('_mvClip' in targetVideo) {
        targetVideo.style.clipPath = targetVideo._mvClip;
        delete targetVideo._mvClip;
      }
      targetVideo = null;
    }
    smoothX = null; smoothY = null;
    currentPanX = 0; currentPanY = 0;
    _pidIntX = 0; _pidIntY = 0;
    _pidPrevErrX = 0; _pidPrevErrY = 0;
    _pidLastTime = 0;
    naturalVideoRect = null;
  }

  // ── Message listener ───────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'start-calibration':
        runCalibration();
        break;
      case 'start-tracking':
        console.log('[MV tracker] start-tracking received, video:', findBestVideo()?.tagName);
        startTracking(msg.zoomLevel, msg.params);
        break;
      case 'stop-tracking':
        stopTracking();
        break;
      case 'gaze':
        if (isTracking) {
          applyGaze(msg.x, msg.y);
          if (Math.random() < 0.05) console.log('[MV tracker] gaze', Math.round(msg.x), Math.round(msg.y));
        } else {
          console.log('[MV tracker] gaze received but isTracking=false');
        }
        break;
      case 'zoom':
        zoomLevel = msg.level;
        if (targetVideo)
          targetVideo.style.transform = `scale(${zoomLevel}) translate(${currentPanX}%,${currentPanY}%)`;
        break;
      case 'reset-pan':
        currentPanX = 0; currentPanY = 0;
        if (targetVideo)
          targetVideo.style.transform = `scale(${zoomLevel}) translate(0%,0%)`;
        break;
      case 'params':
        Object.assign(params, msg.data);
        break;
    }
  });
})();
