/**
 * Real Eye-tracking using ml5.js
 * Uses machine learning to detect eyes in real-time
 */

let isTracking = false;
let facemesh = null;
let video = null;
let gazeX = 0.5;
let gazeY = 0.5;
let lastEyeDetection = 0;

/**
 * Initialize real eye tracking with ml5.js
 */
export async function initEyeTracking(videoElement, zoomLevel = 1.5) {
  if (isTracking) return;

  try {
    console.log('📹 Loading ml5.js eye tracking...');
    
    // Load ml5.js from CDN
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
    video.style.transform = 'scaleX(-1)'; // Mirror for user perspective

    document.body.appendChild(video);

    console.log('🎥 Requesting camera access...');

    // Get camera stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: false
    });

    video.srcObject = stream;
    video.play();

    console.log('✅ Camera access granted');
    console.log('💡 Face detection starting - look at camera');

    isTracking = true;

    // Create facemesh model
    console.log('Creating facemesh model...');
    facemesh = await ml5.faceMesh({
      maxFaces: 1,
      refineLandmarks: true,
      flipped: false
    });

    console.log('✅ Face detection model ready');

    // Get predictions
    const detectFace = async () => {
      const predictions = await facemesh.estimateFaces(video);
      
      if (predictions && predictions.length > 0) {
        const prediction = predictions[0];
        
        if (prediction.landmarks && prediction.landmarks.length > 0) {
          // Use eye landmarks
          const landmarks = prediction.landmarks;
          const leftEye = landmarks[130] || landmarks[33]; // Eye positions
          const rightEye = landmarks[359] || landmarks[263];

          if (leftEye && rightEye) {
            // Average eye position
            const avgX = (leftEye[0] + rightEye[0]) / 2;
            const avgY = (leftEye[1] + rightEye[1]) / 2;

            // Normalize to 0-1 range
            gazeX = avgX / 640;
            gazeY = avgY / 480;

            // Clamp
            gazeX = Math.max(0, Math.min(1, gazeX));
            gazeY = Math.max(0, Math.min(1, gazeY));

            lastEyeDetection = Date.now();

            // Log every 500ms
            if (Math.random() < 0.02) {
              console.log(`👁️ Gaze: (${(gazeX * 100).toFixed(0)}%, ${(gazeY * 100).toFixed(0)}%)`);
            }

            updateVideoZoom(videoElement, zoomLevel);
          }
        }
      } else {
        if (Date.now() - lastEyeDetection > 2000) {
          console.log('Looking for face...');
          lastEyeDetection = Date.now();
        }
      }

      // Keep detecting
      if (isTracking) {
        requestAnimationFrame(detectFace);
      }
    };

    // Start detection loop
    detectFace();

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

  // Calculate pan
  const maxPan = (zoomLevel - 1) / 2;
  const panX = (gazeX - 0.5) * maxPan * containerWidth;
  const panY = (gazeY - 0.5) * maxPan * containerHeight;

  // Apply transform
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
