// MatchVision Side Panel
(async () => {
  let isTracking = false;
  let activeTabId = null;
  let calibDoneResolve = null;
  let zoomLevel = 2.0;
  const params = { panSpeed: 6, kP: 0.08, kI: 0.02, kD: 0.04, gazeSmooth: 0.12 };

  const statusEl = document.getElementById('status');
  const toggleBtn = document.getElementById('toggle');
  const zinBtn    = document.getElementById('zin');
  const zoutBtn   = document.getElementById('zout');
  const zresetBtn = document.getElementById('zreset');
  const zmSlider  = document.getElementById('zm');
  const zmVal     = document.getElementById('zm-val');
  const smSlider  = document.getElementById('sm');
  const smVal     = document.getElementById('sm-val');
  const spSlider  = document.getElementById('sp');
  const spVal     = document.getElementById('sp-val');
  const kpSlider  = document.getElementById('kp');
  const kpVal     = document.getElementById('kp-val');
  const kiSlider  = document.getElementById('ki');
  const kiVal     = document.getElementById('ki-val');
  const kdSlider  = document.getElementById('kd');
  const kdVal     = document.getElementById('kd-val');
  const camWrap   = document.getElementById('cam-wrap');

  function setStatus(msg, cls = '') {
    statusEl.textContent = msg;
    statusEl.className = cls;
  }

  function sendToTab(msg) {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, msg).catch(e => {
      console.warn('[MV panel] sendToTab failed:', e.message);
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'calibration-point') {
      try { webgazer.recordScreenPosition(msg.x, msg.y, 'click'); } catch (_) {}
    } else if (msg.type === 'calibration-done') {
      if (calibDoneResolve) { calibDoneResolve(); calibDoneResolve = null; }
    }
  });

  toggleBtn.addEventListener('click', async () => {
    if (isTracking) { stopTracking(); return; }
    await startTracking();
  });

  async function startTracking() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { setStatus('No active tab found.', 'error'); return; }
    activeTabId = tab.id;
    console.log('[MV panel] targeting tab', activeTabId, tab.url);

    toggleBtn.disabled = true;
    setStatus('Requesting camera…', 'loading');

    let testStream;
    try {
      testStream = await navigator.mediaDevices.getUserMedia({ video: true });
    } catch (camErr) {
      const denied = camErr.name === 'NotAllowedError' || camErr.name === 'PermissionDeniedError';
      setStatus(
        denied
          ? 'Camera blocked. Open chrome://settings/content/camera and allow this extension, then try again.'
          : 'Camera error: ' + camErr.message,
        'error'
      );
      toggleBtn.disabled = false;
      return;
    }
    testStream.getTracks().forEach(t => t.stop());

    setStatus('Starting WebGazer…', 'loading');

    try {
      let _allCalls = 0;
      webgazer.setGazeListener((data) => {
        _allCalls++;
        if (_allCalls % 30 === 1) {
          console.log('[MV panel] gaze cb #' + _allCalls, data ? `${Math.round(data.x)},${Math.round(data.y)}` : 'null (no face)');
        }
        if (!data || !isTracking) return;
        sendToTab({ type: 'gaze', x: data.x, y: data.y });
      });

      webgazer.params.saveDataAcrossSessions = false;
      try { await webgazer.clearData(); } catch (_) {}

      webgazer
        .setRegression('ridge')
        .showVideoPreview(true)
        .showFaceOverlay(false)
        .showFaceFeedbackBox(false);
      webgazer.params.showGazeDot = false;

      setStatus('Loading gaze models…', 'loading');

      webgazer.begin().catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      const wgVid2 = document.getElementById('webgazerVideoFeed');
      const wgCanvas = document.getElementById('webgazerVideoCanvas');
      if (wgVid2 && wgCanvas) {
        const setSize = () => {
          if (wgVid2.videoWidth > 0) {
            wgCanvas.width  = wgVid2.videoWidth;
            wgCanvas.height = wgVid2.videoHeight;
            console.log('[MV panel] canvas sized to', wgCanvas.width, 'x', wgCanvas.height);
          }
        };
        setSize();
        wgVid2.addEventListener('loadeddata', setSize, { once: true });
        wgVid2.addEventListener('resize', setSize);
      }

      try { webgazer.resume(); } catch (_) {}
      console.log('[MV panel] webgazer started, isReady:', webgazer.isReady(), 'gaze cbs so far:', _allCalls);

      const wgVid = document.getElementById('webgazerVideoFeed');
      if (wgVid) {
        wgVid.style.cssText = '';
        camWrap.appendChild(wgVid);
      }

      setStatus('Look at each dot, then press Space…', 'loading');

      const calibDone = new Promise(r => { calibDoneResolve = r; });
      sendToTab({ type: 'start-calibration' });
      await calibDone;

      console.log('[MV panel] calibration done — starting gaze stream');
      isTracking = true;
      sendToTab({ type: 'start-tracking', zoomLevel, params });

      setStatus('Active — look at the video to pan.', 'active');
      toggleBtn.textContent = 'Stop Tracking';
      toggleBtn.classList.add('on');
      toggleBtn.disabled = false;

    } catch (err) {
      console.error('[MV panel] startTracking error:', err);
      setStatus('Error: ' + err.message, 'error');
      toggleBtn.disabled = false;
      try { webgazer.end(); } catch (_) {}
    }
  }

  function stopTracking() {
    isTracking = false;
    try { webgazer.clearGazeListener(); webgazer.end(); } catch (_) {}
    sendToTab({ type: 'stop-tracking' });
    toggleBtn.textContent = 'Start Eye Tracking';
    toggleBtn.classList.remove('on');
    toggleBtn.disabled = false;
    setStatus('Stopped.', '');
    activeTabId = null;
    camWrap.innerHTML = '';
  }

  function applyZoom(level) {
    zoomLevel = Math.max(1, Math.min(6, level));
    zmSlider.value = zoomLevel;
    zmVal.textContent = zoomLevel.toFixed(1) + '×';
    sendToTab({ type: 'zoom', level: zoomLevel });
  }

  zinBtn.addEventListener('click',   () => applyZoom(zoomLevel + 0.25));
  zoutBtn.addEventListener('click',  () => applyZoom(zoomLevel - 0.25));
  zresetBtn.addEventListener('click', () => { applyZoom(2); sendToTab({ type: 'reset-pan' }); });
  zmSlider.addEventListener('input', () => applyZoom(parseFloat(zmSlider.value)));

  smSlider.addEventListener('input', () => {
    params.gazeSmooth = parseFloat(smSlider.value);
    smVal.textContent = params.gazeSmooth.toFixed(2);
    sendToTab({ type: 'params', data: { gazeSmooth: params.gazeSmooth } });
  });
  spSlider.addEventListener('input', () => {
    params.panSpeed = parseFloat(spSlider.value);
    spVal.textContent = params.panSpeed;
    sendToTab({ type: 'params', data: { panSpeed: params.panSpeed } });
  });
  kpSlider.addEventListener('input', () => {
    params.kP = parseFloat(kpSlider.value);
    kpVal.textContent = params.kP.toFixed(2);
    sendToTab({ type: 'params', data: { kP: params.kP } });
  });
  kiSlider.addEventListener('input', () => {
    params.kI = parseFloat(kiSlider.value);
    kiVal.textContent = params.kI.toFixed(3);
    sendToTab({ type: 'params', data: { kI: params.kI } });
  });
  kdSlider.addEventListener('input', () => {
    params.kD = parseFloat(kdSlider.value);
    kdVal.textContent = params.kD.toFixed(3);
    sendToTab({ type: 'params', data: { kD: params.kD } });
  });
})();
