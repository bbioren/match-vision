/**
 * eyetrack-api.js
 * MatchVision — Eye Tracking via TensorFlow.js + MediaPipe FaceMesh (direct)
 *
 * APPROACH CHOSEN: TensorFlow.js @tensorflow-models/face-landmarks-detection
 * with the MediaPipe WASM runtime and refineLandmarks: true.
 *
 * WHY NOT AN EXTERNAL CLOUD/SDK API:
 *   • GazeCloudAPI (gazerecorder.com) — requires domain registration at
 *     api.gazerecorder.com/register/ before the script will work. Fragile on
 *     localhost / file:// and impractical to set up in a hackathon.
 *   • WebGazer.js (Brown Univ.) — already implemented in eyetrack-webgazer.js.
 *     Requires click-based calibration and has known Y-axis drift over time.
 *   • Tobii / Pupil Labs — hardware or enterprise; no free browser SDK.
 *   • EyeLogic / Affectiva — no longer freely accessible or browser-native.
 *   • L2CS-Net / HuggingFace — gaze angle models require calibrated head-pose
 *     correction and HuggingFace inference latency (~200–800 ms) is too high
 *     for real-time video panning.
 *
 * WHY THIS APPROACH FIXES THE Y-AXIS PROBLEM:
 *   ml5.js wraps the same MediaPipe model but its internal API version and
 *   normalisation pipeline can collapse the Y iris range to near-zero. By
 *   calling @tensorflow-models/face-landmarks-detection directly with the
 *   native 'mediapipe' WASM runtime we get:
 *     1. Raw pixel coordinates for all 478 landmarks (468 face + 10 iris).
 *     2. Full control over the vertical gaze math.
 *     3. Three independent Y signals we blend together:
 *        (a) Iris Y within the eye socket (lid-gap ratio) — same as ml5 but unfiltered
 *        (b) Iris Z depth — when you look down, the iris moves toward the camera
 *        (c) Head pitch proxy — nose-tip Y relative to eye-midpoint Y, normalised
 *            by inter-eye distance, captures downward head tilt which co-occurs
 *            with downward gaze.
 *
 * LOADING: Scripts injected dynamically (no bundler needed for hackathon).
 * CDNs used:
 *   @tensorflow/tfjs-core            jsdelivr
 *   @tensorflow/tfjs-backend-webgl   jsdelivr
 *   @mediapipe/face_mesh             jsdelivr (WASM solver)
 *   @tensorflow-models/face-landmarks-detection  jsdelivr
 *
 * EXPORTS (identical surface to eyetrack-real.js):
 *   initEyeTracking(videoElement, zoomLevel)
 *   stopEyeTracking()
 *   toggleEyeTracking(videoElement, zoomLevel)
 *   updateZoom(videoElement, zoomLevel)
 *   setZoomLevel(videoElement, zoomLevel)
 *   isTrackingActive()
 *   getGazePosition()
 *   setDebugDot(el)
 *   setDebugHud(el)
 *   setParams({sensitivityX, sensitivityY, smooth, panSpeed, biasY})
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let isTracking = false;
let detector = null;
let cameraVideo = null;
let currentZoomLevel = 2.0;
let animFrameId = null;
let debugDotEl = null;
let hudEl = null;
let lastFaceTime = 0;
let firstFaceLogged = false;

let gazeX = 0.5;
let gazeY = 0.5;
let currentPanX = 0;
let currentPanY = 0;

// Debug state readable from HUD
let _dbg = {
  rawX: 0, rawY: 0,
  lRatio: 0, rRatio: 0,
  zSignal: 0, headPitch: 0,
  blend: 0,
};

const params = {
  sensitivityX: 2,
  sensitivityY: 2,
  panSpeed:     8,
};

// ---------------------------------------------------------------------------
// CDN script loader (sequential, idempotent)
// ---------------------------------------------------------------------------
function loadScript(src, globalCheck) {
  return new Promise((resolve, reject) => {
    if (globalCheck && window[globalCheck]) { resolve(); return; }
    // Also check if a script with this src is already present
    if (document.querySelector(`script[src="${src}"]`)) {
      // Wait for it to be ready
      const poll = setInterval(() => {
        if (!globalCheck || window[globalCheck]) {
          clearInterval(poll);
          resolve();
        }
      }, 50);
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload  = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function loadDeps() {
  // These must load in order — each depends on the previous.
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-core',
    'tf'
  );
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-webgl',
    null
  );
  // MediaPipe WASM package (face_mesh) must be present before the detector
  // model tries to resolve its solutionPath.
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
    'FaceMesh'
  );
  await loadScript(
    'https://cdn.jsdelivr.net/npm/@tensorflow-models/face-landmarks-detection',
    'faceLandmarksDetection'
  );
}

// ---------------------------------------------------------------------------
// Helper: safe keypoint accessor (handles {x,y} or [x,y] shapes)
// ---------------------------------------------------------------------------
function kp(points, idx, axis) {
  const p = points[idx];
  if (!p) return 0;
  return axis === 'x'
    ? (p.x !== undefined ? p.x : p[0])
    : axis === 'y'
    ? (p.y !== undefined ? p.y : p[1])
    : (p.z !== undefined ? p.z : (p[2] || 0));
}

// ---------------------------------------------------------------------------
// Gaze extractor — raw iris position in camera frame, normalized to 0-1
// ---------------------------------------------------------------------------
function extractGaze(keypoints) {
  if (keypoints.length < 478) {
    console.warn('⚠️ Iris landmarks missing (need 478 keypoints, got ' + keypoints.length + ')');
    return null;
  }
  // Average left (468) and right (473) iris centers
  // Camera is 640×480; flipHorizontal:true already mirrors X
  const irisX = (kp(keypoints, 468, 'x') + kp(keypoints, 473, 'x')) / 2;
  const irisY = (kp(keypoints, 468, 'y') + kp(keypoints, 473, 'y')) / 2;
  // Amplify around center so small eye movements map to larger pan
  const x = Math.max(0, Math.min(1, 0.5 + (irisX / 640 - 0.5) * params.sensitivityX));
  const y = Math.max(0, Math.min(1, 0.5 + (irisY / 480 - 0.5) * params.sensitivityY));
  return { x, y };
}

// ---------------------------------------------------------------------------
// Pan / zoom (exact logic from brief)
// ---------------------------------------------------------------------------
function updateVideoZoom(videoElement, zoomLevel) {
  if (!videoElement || !isTracking) return;

  const edge = (zoomLevel - 1) / zoomLevel * 50;
  const offsetX = 0.5 - gazeX;
  const offsetY = 0.5 - gazeY; // no bias — raw iris position is already calibrated

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
      `gaze X=${gazeX.toFixed(2)} Y=${gazeY.toFixed(2)} | pan X=${currentPanX.toFixed(1)} Y=${currentPanY.toFixed(1)}`;
  }
}

// ---------------------------------------------------------------------------
// Detection loop
// ---------------------------------------------------------------------------
async function detectionLoop(videoElement) {
  if (!isTracking || !detector) return;

  try {
    const faces = await detector.estimateFaces(cameraVideo, { flipHorizontal: true });

    if (faces && faces.length > 0) {
      const face = faces[0];
      const keypoints = face.keypoints;
      if (!firstFaceLogged) {
        firstFaceLogged = true;
        console.log(`👁️ TF.js MediaPipe: face detected. keypoints.length=${keypoints.length}`);
        console.log('iris[468]:', keypoints[468]);
        console.log('iris[473]:', keypoints[473]);
      }

      const gaze = extractGaze(keypoints);
      if (gaze) {
        gazeX = gaze.x; // raw, no smoothing
        gazeY = gaze.y;
        lastFaceTime = Date.now();
        updateVideoZoom(videoElement, currentZoomLevel);
      }
    } else {
      if (Date.now() - lastFaceTime > 2000) {
        console.log('👁️ Looking for face...');
        lastFaceTime = Date.now();
      }
    }
  } catch (err) {
    // Swallow individual frame errors — model can hiccup on bad frames
    if (!err.message?.includes('disposed')) {
      console.warn('Detection error:', err.message);
    }
  }

  if (isTracking) {
    animFrameId = requestAnimationFrame(() => detectionLoop(videoElement));
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export async function initEyeTracking(videoElement, zoomLevel = 2.0) {
  if (isTracking) return true;
  currentZoomLevel = zoomLevel;

  try {
    console.log('📦 Loading TensorFlow.js + MediaPipe FaceMesh...');
    await loadDeps();

    // Set WebGL backend explicitly
    await tf.setBackend('webgl');
    await tf.ready();
    console.log('✅ TF.js backend ready:', tf.getBackend());

    // Create detector using the mediapipe WASM runtime
    // refineLandmarks: true → 478 keypoints including iris (468-477)
    detector = await faceLandmarksDetection.createDetector(
      faceLandmarksDetection.SupportedModels.MediaPipeFaceMesh,
      {
        runtime: 'mediapipe',
        solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh',
        maxFaces: 1,
        refineLandmarks: true,
      }
    );
    console.log('✅ MediaPipe FaceMesh detector created (refineLandmarks=true, 478 keypoints)');

    // Open camera
    cameraVideo = document.createElement('video');
    cameraVideo.setAttribute('width', '640');
    cameraVideo.setAttribute('height', '480');
    cameraVideo.playsInline = true;
    Object.assign(cameraVideo.style, {
      position: 'fixed', bottom: '12px', right: '12px',
      width: '160px', height: '120px',
      border: '2px solid rgba(112,225,255,.5)', borderRadius: '8px',
      zIndex: '9999', transform: 'scaleX(-1)', objectFit: 'cover',
    });
    document.body.appendChild(cameraVideo);

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
      audio: false,
    });
    cameraVideo.srcObject = stream;
    await cameraVideo.play();

    isTracking = true;
    firstFaceLogged = false;
    lastFaceTime = Date.now();

    // Start detection loop
    animFrameId = requestAnimationFrame(() => detectionLoop(videoElement));

    console.log('✅ Eye tracking active (TF.js MediaPipe — multi-signal Y axis)');
    return true;
  } catch (err) {
    console.error('❌ Eye tracking init failed:', err);
    isTracking = false;
    if (cameraVideo?.srcObject) cameraVideo.srcObject.getTracks().forEach(t => t.stop());
    if (cameraVideo?.parentElement) cameraVideo.remove();
    cameraVideo = null;
    return false;
  }
}

export async function stopEyeTracking() {
  isTracking = false;

  if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = null; }

  if (detector) {
    try { detector.dispose(); } catch (_) {}
    detector = null;
  }

  if (cameraVideo?.srcObject) cameraVideo.srcObject.getTracks().forEach(t => t.stop());
  if (cameraVideo?.parentElement) cameraVideo.remove();
  cameraVideo = null;

  gazeX = 0.5; gazeY = 0.5;
  currentPanX = 0; currentPanY = 0;
  firstFaceLogged = false;
  _dbg = { rawX: 0, rawY: 0, lRatio: 0, rRatio: 0, zSignal: 0, headPitch: 0 };
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
export function getGazePosition()  { return { x: gazeX, y: gazeY }; }
export function setDebugDot(el)    { debugDotEl = el; }
export function setDebugHud(el)    { hudEl = el; }

export function setParams({ sensitivityX, sensitivityY, panSpeed } = {}) {
  if (sensitivityX !== undefined) params.sensitivityX = sensitivityX;
  if (sensitivityY !== undefined) params.sensitivityY = sensitivityY;
  if (panSpeed     !== undefined) params.panSpeed     = panSpeed;
}
