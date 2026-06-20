/**
 * Real Eye-tracking using tracking.js
 * Detects eyes in video stream and calculates gaze position
 */

let isTracking = false;
let tracker = null;
let video = null;
let canvas = null;
let gazeX = 0.5;
let gazeY = 0.5;

/**
 * Initialize real eye tracking with tracking.js
 */
export async function initEyeTracking(videoElement, zoomLevel = 1.5) {
  if (isTracking) return;

  try {
    console.log('📹 Loading eye tracking library...');
    
    // Load tracking.js from CDN
    if (typeof tracking === 'undefined') {
      await loadTrackingLibrary();
    }

    console.log('✅ Tracking library loaded');

    // Create video element for camera
    video = document.createElement('video');
    video.setAttribute('width', 320);
    video.setAttribute('height', 240);
    video.style.display = 'none';

    // Create canvas for tracking visualization
    canvas = document.createElement('canvas');
    canvas.setAttribute('width', 320);
    canvas.setAttribute('height', 240);
    canvas.style.display = 'none';

    document.body.appendChild(video);
    document.body.appendChild(canvas);

    // Create eye tracker
    tracker = new tracking.ObjectTracker(['eye']);
    tracker.setInitialScale(4);
    tracker.setStepSize(5);
    tracker.setEdgesDensity(0.1);

    console.log('🎥 Requesting camera access...');

    // Get camera stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240 },
      audio: false
    });

    video.srcObject = stream;
    video.play();

    console.log('✅ Camera access granted');
    console.log('💡 Look at the screen and blink to start tracking');

    isTracking = true;

    // Start tracking
    video.onplay = () => {
      tracking.track(video, tracker);

      tracker.on('track', (event) => {
        if (event.data.length > 0) {
          // Calculate gaze position from detected eyes
          let sumX = 0;
          let sumY = 0;
          
          event.data.forEach((rect) => {
            sumX += rect.x + rect.width / 2;
            sumY += rect.y + rect.height / 2;
          });

          gazeX = (sumX / event.data.length) / 320;
          gazeY = (sumY / event.data.length) / 240;

          // Clamp to 0-1
          gazeX = Math.max(0, Math.min(1, gazeX));
          gazeY = Math.max(0, Math.min(1, gazeY));

          console.log(`👁️ Eyes detected. Gaze: (${(gazeX * 100).toFixed(0)}%, ${(gazeY * 100).toFixed(0)}%)`);

          updateVideoZoom(videoElement, zoomLevel);
        } else {
          console.log('Looking for eyes...');
        }
      });
    };

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
  if (tracker) {
    tracking.stopTracking();
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
 * Load tracking.js from CDN
 */
function loadTrackingLibrary() {
  return new Promise((resolve, reject) => {
    // Load tracking.js
    const script1 = document.createElement('script');
    script1.src = 'https://cdnjs.cloudflare.com/ajax/libs/tracking.js/1.8.8/tracking.min.js';
    script1.onload = () => {
      // Load eye tracking module
      const script2 = document.createElement('script');
      script2.src = 'https://cdnjs.cloudflare.com/ajax/libs/tracking.js/1.8.8/data/eye.min.js';
      script2.onload = () => {
        console.log('✅ tracking.js and eye.js loaded');
        resolve();
      };
      script2.onerror = () => reject(new Error('Failed to load eye.js'));
      document.head.appendChild(script2);
    };
    script1.onerror = () => reject(new Error('Failed to load tracking.js'));
    document.head.appendChild(script1);
  });
}
