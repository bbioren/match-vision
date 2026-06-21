// MatchVision tracker window — runs WebGazer independently after the panel is closed.
(async () => {
  const statusEl = document.getElementById('status');
  const setStatus = (msg, color = '#4eff88') => {
    statusEl.textContent = msg;
    statusEl.style.color = color;
    console.log('[MV tracker-win]', msg);
  };

  const tabId = parseInt(new URLSearchParams(location.search).get('tabId'), 10);
  if (!tabId) { setStatus('Error: no tabId in URL', '#ff6b6b'); return; }

  // Play silent audio so Chrome doesn't throttle rAF/timers if user minimizes this window.
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
  } catch (_) {}

  setStatus('Starting camera…');

  webgazer.params.saveDataAcrossSessions = true; // loads calibration panel saved
  webgazer.params.showGazeDot = false;

  let _calls = 0, _gazeSent = 0;
  webgazer.setGazeListener((data) => {
    _calls++;
    if (!data) return;
    _gazeSent++;
    if (_gazeSent % 30 === 1) {
      setStatus(`Tracking — gaze ${Math.round(data.x)}, ${Math.round(data.y)}`);
    }
    chrome.tabs.sendMessage(tabId, { type: 'gaze', x: data.x, y: data.y })
      .catch(e => {
        if (_gazeSent % 30 === 1) console.warn('[MV tracker-win] sendMessage failed:', e.message);
      });
  });

  webgazer
    .setRegression('ridge')
    .showVideoPreview(true)
    .showFaceOverlay(false)
    .showFaceFeedbackBox(false);

  try {
    webgazer.begin().catch(e => setStatus('begin() error: ' + e.message, '#ff6b6b'));
  } catch (e) {
    setStatus('Error: ' + e.message, '#ff6b6b');
    return;
  }

  setStatus('Loading models… (3s)');
  await new Promise(r => setTimeout(r, 3000));

  const wgVid = document.getElementById('webgazerVideoFeed');
  const wgCanvas = document.getElementById('webgazerVideoCanvas');
  if (wgVid && wgCanvas) {
    const setSize = () => {
      if (wgVid.videoWidth > 0) {
        wgCanvas.width  = wgVid.videoWidth;
        wgCanvas.height = wgVid.videoHeight;
        setStatus('Camera ready — detecting face…');
      }
    };
    setSize();
    wgVid.addEventListener('loadeddata', setSize, { once: true });
    wgVid.addEventListener('resize', setSize);
    wgVid.style.cssText = '';
    document.getElementById('cam-wrap').appendChild(wgVid);
  } else {
    setStatus('Warning: video element not found', '#ffaa00');
  }

  try { webgazer.resume(); } catch (_) {}

  // Warn if no gaze data arrives within 5s of startup
  setTimeout(() => {
    if (_calls === 0) setStatus('No face detected — check camera', '#ff6b6b');
    else if (_gazeSent === 0) setStatus('Face found but gaze null — look at camera', '#ffaa00');
  }, 8000);
})();
