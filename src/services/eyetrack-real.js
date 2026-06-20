let isTracking = false;
let facemesh = null;
let cameraVideo = null;
let currentZoomLevel = 2.0;

// Smoothed raw gaze signal
let gazeX = 0.5;
let gazeY = 0.5;
// Accumulated pan position (% of scaled video size)
let currentPanX = 0;
let currentPanY = 0;

let lastEyeDetection = 0;
let lastUpdateTime = 0;
let debugLogged = false;

// Iris moves ~15-25% of eye-socket width for a natural in-frame glance.
const SENSITIVITY = 8;
const SMOOTH = 0.2;
// How fast the video pans per frame at max gaze offset (% of max pan range per frame).
// Lower = slower/smoother. At 30fps, PAN_SPEED=3 means full range in ~0.55s at max offset.
const PAN_SPEED = 3;

function get(p, axis) {
  if (!p) return null;
  return p[axis] !== undefined ? p[axis] : p[axis === 'x' ? 0 : 1];
}

function extractGaze(keypoints) {
  // Eye socket corners — always available in both 468 and 478 point models
  const leftEyeL  = keypoints[33];   // outer corner left eye
  const leftEyeR  = keypoints[133];  // inner corner left eye
  const leftEyeT  = keypoints[159];  // top lid left
  const leftEyeB  = keypoints[145];  // bottom lid left
  const rightEyeL = keypoints[362];  // inner corner right eye
  const rightEyeR = keypoints[263];  // outer corner right eye
  const rightEyeT = keypoints[386];
  const rightEyeB = keypoints[374];

  if (!leftEyeL || !leftEyeR) return null;

  // Iris centers — landmark 468/473 only exist when refineLandmarks:true
  // and only when ml5 exposes all 478 points
  const leftIris  = keypoints[468];
  const rightIris = keypoints[473];
  const hasIris   = !!(leftIris && rightIris &&
                       get(leftIris,'x') !== undefined &&
                       get(leftIris,'x') !== get(leftEyeL,'x')); // not a dup

  let rawX, rawY;

  if (hasIris) {
    // X: iris offset within eye socket — reliable, eye is wide enough for good signal
    const lCX = (get(leftEyeL,'x')  + get(leftEyeR,'x'))  / 2;
    const rCX = (get(rightEyeL,'x') + get(rightEyeR,'x')) / 2;
    const lHW = Math.abs(get(leftEyeR,'x')  - get(leftEyeL,'x'))  / 2 || 1;
    const rHW = Math.abs(get(rightEyeR,'x') - get(rightEyeL,'x')) / 2 || 1;
    rawX = ((get(leftIris,'x') - lCX) / lHW + (get(rightIris,'x') - rCX) / rHW) / 2;

    // Y: socket-relative iris Y is nearly zero (socket height ~10px, iris barely moves).
    // Use absolute iris Y position in the frame instead — responds to head/eye tilt.
    const avgIrisY = (get(leftIris,'y') + get(rightIris,'y')) / 2;
    // Auto-detect pixel coords (>2) vs normalised (0-1)
    const frameH = get(leftEyeL,'y') > 2 ? 480 : 1;
    // Faces typically sit in the 0.25–0.75 range of frame height → scale to -1…1
    rawY = (avgIrisY / frameH - 0.5) * 4;

    if (!debugLogged) console.log('✅ Using iris X + absolute Y for gaze');
  } else {
    // Fallback: use nose tip (1) and eye midpoint as head-direction proxy
    // This is head tracking but better than nothing
    const nose = keypoints[1];
    const midX = (get(leftEyeL,'x') + get(rightEyeR,'x')) / 2;
    const midY = (get(leftEyeL,'y') + get(rightEyeR,'y')) / 2;

    // Normalise to roughly 0-1 (keypoints may be in 0-1 or pixel coords)
    const scaleX = get(leftEyeL,'x') > 1 ? 640 : 1;
    const scaleY = get(leftEyeL,'y') > 1 ? 480 : 1;
    rawX = midX / scaleX - 0.5; // -0.5…0.5 from centre
    rawY = midY / scaleY - 0.5;
    if (!debugLogged) console.log('⚠️ Iris landmarks unavailable, using head position fallback');
  }

  // Map raw offset → 0-1 with sensitivity amplification
  const x = Math.max(0, Math.min(1, 0.5 + rawX * SENSITIVITY * 0.5));
  const y = Math.max(0, Math.min(1, 0.5 + rawY * SENSITIVITY * 0.5));
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

  // Log keypoint structure once so we can see what ml5 actually returns
  if (!debugLogged) {
    debugLogged = true;
    console.log(`👁️ Face detected! keypoints.length=${keypoints.length}`);
    console.log('keypoints[0]:', keypoints[0]);
    console.log('keypoints[33]:', keypoints[33]);   // eye corner
    console.log('keypoints[468]:', keypoints[468]);  // iris center (if available)
    console.log('face keys:', Object.keys(face));
  }

  const gaze = extractGaze(keypoints);
  if (!gaze) return;

  // Exponential smoothing to reduce jitter
  gazeX = gazeX + SMOOTH * (gaze.x - gazeX);
  gazeY = gazeY + SMOOTH * (gaze.y - gazeY);
  lastEyeDetection = Date.now();

  const now = Date.now();
  if (now - lastUpdateTime > 50) { // ~20 fps
    updateVideoZoom(videoElement, currentZoomLevel);
    lastUpdateTime = now;
  }
}

function updateVideoZoom(videoElement, zoomLevel) {
  if (!videoElement || !isTracking) return;

  // Max pan in each direction so edge of zoomed video aligns with container edge
  const edge = (zoomLevel - 1) / zoomLevel * 50;

  // Velocity-based: gaze offset from center drives pan speed, not absolute position.
  // Eyes centered (0.5) → no movement. Eyes off-center → pan toward that side.
  // X: look right (gazeX > 0.5) → pan left (negative). Y: inverted per camera orientation.
  const offsetX = 0.5 - gazeX;   // positive = look left → pan right
  const offsetY = gazeY - 0.5;   // inverted: positive = look down → pan down

  currentPanX = Math.max(-edge, Math.min(edge, currentPanX + offsetX * PAN_SPEED));
  currentPanY = Math.max(-edge, Math.min(edge, currentPanY + offsetY * PAN_SPEED));

  videoElement.style.transform = `scale(${zoomLevel}) translate(${currentPanX}%, ${currentPanY}%)`;
}

export async function initEyeTracking(videoElement, zoomLevel = 2.0) {
  if (isTracking) return true;
  currentZoomLevel = zoomLevel;

  try {
    console.log('📹 Loading ml5.js...');
    if (typeof ml5 === 'undefined') await loadML5();

    // width/height attributes required by MediaPipe to read video frames
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

    // rAF loop with Promise-based detect — 60fps attempts, fastest acquisition
    const loop = async () => {
      if (!isTracking) return;
      try {
        const res = await facemesh.detect(cameraVideo);
        handleResults(res, videoElement);
      } catch (_) {}
      if (isTracking) requestAnimationFrame(loop);
    };
    loop();

    console.log('✅ Eye tracking active');
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
  gazeX = 0.5;
  gazeY = 0.5;
  currentPanX = 0;
  currentPanY = 0;
}

export async function toggleEyeTracking(videoElement, zoomLevel = 2.0) {
  if (isTracking) {
    await stopEyeTracking();
    if (videoElement) videoElement.style.transform = '';
    return false;
  }
  return await initEyeTracking(videoElement, zoomLevel);
}

// Called by the zoom buttons — updates the live zoom level immediately
export function updateZoom(videoElement, zoomLevel) {
  currentZoomLevel = zoomLevel;
  updateVideoZoom(videoElement, zoomLevel);
}

export function setZoomLevel(videoElement, zoomLevel) {
  updateZoom(videoElement, zoomLevel);
}

export function isTrackingActive() { return isTracking; }
export function isTracking_fn()    { return isTracking; }
export function getGazePosition()  { return { x: gazeX, y: gazeY }; }

function loadML5() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/ml5@latest/dist/ml5.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('Failed to load ml5.js'));
    document.head.appendChild(s);
  });
}
