/**
 * Eye-tracking service for low-vision users
 * Uses WebGazer.js (free, no server needed) for browser-based gaze detection
 * Dynamically zooms and pans video based on where user is looking
 */

let gazeData = { x: 0, y: 0 };
let isGazeTracking = false;
let gazeSamples = [];
let lastUpdateTime = 0;

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
      console.log('Loading WebGazer from CDN...');
      await loadWebGazer();
      console.log('✅ WebGazer loaded');
    }

    isGazeTracking = true;

    // Start WebGazer with simple regression (faster, more reliable)
    console.log('Starting WebGazer.begin()...');
    webgazer.setRegression('ridge');
    webgazer.begin();
    
    console.log('📹 Eye tracking started. Look at the video to control zoom/pan.');
    console.log('💡 Calibration: Look at different parts of the video for ~5 seconds');

    // Add debug tracking for gaze listener
    let gazeListenerFired = false;

    // Listen for gaze data
    webgazer.setGazeListener((data, elapsedTime) => {
      if (!gazeListenerFired) {
        console.log('🔍 Gaze listener fired! Data:', data);
        gazeListenerFired = true;
      }

      if (data == null) {
        console.log('No gaze data yet - calibrating...');
        return;
      }

      gazeData = { x: data.x, y: data.y };
      gazeSamples.push({ ...gazeData, time: Date.now() });

      // Keep only last 5 samples for smoothing (faster response)
      if (gazeSamples.length > 5) gazeSamples.shift();

      // Throttle updates to 20fps
      const now = Date.now();
      if (now - lastUpdateTime > 50) {
        updateVideoZoom(videoElement, zoomLevel);
        lastUpdateTime = now;
      }
    });

    // Also check camera permission
    console.log('🎥 Requesting camera access...');
    
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
  if (!videoElement || gazeSamples.length === 0) return;

  // Smooth gaze data (average last few samples)
  let sumX = 0, sumY = 0;
  gazeSamples.forEach(s => {
    sumX += s.x;
    sumY += s.y;
  });
  const avgGazeX = sumX / gazeSamples.length;
  const avgGazeY = sumY / gazeSamples.length;

  // Get video container (the wrapper we apply transform to)
  const container = videoElement.parentElement;
  if (!container) return;

  const containerWidth = container.offsetWidth;
  const containerHeight = container.offsetHeight;

  // Clamp and normalize gaze to 0-1 range within window
  const gazeX = Math.max(0, Math.min(1, avgGazeX / window.innerWidth));
  const gazeY = Math.max(0, Math.min(1, avgGazeY / window.innerHeight));

  // Calculate how much we can pan
  // At zoom 1.5x, we can pan (zoomLevel - 1) * 50% = 25% in each direction
  const maxPan = (zoomLevel - 1) / 2;

  // Pan based on gaze: if looking left (0), pan left (-maxPan)
  // If looking center (0.5), pan 0
  // If looking right (1), pan right (+maxPan)
  const panX = (gazeX - 0.5) * maxPan * containerWidth;
  const panY = (gazeY - 0.5) * maxPan * containerHeight;

  // Apply transform: zoom first, then pan
  // Use matrix transform for smoother performance
  videoElement.style.transform = `scale(${zoomLevel}) translate(${panX}px, ${panY}px)`;
  videoElement.style.transformOrigin = 'center';
  videoElement.style.transition = 'none'; // Immediate response

  // Debug: log gaze for testing
  if (Math.random() < 0.01) { // Log 1% of updates to avoid spam
    console.log(`Gaze: (${(gazeX * 100).toFixed(0)}%, ${(gazeY * 100).toFixed(0)}%) Pan: (${panX.toFixed(0)}px, ${panY.toFixed(0)}px)`);
  }
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
      console.log('✅ WebGazer script loaded from CDN');
      console.log('Waiting for webgazer to be available...');
      
      // Wait for webgazer to be available
      let attempts = 0;
      const checkWebgazer = setInterval(() => {
        attempts++;
        if (typeof webgazer !== 'undefined') {
          clearInterval(checkWebgazer);
          console.log('✅ webgazer object available');
          // Hide WebGazer's default UI
          if (typeof webgazer !== 'undefined') {
            webgazer.showVideo(false); // Hide camera feed
            webgazer.showPredictionPoints(false); // Hide gaze dots
          }
          resolve();
        } else if (attempts > 50) {
          clearInterval(checkWebgazer);
          console.error('❌ webgazer object not available after 5 seconds');
          reject(new Error('webgazer failed to initialize'));
        }
      }, 100);
    };
    
    script.onerror = (error) => {
      console.error('❌ Failed to load WebGazer from CDN:', error);
      reject(new Error('Failed to load WebGazer from CDN'));
    };
    
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
