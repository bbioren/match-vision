// MatchVision content script — floating circle UI + zoom/pan engine
(function () {
  'use strict';
  if (window._mvContentLoaded) return;
  window._mvContentLoaded = true;

  // ── State ─────────────────────────────────────────────────────────────────
  let isTracking = false;
  let targetVideo = null;
  let zoomLevel = 2.0;
  let smoothX = null, smoothY = null;
  let currentPanX = 0, currentPanY = 0;
  let _pidIntX = 0, _pidIntY = 0;
  let _pidPrevErrX = 0, _pidPrevErrY = 0;
  let _pidLastTime = 0;
  const INT_LIMIT = 3.0;
  const params = { panSpeed: 6, kP: 0.08, kI: 0.02, kD: 0.04, gazeSmooth: 0.12, yBias: 0, yScale: 1.0 };
  let panInterval = null;
  let calibrationOverlay = null;
  let debugDot = null;
  let naturalVideoRect = null;
  let uiExpanded = false;

  // ── Video detection ───────────────────────────────────────────────────────
  function findBestVideo() {
    const all = [...document.querySelectorAll('video')]
      .filter(v => v.offsetWidth > 0 && v.offsetHeight > 0);
    if (!all.length) return null;
    const playing = all.filter(v => !v.paused && !v.ended);
    const pool = playing.length ? playing : all;
    return pool.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
  }

  // ── PID pan ───────────────────────────────────────────────────────────────
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
    _pidPrevErrX = errX; _pidPrevErrY = errY;
    const outX = params.kP * errX + params.kI * _pidIntX + params.kD * dX;
    const outY = params.kP * errY + params.kI * _pidIntY + params.kD * dY;
    const aspect = rect.width / rect.height;
    const edge   = (zoomLevel - 1) / zoomLevel * 50;
    currentPanX = Math.max(-edge, Math.min(edge, currentPanX - outX * params.panSpeed));
    currentPanY = Math.max(-edge, Math.min(edge, currentPanY - outY * params.panSpeed * aspect));
    targetVideo.style.transform       = `scale(${zoomLevel}) translate(${currentPanX}%, ${currentPanY}%)`;
    targetVideo.style.transformOrigin = 'center';
  }

  // ── Gaze smoother + debug dot ─────────────────────────────────────────────
  function applyGaze(x, y) {
    // Correct for webcam-position bias: scale Y then shift it down
    const cy = y * params.yScale + params.yBias;
    const a = params.gazeSmooth;
    smoothX = smoothX === null ? x  : smoothX + a * (x  - smoothX);
    smoothY = smoothY === null ? cy : smoothY + a * (cy - smoothY);
    if (debugDot) { debugDot.style.left = smoothX + 'px'; debugDot.style.top = smoothY + 'px'; }
  }

  function createDebugDot() {
    if (debugDot) return;
    debugDot = document.createElement('div');
    Object.assign(debugDot.style, {
      position: 'fixed', width: '18px', height: '18px', borderRadius: '50%',
      background: 'rgba(255,60,60,0.75)', border: '2px solid #fff',
      boxShadow: '0 0 10px rgba(255,60,60,0.5)', pointerEvents: 'none',
      zIndex: '2147483640', transform: 'translate(-50%,-50%)',
      transition: 'left 0.05s linear, top 0.05s linear',
    });
    (document.fullscreenElement || document.body).appendChild(debugDot);
  }

  function removeDebugDot() {
    if (debugDot) { debugDot.remove(); debugDot = null; }
  }

  // ── Calibration ───────────────────────────────────────────────────────────
  const CAL_POINTS = [
    [0.1,0.1],[0.5,0.1],[0.9,0.1],
    [0.1,0.5],[0.5,0.5],[0.9,0.5],
    [0.1,0.9],[0.5,0.9],[0.9,0.9],
  ];
  const DOT_COLORS = ['#ff4444','#ff8800','#ffdd00','#44ff44','#00ddff',
                      '#4488ff','#cc44ff','#ff44cc','#ff3366'];
  const CAL_DWELL_MS = 1333;

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
      msg.innerHTML = '<strong>Eye-tracking calibration</strong><br>Look at each dot — it records automatically.';
      overlay.appendChild(msg);
      const prog = document.createElement('div');
      Object.assign(prog.style, {
        position: 'fixed', bottom: '28px', left: '50%',
        transform: 'translateX(-50%)', fontSize: '0.9rem',
        color: 'rgba(255,255,255,0.6)', pointerEvents: 'none', zIndex: '2147483647',
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
        const size = 44;
        Object.assign(dot.style, {
          position: 'fixed', width: size+'px', height: size+'px', borderRadius: '50%',
          background: DOT_COLORS[idx % DOT_COLORS.length],
          border: '3px solid #fff', boxShadow: '0 0 20px rgba(255,255,255,0.6)',
          left: `${fx * window.innerWidth  - size/2}px`,
          top:  `${fy * window.innerHeight - size/2}px`,
          zIndex: '2147483647',
          transition: 'transform 0.15s, opacity 0.15s',
          transform: 'scale(0.5)', opacity: '0', overflow: 'hidden',
        });
        const fill = document.createElement('div');
        Object.assign(fill.style, {
          position: 'absolute', inset: '0', borderRadius: '50%',
          background: 'rgba(255,255,255,0.45)',
          transform: 'scaleX(0)', transformOrigin: 'left center',
          transition: `transform ${CAL_DWELL_MS}ms linear`,
        });
        dot.appendChild(fill);
        overlay.appendChild(dot);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          dot.style.transform = 'scale(1)'; dot.style.opacity = '1';
          requestAnimationFrame(() => { fill.style.transform = 'scaleX(1)'; });
        }));
        prog.textContent = `Point ${idx + 1} / ${CAL_POINTS.length} — look at the dot`;

        function advance() {
          chrome.runtime.sendMessage({
            type: 'calibration-point',
            x: fx * window.innerWidth,
            y: fy * window.innerHeight,
          }).catch(() => {});
          dot.style.transform = 'scale(1.4)'; dot.style.opacity = '0';
          idx++;
          setTimeout(showPoint, 220);
        }
        const timer = setTimeout(advance, CAL_DWELL_MS);
        dot.addEventListener('click', e => { e.stopPropagation(); clearTimeout(timer); advance(); }, { once: true });
      }
      showPoint();
    });
  }

  // ── Fullscreen ────────────────────────────────────────────────────────────
  document.addEventListener('fullscreenchange', () => {
    if (!isTracking || !targetVideo) return;
    setTimeout(() => {
      const savedTransform = targetVideo.style.transform;
      const savedOrigin    = targetVideo.style.transformOrigin;
      targetVideo.style.transform = ''; targetVideo.style.transformOrigin = '';
      naturalVideoRect = targetVideo.getBoundingClientRect();
      targetVideo.style.transform = savedTransform; targetVideo.style.transformOrigin = savedOrigin;
      currentPanX = 0; currentPanY = 0;
      _pidIntX = 0; _pidIntY = 0; _pidPrevErrX = 0; _pidPrevErrY = 0;
      if (debugDot) (document.fullscreenElement || document.body).appendChild(debugDot);
    }, 200);
  });

  // ── Start / stop tracking ─────────────────────────────────────────────────
  function startTracking(initZoom, initParams) {
    if (isTracking) return;
    targetVideo = findBestVideo();
    console.log('[MV] startTracking — video:', targetVideo?.tagName ?? 'NOT FOUND');
    if (!targetVideo) { setUiStatus('No video found on this page.', 'error'); return; }
    if (initZoom   !== undefined) zoomLevel = initZoom;
    if (initParams !== undefined) Object.assign(params, initParams);
    naturalVideoRect = targetVideo.getBoundingClientRect();
    targetVideo._mvClip = targetVideo.style.clipPath;
    targetVideo.style.clipPath = 'inset(0)';
    isTracking = true;
    createDebugDot();
    panInterval = setInterval(() => { if (isTracking) pidUpdate(); }, 50);
    // Expose params to the iframe via a shared key the iframe's voice handler reads
    setInterval(() => {
      const frame = document.getElementById('mv-tracker-frame');
      if (frame) {
        try { frame.contentWindow._mvCurrentParams = { ...params, zoom: zoomLevel, isTracking }; } catch (_) {}
      }
    }, 500);
    setUiStatus('Tracking — look at the video.', 'active');
    setUiTrackingBtn(true);
  }

  function stopTracking() {
    isTracking = false;
    clearInterval(panInterval); panInterval = null;
    calibrationOverlay?.remove(); calibrationOverlay = null;
    removeDebugDot();
    if (targetVideo) {
      targetVideo.style.transform = ''; targetVideo.style.transformOrigin = '';
      if ('_mvClip' in targetVideo) { targetVideo.style.clipPath = targetVideo._mvClip; delete targetVideo._mvClip; }
      targetVideo = null;
    }
    smoothX = null; smoothY = null; currentPanX = 0; currentPanY = 0;
    _pidIntX = 0; _pidIntY = 0; _pidPrevErrX = 0; _pidPrevErrY = 0; _pidLastTime = 0;
    naturalVideoRect = null;
    document.getElementById('mv-tracker-frame')?.remove();
    chrome.runtime.sendMessage({ type: 'stop-tracker-window', tabId: 0 }).catch(() => {});
    setUiStatus('Stopped.', '');
    setUiTrackingBtn(false);
  }

  // ── Zoom helpers ──────────────────────────────────────────────────────────
  function applyZoom(level) {
    zoomLevel = Math.max(1, Math.min(6, level));
    const sl = document.getElementById('mv-zm');
    const vl = document.getElementById('mv-zm-val');
    if (sl) sl.value = zoomLevel;
    if (vl) vl.textContent = zoomLevel.toFixed(1) + '×';
    if (targetVideo)
      targetVideo.style.transform = `scale(${zoomLevel}) translate(${currentPanX}%,${currentPanY}%)`;
  }

  function resetPan() {
    currentPanX = 0; currentPanY = 0;
    if (targetVideo)
      targetVideo.style.transform = `scale(${zoomLevel}) translate(0%,0%)`;
  }

  // ── Floating circle UI ────────────────────────────────────────────────────
  function buildUI() {
    if (document.getElementById('mv-float')) return;

    const style = document.createElement('style');
    style.textContent = `
      #mv-float { position:fixed; bottom:20px; right:20px; z-index:2147483644; font-family:system-ui,sans-serif; user-select:none; }
      #mv-circle {
        width:52px; height:52px; border-radius:50%;
        background:#1a1a2e; border:2px solid rgba(255,255,255,0.2);
        cursor:pointer; display:flex; align-items:center; justify-content:center;
        font-size:22px; box-shadow:0 4px 20px rgba(0,0,0,0.6);
        transition:border-color 0.2s, box-shadow 0.2s; margin-left:auto;
      }
      #mv-circle.active { border-color:#4eff88; box-shadow:0 4px 24px rgba(78,255,136,0.5); animation:mv-pulse 2s infinite; }
      @keyframes mv-pulse { 0%,100%{box-shadow:0 4px 24px rgba(78,255,136,0.5)} 50%{box-shadow:0 4px 32px rgba(78,255,136,0.8)} }
      #mv-panel {
        display:none; margin-bottom:8px; background:#0a0a1a;
        border:1px solid rgba(255,255,255,0.1); border-radius:12px;
        padding:14px; width:300px; box-shadow:0 8px 32px rgba(0,0,0,0.7);
        color:#e0e0e0; font-size:13px;
      }
      #mv-panel.open { display:block; }
      #mv-panel h3 { font-size:14px; font-weight:700; margin:0 0 4px; }
      #mv-status { font-size:11px; color:rgba(255,255,255,0.45); margin-bottom:12px; min-height:16px; }
      #mv-status.active{color:#4eff88} #mv-status.loading{color:#70e1ff} #mv-status.error{color:#ff6b6b}
      .mv-btn {
        width:100%; padding:8px; border:none; border-radius:8px; font-size:12px;
        font-weight:600; cursor:pointer; background:rgba(255,255,255,0.1);
        color:#e0e0e0; margin-bottom:8px; transition:background 0.15s;
      }
      .mv-btn:hover{background:rgba(255,255,255,0.18)} .mv-btn.on{background:#4eff88;color:#000}
      .mv-row{display:flex;gap:6px;margin-bottom:8px} .mv-row .mv-btn{margin-bottom:0}
      .mv-sep{border:none;border-top:1px solid rgba(255,255,255,0.08);margin:10px 0}
      .mv-sec{font-size:9px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:rgba(255,255,255,.25);margin-bottom:7px}
      .mv-sl{margin-bottom:8px}
      .mv-sl-top{display:flex;justify-content:space-between;font-size:10px;color:rgba(255,255,255,.4);margin-bottom:3px}
      .mv-sl input[type=range]{width:100%;accent-color:#70e1ff;cursor:pointer}
    `;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'mv-float';
    root.innerHTML = `
      <div id="mv-panel">
        <h3>👁 MatchVision</h3>
        <div id="mv-status">Open a video, then click Start.</div>
        <button class="mv-btn" id="mv-toggle">Start Eye Tracking</button>
        <div class="mv-row">
          <button class="mv-btn" id="mv-zout">🔍−</button>
          <button class="mv-btn" id="mv-zin">🔍+</button>
          <button class="mv-btn" id="mv-zreset">↺ Reset</button>
        </div>
        <hr class="mv-sep">
        <div class="mv-sec">Zoom &amp; Motion</div>
        <div class="mv-sl"><div class="mv-sl-top"><span>Zoom</span><span id="mv-zm-val">2.0×</span></div>
          <input type="range" id="mv-zm" min="1.2" max="6" step="0.1" value="2"></div>
        <div class="mv-sl"><div class="mv-sl-top"><span>Pan speed</span><span id="mv-sp-val">6</span></div>
          <input type="range" id="mv-sp" min="1" max="20" step="1" value="6"></div>
        <div class="mv-sl"><div class="mv-sl-top"><span>Smoothing</span><span id="mv-sm-val">0.12</span></div>
          <input type="range" id="mv-sm" min="0.02" max="0.5" step="0.01" value="0.12"></div>
        <hr class="mv-sep">
        <div class="mv-sec">PID Controller</div>
        <div class="mv-sl"><div class="mv-sl-top"><span>kP</span><span id="mv-kp-val">0.08</span></div>
          <input type="range" id="mv-kp" min="0.01" max="0.5" step="0.01" value="0.08"></div>
        <div class="mv-sl"><div class="mv-sl-top"><span>kI</span><span id="mv-ki-val">0.020</span></div>
          <input type="range" id="mv-ki" min="0" max="0.2" step="0.005" value="0.02"></div>
        <div class="mv-sl"><div class="mv-sl-top"><span>kD</span><span id="mv-kd-val">0.040</span></div>
          <input type="range" id="mv-kd" min="0" max="0.3" step="0.005" value="0.04"></div>
        <hr class="mv-sep">
        <div class="mv-sec">Webcam Correction</div>
        <div class="mv-sl"><div class="mv-sl-top"><span>Y bias (cam above screen)</span><span id="mv-yb-val">0px</span></div>
          <input type="range" id="mv-yb" min="-200" max="400" step="5" value="0"></div>
        <div class="mv-sl"><div class="mv-sl-top"><span>Y scale (vertical sensitivity)</span><span id="mv-ys-val">1.00</span></div>
          <input type="range" id="mv-ys" min="0.5" max="2.5" step="0.05" value="1.0"></div>
        <hr class="mv-sep">
        <div class="mv-sec">Voice Agent</div>
        <button class="mv-btn" id="mv-mic">🎤 Wake word: OFF</button>
        <div id="mv-voice-status" style="font-size:10px;color:rgba(255,255,255,.4);margin-bottom:8px;min-height:28px;line-height:1.4">
          Say <strong style="color:#70e1ff">"Match Vision …"</strong> to talk to Claude
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <input id="mv-apikey" type="password" placeholder="Anthropic API key (sk-ant-…)"
            style="flex:1;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);
                   border-radius:6px;padding:5px 8px;color:#e0e0e0;font-size:10px;outline:none">
          <button class="mv-btn" id="mv-apikey-save"
            style="width:auto;padding:5px 10px;margin:0;font-size:10px">Save</button>
        </div>
      </div>
      <div id="mv-circle">👁</div>
    `;
    document.body.appendChild(root);

    const circle  = root.querySelector('#mv-circle');
    const panel   = root.querySelector('#mv-panel');
    const toggle  = root.querySelector('#mv-toggle');

    circle.addEventListener('click', e => {
      e.stopPropagation();
      uiExpanded = !uiExpanded;
      panel.classList.toggle('open', uiExpanded);
    });
    document.addEventListener('click', e => {
      if (uiExpanded && !root.contains(e.target)) {
        uiExpanded = false;
        panel.classList.remove('open');
      }
    });

    toggle.addEventListener('click', () => {
      if (isTracking) { stopTracking(); }
      else { startFlow(); }
    });

    root.querySelector('#mv-zin').addEventListener('click',   () => applyZoom(zoomLevel + 0.25));
    root.querySelector('#mv-zout').addEventListener('click',  () => applyZoom(zoomLevel - 0.25));
    root.querySelector('#mv-zreset').addEventListener('click',() => { applyZoom(2); resetPan(); });

    function wireSlider(id, valId, fmt, onChange) {
      const sl = root.querySelector('#' + id);
      const vl = root.querySelector('#' + valId);
      sl.addEventListener('input', () => { const v = parseFloat(sl.value); onChange(v); vl.textContent = fmt(v); });
    }
    wireSlider('mv-zm', 'mv-zm-val', v => v.toFixed(1)+'×', v => applyZoom(v));
    wireSlider('mv-sp', 'mv-sp-val', v => v,   v => { params.panSpeed   = v; });
    wireSlider('mv-sm', 'mv-sm-val', v => v.toFixed(2), v => { params.gazeSmooth = v; });
    wireSlider('mv-kp', 'mv-kp-val', v => v.toFixed(2), v => { params.kP = v; });
    wireSlider('mv-ki', 'mv-ki-val', v => v.toFixed(3), v => { params.kI = v; });
    wireSlider('mv-kd', 'mv-kd-val', v => v.toFixed(3), v => { params.kD = v; });
    wireSlider('mv-yb', 'mv-yb-val', v => v + 'px',    v => { params.yBias  = v; });
    wireSlider('mv-ys', 'mv-ys-val', v => v.toFixed(2), v => { params.yScale = v; });

    // ── Voice agent ───────────────────────────────────────────────────────
    const micBtn      = root.querySelector('#mv-mic');
    const voiceStatus = root.querySelector('#mv-voice-status');
    const apikeyInput = root.querySelector('#mv-apikey');
    const apikeySave  = root.querySelector('#mv-apikey-save');

    // Load saved API key placeholder
    chrome.storage.local.get('anthropicApiKey').then(({ anthropicApiKey }) => {
      if (anthropicApiKey) apikeyInput.placeholder = 'API key saved ✓';
    });

    apikeySave.addEventListener('click', () => {
      const key = apikeyInput.value.trim();
      if (!key) return;
      chrome.storage.local.set({ anthropicApiKey: key });
      apikeyInput.value = '';
      apikeyInput.placeholder = 'API key saved ✓';
      voiceStatus.textContent = 'API key saved.';
      setTimeout(() => { voiceStatus.textContent = ''; }, 2000);
    });

    // ── Always-on wake word ("Match Vision …") ───────────────────────────
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    let wakeRec = null;
    let wakeOn  = false;
    let lastQuery = '', lastQueryTime = 0;

    function setVoiceOn(on) {
      wakeOn = on;
      micBtn.textContent = on ? '🎤 Wake word: ON' : '🎤 Wake word: OFF';
      micBtn.style.background = on ? '#4eff88' : '';
      micBtn.style.color      = on ? '#000'    : '';
      if (!on) {
        voiceStatus.innerHTML = 'Say <strong style="color:#70e1ff">"Match Vision …"</strong> to talk to Claude';
      }
    }

    function startWake(tabId) {
      if (!SR) { voiceStatus.textContent = '⚠ Speech recognition not available.'; return; }
      wakeRec = new SR();
      wakeRec.lang = 'en-US';
      wakeRec.continuous = true;
      wakeRec.interimResults = false;

      wakeRec.onresult = (e) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (!e.results[i].isFinal) continue;
          const text = e.results[i][0].transcript;
          console.log('[MV wake] heard:', text);

          // Detect wake word (fuzzy: "match vision", "match mission", etc.)
          const m = text.match(/match\s*(?:vision|fission|mission|physician)\s+([\s\S]+)/i);
          if (!m) continue;

          const query = m[1].trim();
          const now = Date.now();
          if (query === lastQuery && now - lastQueryTime < 4000) continue; // dedupe
          lastQuery = query; lastQueryTime = now;

          console.log('[MV wake] wake word → query:', query);
          voiceStatus.textContent = `"${query}" — asking Claude…`;
          chrome.runtime.sendMessage({
            type: 'voice-transcript', tabId, text: query,
            currentParams: { ...params, zoom: zoomLevel, isTracking },
          }).catch(() => {});
        }
      };

      // Auto-restart on end (Chrome stops after silence)
      wakeRec.onend = () => { if (wakeOn) setTimeout(() => { try { wakeRec.start(); } catch(_){} }, 200); };
      wakeRec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return; // normal
        console.warn('[MV wake] error:', e.error);
        if (wakeOn) setTimeout(() => { try { wakeRec.start(); } catch(_){} }, 1000);
      };
      wakeRec.start();
    }

    micBtn.addEventListener('click', async () => {
      if (!SR) { voiceStatus.textContent = '⚠ Speech recognition not available.'; return; }
      if (wakeOn) {
        // Turn off
        wakeOn = false;
        try { wakeRec?.stop(); } catch(_) {}
        setVoiceOn(false);
      } else {
        // Turn on
        const { tabId } = await chrome.runtime.sendMessage({ type: 'get-tab-id' });
        setVoiceOn(true);
        voiceStatus.textContent = 'Listening for "Match Vision …"';
        startWake(tabId);
      }
    });
  }

  function speak(text) {
    if (!text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 1.1;
    window.speechSynthesis.speak(utt);
  }

  function updateSlider(id, value, fmt) {
    const sl = document.getElementById(id);
    const vl = document.getElementById(id + '-val');
    if (sl) sl.value = value;
    if (vl) vl.textContent = fmt(value);
  }

  function setUiStatus(msg, cls = '') {
    const el = document.getElementById('mv-status');
    if (el) { el.textContent = msg; el.className = cls; }
  }

  function setUiTrackingBtn(on) {
    const btn    = document.getElementById('mv-toggle');
    const circle = document.getElementById('mv-circle');
    if (btn)    { btn.textContent = on ? 'Stop Tracking' : 'Start Eye Tracking'; btn.classList.toggle('on', on); }
    if (circle) { circle.classList.toggle('active', on); }
  }

  // ── Start flow — inject tracker iframe into this page ─────────────────────
  async function startFlow() {
    if (!findBestVideo()) { setUiStatus('No video found on this page.', 'error'); return; }
    setUiStatus('Starting eye tracker…', 'loading');

    // Get our tab ID from background (content scripts can't call chrome.tabs.getCurrent)
    let tabId;
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'get-tab-id' });
      tabId = resp?.tabId;
    } catch (e) {
      console.error('[MV] get-tab-id failed:', e);
      setUiStatus('Error starting tracker.', 'error');
      return;
    }
    console.log('[MV] injecting tracker iframe for tab', tabId);

    // Inject tracker-window.html as a hidden iframe IN this page.
    // Because the iframe lives inside the active YouTube tab, Chrome never
    // throttles its rAF/timers — it's always "visible" from the browser's perspective.
    let frame = document.getElementById('mv-tracker-frame');
    if (frame) frame.remove();
    frame = document.createElement('iframe');
    frame.id = 'mv-tracker-frame';
    frame.src = chrome.runtime.getURL('tracker-window.html') + '?tabId=' + tabId;
    frame.allow = 'camera; microphone';
    Object.assign(frame.style, {
      position: 'fixed', width: '160px', height: '120px',
      bottom: '70px', right: '20px', border: 'none',
      borderRadius: '8px', overflow: 'hidden',
      opacity: '0.85', pointerEvents: 'none',
      zIndex: '2147483640', boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    });
    document.documentElement.appendChild(frame);
    console.log('[MV] tracker iframe injected');
    // tracker-window.js inside the iframe will send 'tracker-window-ready' when loaded
  }

  // ── Message listener ──────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    switch (msg.type) {
      case 'remove-tracker-frame':
        document.getElementById('mv-tracker-frame')?.remove();
        break;
      case 'voice-response': {
        const vs = document.getElementById('mv-voice-status');
        if (msg.error) {
          if (vs) vs.textContent = '⚠ ' + msg.error;
          speak(msg.error);
          break;
        }
        // Apply param changes from Claude tool call
        if (msg.params) {
          const p = msg.params;
          if (p.zoom       != null) applyZoom(p.zoom);
          if (p.panSpeed   != null) { params.panSpeed   = p.panSpeed;   updateSlider('mv-sp', p.panSpeed,   v => v); }
          if (p.gazeSmooth != null) { params.gazeSmooth = p.gazeSmooth; updateSlider('mv-sm', p.gazeSmooth, v => v.toFixed(2)); }
          if (p.kP         != null) { params.kP         = p.kP;         updateSlider('mv-kp', p.kP,         v => v.toFixed(2)); }
          if (p.kI         != null) { params.kI         = p.kI;         updateSlider('mv-ki', p.kI,         v => v.toFixed(3)); }
          if (p.kD         != null) { params.kD         = p.kD;         updateSlider('mv-kd', p.kD,         v => v.toFixed(3)); }
          if (p.yBias      != null) { params.yBias      = p.yBias;      updateSlider('mv-yb', p.yBias,      v => v + 'px'); }
          if (p.yScale     != null) { params.yScale     = p.yScale;     updateSlider('mv-ys', p.yScale,     v => v.toFixed(2)); }
        }
        // Execute control actions
        if (msg.action === 'start')     startFlow();
        if (msg.action === 'stop')      stopTracking();
        if (msg.action === 'reset_pan') resetPan();

        if (msg.text) {
          if (vs) vs.textContent = msg.text;
          speak(msg.text);
        }
        break;
      }
      case 'run-calibration':
        console.log('[MV] run-calibration received');
        setUiStatus('Calibrating — look at each dot…', 'loading');
        runCalibration().then(() => {
          console.log('[MV] calibration done, calling startTracking');
          startTracking(zoomLevel, params);
        });
        break;
      case 'gaze':
        if (isTracking) {
          applyGaze(msg.x, msg.y);
          if (Math.random() < 0.03) console.log('[MV] gaze', Math.round(msg.x), Math.round(msg.y));
        } else {
          if (Math.random() < 0.1) console.log('[MV] gaze arrived but isTracking=false');
        }
        break;
      case 'zoom':
        applyZoom(msg.level);
        break;
      case 'reset-pan':
        resetPan();
        break;
      case 'params':
        Object.assign(params, msg.data);
        break;
    }
  });

  // ── Init ──────────────────────────────────────────────────────────────────
  buildUI();
})();
