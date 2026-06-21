// MatchVision offscreen document — takes over gaze after the panel closes.
// tabId is encoded in the URL so this works even if the service worker restarts.
// Gaze is sent directly to the content script (no SW hop, no messaging race).
(async () => {
  const tabId = parseInt(new URLSearchParams(location.search).get('tabId'), 10);
  if (!tabId) { console.error('[MV offscreen] no tabId in URL'); return; }

  console.log('[MV offscreen] starting for tab', tabId);

  // Load calibration the panel saved to localStorage (shared extension origin).
  webgazer.params.saveDataAcrossSessions = true;
  webgazer.params.showGazeDot = false;

  let _calls = 0;
  webgazer.setGazeListener((data) => {
    _calls++;
    if (!data) return;
    if (_calls % 30 === 1) {
      console.log('[MV offscreen] gaze', Math.round(data.x), Math.round(data.y));
    }
    // Send directly to the content script — avoids the background SW entirely.
    chrome.tabs.sendMessage(tabId, { type: 'gaze', x: data.x, y: data.y }).catch(() => {});
  });

  webgazer
    .setRegression('ridge')
    .showVideoPreview(true)
    .showFaceOverlay(false)
    .showFaceFeedbackBox(false);

  webgazer.begin().catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  const wgVid = document.getElementById('webgazerVideoFeed');
  const wgCanvas = document.getElementById('webgazerVideoCanvas');
  if (wgVid && wgCanvas) {
    const setSize = () => {
      if (wgVid.videoWidth > 0) {
        wgCanvas.width  = wgVid.videoWidth;
        wgCanvas.height = wgVid.videoHeight;
        console.log('[MV offscreen] canvas', wgCanvas.width, 'x', wgCanvas.height);
      }
    };
    setSize();
    wgVid.addEventListener('loadeddata', setSize, { once: true });
    wgVid.addEventListener('resize', setSize);
  }

  try { webgazer.resume(); } catch (_) {}
  console.log('[MV offscreen] WebGazer running');
})();
