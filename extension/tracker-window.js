// MatchVision tracker window — runs WebGazer persistently.
// rAF is overridden with setTimeout in the HTML before this loads.
// Pages actively capturing camera (getUserMedia) are exempt from Chrome throttling.
(async () => {
  const tabId = parseInt(new URLSearchParams(location.search).get('tabId'), 10);
  console.log('[MV iframe] starting, tabId:', tabId, 'inIframe:', window !== window.top);
  if (!tabId) { console.error('[MV iframe] no tabId in URL'); return; }

  const statusEl = document.getElementById('status'); // may be null in iframe mode
  const log = (msg, cls = '') => {
    if (statusEl) { statusEl.textContent = msg; statusEl.className = cls; }
    console.log('[MV win]', msg);
  };

  let gazingActive = false;

  // ── Message listener ─────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.target !== 'tracker-window') return;
    if (msg.type === 'calibration-point') {
      try { webgazer.recordScreenPosition(msg.x, msg.y, 'click'); } catch (_) {}
    } else if (msg.type === 'start-gaze') {
      gazingActive = true;
      const dot = document.getElementById('dot');
      if (dot) { dot.style.background = '#4eff88'; dot.style.boxShadow = '0 0 6px #4eff88'; }
      log('Tracking active — switch to your video', 'active');
    } else if (msg.type === 'stop-gaze') {
      gazingActive = false;
      try { webgazer.clearGazeListener(); webgazer.end(); } catch (_) {}
      log('Stopped');
    } else if (msg.type === 'start-voice') {
      startListening(msg.tabId);
    }
  });

  function startListening(tabId) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      chrome.runtime.sendMessage({ type: 'voice-error', tabId, error: 'Speech recognition not supported in this browser.' }).catch(() => {});
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      const text = e.results[0][0].transcript;
      console.log('[MV voice] heard:', text);
      chrome.runtime.sendMessage({ type: 'voice-transcript', tabId, text,
        currentParams: window._mvCurrentParams || {} }).catch(() => {});
    };
    rec.onerror = (e) => {
      chrome.runtime.sendMessage({ type: 'voice-error', tabId, error: e.error }).catch(() => {});
    };
    rec.start();
    log('Listening…');
  }

  // ── Kick off AudioContext on any interaction (keeps page alive if window loses focus) ──
  // We also try immediately — if camera permission dialog was just clicked it may work.
  function startAudio() {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      console.log('[MV win] AudioContext state:', ctx.state);
    } catch (_) {}
  }
  // Try immediately (works if camera dialog click is still within Chrome's gesture window)
  startAudio();
  // Also try on any user interaction in the window
  document.addEventListener('click', startAudio, { once: true });
  document.addEventListener('keydown', startAudio, { once: true });

  // ── WebGazer ─────────────────────────────────────────────────────────────
  webgazer.params.saveDataAcrossSessions = false;
  try { await webgazer.clearData(); } catch (_) {}
  webgazer.params.showGazeDot = false;

  let _calls = 0;
  webgazer.setGazeListener((data) => {
    _calls++;
    if (!data) {
      if (_calls % 60 === 1) log('No face — look at camera');
      return;
    }
    if (!gazingActive) return;
    if (_calls % 30 === 1) log(`Tracking ${Math.round(data.x)}, ${Math.round(data.y)}`, 'active');
    chrome.runtime.sendMessage({ type: 'gaze-from-tracker', tabId, x: data.x, y: data.y })
      .catch(() => {});
  });

  webgazer
    .setRegression('ridge')
    .showVideoPreview(true)
    .showFaceOverlay(false)
    .showFaceFeedbackBox(false);

  log('Loading models…');
  webgazer.begin().catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  // Try AudioContext again now that camera is running (getUserMedia keeps page active)
  startAudio();

  const wgVid = document.getElementById('webgazerVideoFeed');
  const wgCanvas = document.getElementById('webgazerVideoCanvas');
  if (wgVid && wgCanvas) {
    const setSize = () => {
      if (wgVid.videoWidth > 0) {
        wgCanvas.width = wgVid.videoWidth;
        wgCanvas.height = wgVid.videoHeight;
      }
    };
    setSize();
    wgVid.addEventListener('loadeddata', setSize, { once: true });
    wgVid.addEventListener('resize', setSize);
    wgVid.style.cssText = '';
    document.getElementById('cam-wrap').appendChild(wgVid);
  }

  try { webgazer.resume(); } catch (_) {}
  console.log('[MV iframe] webgazer resumed, sending tracker-window-ready for tab', tabId);
  log('Ready — calibrating on YouTube…');

  // Auto-start calibration — no button needed
  chrome.runtime.sendMessage({ type: 'tracker-window-ready', tabId })
    .then(() => console.log('[MV iframe] tracker-window-ready sent'))
    .catch(e => console.error('[MV iframe] tracker-window-ready failed:', e));
})();
