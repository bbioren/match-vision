let isTracking = false;
let facemesh = null;
let cameraVideo = null;
let currentZoomLevel = 2.0;

let gazeX = 0.5;
let gazeY = 0.5;
let currentPanX = 0;
let currentPanY = 0;

let lastEyeDetection = 0;
let lastUpdateTime = 0;
let firstFaceLogged = false;
let debugDotEl = null;
let hudEl = null;

// Module-level debug state updated every frame — safe to read from setInterval
let _dbg = { irisY: 0, lSocketH: 0, lRatio: 0, rRatio: 0, rawY: 0 };

const params = {
  sensitivityX: 30,
  sensitivityY: 8,
  smooth:       0.1,
  panSpeed:     6,
  biasY:        0.0,  // start at 0 — tune up if video drifts when eyes are centered
};

function get(p, axis) {
  if (!p) return null;
  return p[axis] !== undefined ? p[axis] : p[axis === 'x' ? 0 : 1];
}

function extractGaze(keypoints) {
  const leftEyeL  = keypoints[33];
  const leftEyeR  = keypoints[133];
  const leftEyeT  = keypoints[159];
  const leftEyeB  = keypoints[145];
  const rightEyeL = keypoints[362];
  const rightEyeR = keypoints[263];
  const rightEyeT = keypoints[386];
  const rightEyeB = keypoints[374];

  if (!leftEyeL || !leftEyeR) return null;

  const leftIris  = keypoints[468];
  const rightIris = keypoints[473];
  const hasIris   = !!(leftIris && rightIris &&
                       get(leftIris,'x') !== undefined &&
                       get(leftIris,'x') !== get(leftEyeL,'x'));

  let rawX, rawY;

  if (hasIris) {
    // X: iris offset from socket center, normalised by half-socket-width
    const lCX = (get(leftEyeL,'x') + get(leftEyeR,'x')) / 2;
    const rCX = (get(rightEyeL,'x') + get(rightEyeR,'x')) / 2;
    const lHW = Math.abs(get(leftEyeR,'x') - get(leftEyeL,'x')) / 2 || 1;
    const rHW = Math.abs(get(rightEyeR,'x') - get(rightEyeL,'x')) / 2 || 1;
    rawX = ((get(leftIris,'x') - lCX) / lHW + (get(rightIris,'x') - rCX) / rHW) / 2;

    // Y: lid-gap ratio — iris vertical position within the eye opening.
    // Eyelids follow the iris but less than the iris itself moves, so the
    // ratio shifts ~0.1-0.2 for a full glance. 0=iris at top, 1=iris at bottom.
    const lSocketH = (get(leftEyeB,'y')  - get(leftEyeT,'y'))  || 1;
    const rSocketH = (get(rightEyeB,'y') - get(rightEyeT,'y')) || 1;
    const lRatio   = (get(leftIris,'y')  - get(leftEyeT,'y'))  / lSocketH;
    const rRatio   = (get(rightIris,'y') - get(rightEyeT,'y')) / rSocketH;
    rawY = -((lRatio - 0.5) + (rRatio - 0.5)) / 2; // negated: up=negative, down=positive

    // Update module-level debug state (closure-safe for intervals)
    _dbg.irisY    = get(leftIris, 'y');
    _dbg.lSocketH = lSocketH;
    _dbg.lRatio   = lRatio;
    _dbg.rRatio   = rRatio;
    _dbg.rawY     = rawY;
  } else {
    // Fallback: head position proxy
    const midX = (get(leftEyeL,'x') + get(rightEyeR,'x')) / 2;
    const midY = (get(leftEyeL,'y') + get(rightEyeR,'y')) / 2;
    const scaleX = get(leftEyeL,'x') > 1 ? 640 : 1;
    const scaleY = get(leftEyeL,'y') > 1 ? 480 : 1;
    rawX = midX / scaleX - 0.5;
    rawY = midY / scaleY - 0.5;
    if (!firstFaceLogged) console.log('⚠️ Iris landmarks unavailable, using head position fallback');
  }

  const x = Math.max(0, Math.min(1, 0.5 + rawX * params.sensitivityX * 0.5));
  const y = Math.max(0, Math.min(1, 0.5 + rawY * params.sensitivityY * 0.5));
  return { x, y };
}

function handleResults(results, videoElement) {
  if (!results || results.length === 0) {
    if (Date.now() - lastEyeDetection > 2000) {
      console.log('👁️ Looking for face...');
      lastEyeDetection = Date.now();
    }
    return;
  }

  const face = results[0];
  const keypoints = face.keypoints || face.landmarks || face.scaledMesh;
  if (!keypoints || keypoints.length === 0) return;

  if (!firstFaceLogged) {
    firstFaceLogged = true;
    console.log(`👁️ Face detected! keypoints.length=${keypoints.length}`);
    console.log('keypoints[33] (eye corner):', keypoints[33]);
    console.log('keypoints[159] (top lid):', keypoints[159]);
    console.log('keypoints[145] (bot lid):', keypoints[145]);
    console.log('keypoints[468] (iris):', keypoints[468]);
  }

  const gaze = extractGaze(keypoints);
  if (!gaze) return;

  gazeX = gazeX + params.smooth * (gaze.x - gazeX);
  gazeY = gazeY + params.smooth * (gaze.y - gazeY);
  lastEyeDetection = Date.now();

  const now = Date.now();
  if (now - lastUpdateTime > 50) {
    updateVideoZoom(videoElement, currentZoomLevel);
    lastUpdateTime = now;
  }
}

function updateVideoZoom(videoElement, zoomLevel) {
  if (!videoElement || !isTracking) return;

  const edge = (zoomLevel - 1) / zoomLevel * 50;
  const offsetX = 0.5 - gazeX;
  const offsetY = (0.5 + params.biasY) - gazeY;

  currentPanX = Math.max(-edge, Math.min(edge, currentPanX + offsetX * params.panSpeed));
  currentPanY = Math.max(-edge, Math.min(edge, currentPanY + offsetY * params.panSpeed));

  videoElement.style.transform = `scale(${zoomLevel}) translate(${currentPanX}%, ${currentPanY}%)`;

  if (debugDotEl) {
    const container = videoElement.parentElement;
    debugDotEl.style.left = `${gazeX * container.offsetWidth}px`;
    debugDotEl.style.top  = `${gazeY * container.offsetHeight}px`;
  }

  if (hudEl) {
    hudEl.textContent =
      `gaze X=${gazeX.toFixed(2)} Y=${gazeY.toFixed(2)} | ` +
      `rawY=${_dbg.rawY.toFixed(3)} lR=${_dbg.lRatio.toFixed(2)} rR=${_dbg.rRatio.toFixed(2)} ` +
      `sockH=${_dbg.lSocketH.toFixed(0)}px irisY=${_dbg.irisY.toFixed(0)}px`;
  }
}

export async function initEyeTracking(videoElement, zoomLevel = 2.0) {
  if (isTracking) return true;
  currentZoomLevel = zoomLevel;

  try {
    console.log('📹 Loading ml5.js...');
    if (typeof ml5 === 'undefined') await loadML5();

    cameraVideo = document.createElement('video');
    cameraVideo.setAttribute('width', '640');
    cameraVideo.setAttribute('height', '480');
    Object.assign(cameraVideo.style, {
      position: 'fixed', bottom: '12px', right: '12px',
      width: '160px', height: '120px',
      border: '2px solid rgba(112,225,255,.5)', borderRadius: '8px',
      zIndex: '9999', transform: 'scaleX(-1)', objectFit: 'cover'
    });
    document.body.appendChild(cameraVideo);

    const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    isTracking = true;

    facemesh = await ml5.faceMesh({ maxFaces: 1, refineLandmarks: true, flipped: true });

    // Log live values every 500ms — reads module-level _dbg so values are always current
    const logInterval = setInterval(() => {
      if (!isTracking) { clearInterval(logInterval); return; }
      console.log(
        `irisY=${_dbg.irisY.toFixed(1)}  sockH=${_dbg.lSocketH.toFixed(1)}  ` +
        `lRatio=${_dbg.lRatio.toFixed(3)}  rawY=${_dbg.rawY.toFixed(4)}  ` +
        `gazeY=${gazeY.toFixed(3)}  panY=${currentPanY.toFixed(1)}`
      );
    }, 500);

    const loop = async () => {
      if (!isTracking) return;
      try {
        const res = await facemesh.detect(cameraVideo);
        handleResults(res, videoElement);
      } catch (_) {}
      if (isTracking) requestAnimationFrame(loop);
    };
    loop();

    console.log('✅ Eye tracking active — watch console for live irisY / rawY values');
    return true;
  } catch (err) {
    console.error('❌ Eye tracking failed:', err);
    isTracking = false;
    return false;
  }
}

export async function stopEyeTracking() {
  isTracking = false;
  if (facemesh && typeof facemesh.detectStop === 'function') facemesh.detectStop();
  if (cameraVideo?.srcObject) cameraVideo.srcObject.getTracks().forEach(t => t.stop());
  if (cameraVideo?.parentElement) cameraVideo.remove();
  cameraVideo = null;
  gazeX = 0.5; gazeY = 0.5;
  currentPanX = 0; currentPanY = 0;
  firstFaceLogged = false;
  _dbg = { irisY: 0, lSocketH: 0, lRatio: 0, rRatio: 0, rawY: 0 };
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
  updateVideoZoom(videoElement, zoomLevel);
}

export function setZoomLevel(videoElement, zoomLevel) { updateZoom(videoElement, zoomLevel); }
export function isTrackingActive() { return isTracking; }
export function isTracking_fn()    { return isTracking; }
export function getGazePosition()  { return { x: gazeX, y: gazeY }; }
export function setDebugDot(el)    { debugDotEl = el; }
export function setDebugHud(el)    { hudEl = el; }

export function setParams({ sensitivityX, sensitivityY, smooth, panSpeed, biasY } = {}) {
  if (sensitivityX !== undefined) params.sensitivityX = sensitivityX;
  if (sensitivityY !== undefined) params.sensitivityY = sensitivityY;
  if (smooth       !== undefined) params.smooth       = smooth;
  if (panSpeed     !== undefined) params.panSpeed     = panSpeed;
  if (biasY        !== undefined) params.biasY        = biasY;
}

function loadML5() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/ml5@latest/dist/ml5.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ml5.js'));
    document.head.appendChild(s);
  });
}
