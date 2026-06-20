/**
 * Real Eye-tracking using ml5.js faceMesh
 * Detects face landmarks and calculates gaze from eye positions
 */

let isTracking = false;
let facemesh = null;
let video = null;
let gazeX = 0.5;
let gazeY = 0.5;
let lastEyeDetection = 0;
let detectionLoop = null;

/**
 * Initialize real eye tracking with ml5.js
 */
export async function initEyeTracking(videoElement, zoomLevel = 1.5) {
  if (isTracking) return;

  try {
    console.log('📹 Loading ml5.js eye tracking...');
    
    if (typeof ml5 === 'undefined') {
      await loadML5();
    }

    console.log('✅ ml5.js loaded');

    // Create video element for camera
    video = document.createElement('video');
    video.setAttribute('width', 640);
    video.setAttribute('height', 480);
    video.style.position = 'fixed';
    video.style.bottom = '10px';
    video.style.right = '10px';
    video.style.width = '200px';
    video.style.height = '150px';
    video.style.border = '2px solid #6500B7';
    video.style.borderRadius = '8px';
    video.style.zIndex = '9999';
    video.style.transform = 'scaleX(-1)';

    document.body.appendChild(video);

    console.log('🎥 Requesting camera access...');

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false
    });

    video.srcObject = stream;
    video.play();

    console.log('✅ Camera access granted');
    console.log('💡 Loading face detection model...');

    // Create facemesh - this returns a Promise
    facemesh = await ml5.faceMesh(video);

    console.log('✅ Face detection ready - looking at camera');
    console.log('🔍 Methods available:', Object.keys(facemesh).filter(k => typeof facemesh[k] === 'function'));

    isTracking = true;

    // Start continuous detection using requestAnimationFrame
    const detectFrame = () => {
      if (!isTracking || !video || !facemesh) return;

      // Call predict() method - this is the ml5 v1 API
      facemesh.predict(video).then((predictions) => {
        if (predictions && predictions.length > 0) {
          const face = predictions[0];
          
          // Get landmarks - can be in different formats
          let landmarks = null;
          if (face.landmarks) landmarks = face.landmarks;
          else if (face.keypoints) landmarks = face.keypoints;
          else if (face.scaledMesh) landmarks = face.scaledMesh;

          if (landmarks && landmarks.length > 0) {
            // Eye landmarks in faceMesh: left eye around 130-159, right eye around 359-386
            const leftEyePoints = [33, 130, 133, 159];
            const rightEyePoints = [263, 359, 362, 386];

            let leftEye = null;
            let rightEye = null;

            // Find available eye landmarks
            for (let idx of leftEyePoints) {
              if (landmarks[idx]) {
                leftEye = landmarks[idx];
                break;
              }
            }

            for (let idx of rightEyePoints) {
              if (landmarks[idx]) {
                rightEye = landmarks[idx];
                break;
              }
            }

            if (leftEye && rightEye) {
              // Handle different data formats
              const lx = Array.isArray(leftEye) ? leftEye[0] : leftEye.x;
              const ly = Array.isArray(leftEye) ? leftEye[1] : leftEye.y;
              const rx = Array.isArray(rightEye) ? rightEye[0] : rightEye.x;
              const ry = Array.isArray(rightEye) ? rightEye[1] : rightEye.y;

              // Average eye position
              const avgX = (lx + rx) / 2;
              const avgY = (ly + ry) / 2;

              // Normalize to 0-1 (video is 640x480)
              gazeX = Math.max(0, Math.min(1, avgX / 640));
              gazeY = Math.max(0, Math.min(1, avgY / 480));

              lastEyeDetection = Date.now();

              if (Math.random() < 0.05) {
                console.log(`👁️ Gaze: (${(gazeX * 100).toFixed(0)}%, ${(gazeY * 100).toFixed(0)}%) Eyes: (${lx.toFixed(0)}, ${ly.toFixed(0)}) (${rx.toFixed(0)}, ${ry.toFixed(0)})`);
              }

              updateVideoZoom(videoElement, zoomLevel);
            }
          }
        } else if (Date.now() - lastEyeDetection > 3000) {
          console.log('Looking for face...');
          lastEyeDetection = Date.now();
        }

        // Continue loop
        if (isTracking) {
          detectionLoop = requestAnimationFrame(detectFrame);
        }
      }).catch((err) => {
        console.error('Prediction error:', err);
        if (isTracking) {
          detectionLoop = requestAnimationFrame(detectFrame);
        }
      });
    };

    // Start detection
    detectFrame();

    return true;
  } catch (error) {
    console.error('❌ Eye tracking failed:', error);
    isTracking = false;
    return false;
  }
}

/**
 * Stop eye tracking
 */
export async function stopEyeTracking() {
  isTracking = false;
  if (detectionLoop) cancelAnimationFrame(detectionLoop);
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
  }
  if (video && video.parentElement) {
    video.parentElement.removeChild(video);
  }
  console.log('Eye tracking stopped');
}

/**
 * Update video based on gaze
 */
function updateVideoZoom(videoElement, zoomLevel) {
  if (!videoElement || !isTracking) return;

  const container = videoElement.parentElement;
  if (!container) return;

  const containerWidth = container.offsetWidth;
  const containerHeight = container.offsetHeight;

  const maxPan = (zoomLevel - 1) / 2;
  const panX = (gazeX - 0.5) * maxPan * containerWidth;
  const panY = (gazeY - 0.5) * maxPan * containerHeight;

  videoElement.style.transform = `scale(${zoomLevel}) translate(${panX}px, ${panY}px)`;
  videoElement.style.transformOrigin = 'center';
  videoElement.style.transition = 'none';
}

/**
 * Toggle eye tracking
 */
export async function toggleEyeTracking(videoElement, zoomLevel = 1.5) {
  if (isTracking) {
    await stopEyeTracking();
    if (videoElement) {
      videoElement.style.transform = 'scale(1) translate(0, 0)';
    }
    return false;
  } else {
    return await initEyeTracking(videoElement, zoomLevel);
  }
}

/**
 * Set zoom level
 */
export function setZoomLevel(videoElement, zoomLevel) {
  if (!videoElement) return;

  if (isTracking) {
    updateVideoZoom(videoElement, zoomLevel);
  } else {
    videoElement.style.transform = `scale(${zoomLevel})`;
    videoElement.style.transformOrigin = '50% 50%';
  }
}

/**
 * Check if tracking
 */
export function isTracking_fn() {
  return isTracking;
}

/**
 * Get gaze position
 */
export function getGazePosition() {
  return { x: gazeX, y: gazeY };
}

/**
 * Load ml5.js from CDN
 */
function loadML5() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/ml5@latest/dist/ml5.min.js';
    script.onload = () => {
      console.log('✅ ml5.js script loaded from CDN');
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load ml5.js from CDN'));
    document.head.appendChild(script);
  });
}

