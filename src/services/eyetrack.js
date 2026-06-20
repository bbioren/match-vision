/**
 * Eye-tracking service for low-vision users
 * Uses WebGazer.js (free, no server needed) for browser-based gaze detection
 * Dynamically zooms and pans video based on where user is looking
 */

let gazeData = { x: 0, y: 0 };
let isGazeTracking = false;
let gazeSamples = [];

/**
 * Initialize WebGazer and start eye tracking
 * @param {HTMLElement} videoElement - The video to zoom/pan
 * @param {number} zoomLevel - Default zoom (1.5 = 150% zoom)
 * @returns {Promise<void>}
 */
export async function initEyeTracking(videoElement, zoomLevel = 1.5) {
  if (isGazeTracking) return;

  try {
    // Load WebGazer from CDN if not already loaded
    if (typeof webgazer === 'undefined') {
      await loadWebGazer();
    }

    isGazeTracking = true;

    // Start WebGazer
    await webgazer.setRegression('ridge');
    await webgazer.begin();

    // Calibration prompt (optional, can skip)
    console.log('📹 Eye tracking started. Look at the video to control zoom/pan.');

    // Listen for gaze data
    webgazer.setGazeListener((data, elapsedTime) => {
      if (data == null) return;

      gazeData = { x: data.x, y: data.y };
      gazeSamples.push(gazeData);

      // Keep only last 10 samples for smoothing
      if (gazeSamples.length > 10) gazeSamples.shift();

      // Update video zoom/pan based on gaze
      updateVideoZoom(videoElement, zoomLevel);
    });

    return true;
  } catch (error) {
    console.error('❌ Eye tracking failed:', error);
    isGazeTracking = false;
    return false;
  }
}

/**
 * Stop eye tracking
 */
export async function stopEyeTracking() {
  if (typeof webgazer !== 'undefined') {
    await webgazer.stop();
  }
  isGazeTracking = false;
  gazeSamples = [];
}

/**
 * Update video zoom and pan based on gaze position
 * @param {HTMLElement} videoElement - The video to transform
 * @param {number} zoomLevel - Zoom multiplier (1.5 = 150%)
 */
function updateVideoZoom(videoElement, zoomLevel) {
  if (!videoElement) return;

  // Smooth gaze data (average last few samples)
  const avgGaze = gazeSamples.reduce(
    (acc, s) => ({
      x: acc.x + s.x / gazeSamples.length,
      y: acc.y + s.y / gazeSamples.length
    }),
    { x: 0, y: 0 }
  );

  // Get video container dimensions
  const container = videoElement.parentElement;
  const containerWidth = container.offsetWidth;
  const containerHeight = container.offsetHeight;

  // Normalize gaze to 0-1 range
  const gazeX = avgGaze.x / window.innerWidth; // 0 = left, 1 = right
  const gazeY = avgGaze.y / window.innerHeight; // 0 = top, 1 = bottom

  // Calculate pan offset (where to center the zoom)
  // If user looks at left (gazeX=0), pan left
  // If user looks at right (gazeX=1), pan right
  const maxPanX = (zoomLevel - 1) * containerWidth * 0.5;
  const maxPanY = (zoomLevel - 1) * containerHeight * 0.5;

  const panX = (gazeX - 0.5) * maxPanX * 2;
  const panY = (gazeY - 0.5) * maxPanY * 2;

  // Apply transform: zoom + pan
  videoElement.style.transform = `
    scale(${zoomLevel})
    translate(${panX / zoomLevel}px, ${panY / zoomLevel}px)
  `;
  videoElement.style.transformOrigin = '50% 50%';
  videoElement.style.transition = 'transform 0.1s ease-out';
}

/**
 * Toggle eye tracking on/off
 */
export async function toggleEyeTracking(videoElement, zoomLevel = 1.5) {
  if (isGazeTracking) {
    await stopEyeTracking();
    // Reset video transform
    if (videoElement) {
      videoElement.style.transform = 'scale(1) translate(0, 0)';
    }
    return false;
  } else {
    return await initEyeTracking(videoElement, zoomLevel);
  }
}

/**
 * Get current gaze position (for debugging/UI)
 */
export function getGazePosition() {
  return gazeData;
}

/**
 * Check if eye tracking is active
 */
export function isTracking() {
  return isGazeTracking;
}

/**
 * Load WebGazer library from CDN
 */
function loadWebGazer() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://webgazer.cs.brown.edu/webgazer.js';
    script.async = true;
    script.onload = () => {
      // Hide WebGazer's default UI
      if (typeof webgazer !== 'undefined') {
        webgazer.showVideo(false); // Hide camera feed
        webgazer.showPredictionPoints(false); // Hide gaze dots
      }
      resolve();
    };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

/**
 * Manual zoom control (for users who prefer buttons)
 */
export function setZoomLevel(videoElement, zoomLevel) {
  if (!videoElement) return;

  if (isGazeTracking) {
    // If tracking, gaze will control pan with new zoom
    updateVideoZoom(videoElement, zoomLevel);
  } else {
    // If not tracking, just zoom to center
    videoElement.style.transform = `scale(${zoomLevel})`;
    videoElement.style.transformOrigin = '50% 50%';
  }
}

/**
 * Calibration helper: Show calibration points for user
 */
export async function runCalibration() {
  if (typeof webgazer !== 'undefined' && webgazer.calibration) {
    return webgazer.calibration.displayCalibrationPoint(640, 360);
  }
  return false;
}
