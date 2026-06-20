/**
 * SIMPLIFIED Eye-tracking without WebGazer
 * Uses cursor position as a proxy for gaze (for demo purposes)
 * In production, would integrate with actual eye-tracking hardware/ML
 */

let isTracking = false;
let lastMouseX = window.innerWidth / 2;
let lastMouseY = window.innerHeight / 2;

/**
 * Initialize simplified eye tracking (uses mouse as proxy)
 */
export async function initEyeTracking(videoElement, zoomLevel = 1.5) {
  if (isTracking) return;

  isTracking = true;
  console.log('📹 Eye tracking started (using cursor position as gaze proxy)');
  console.log('💡 Move your cursor around the screen to control video pan');

  // Track mouse position
  document.addEventListener('mousemove', (e) => {
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
    updateVideoZoom(videoElement, zoomLevel);
  });

  return true;
}

/**
 * Stop eye tracking
 */
export async function stopEyeTracking() {
  isTracking = false;
  console.log('Eye tracking stopped');
}

/**
 * Update video zoom and pan based on mouse position
 */
function updateVideoZoom(videoElement, zoomLevel) {
  if (!videoElement || !isTracking) return;

  const container = videoElement.parentElement;
  if (!container) return;

  const containerWidth = container.offsetWidth;
  const containerHeight = container.offsetHeight;

  // Normalize mouse to 0-1 range
  const mouseX = Math.max(0, Math.min(1, lastMouseX / window.innerWidth));
  const mouseY = Math.max(0, Math.min(1, lastMouseY / window.innerHeight));

  // Calculate pan (same as eye tracking)
  const maxPan = (zoomLevel - 1) / 2;
  const panX = (mouseX - 0.5) * maxPan * containerWidth;
  const panY = (mouseY - 0.5) * maxPan * containerHeight;

  // Apply transform
  videoElement.style.transform = `scale(${zoomLevel}) translate(${panX}px, ${panY}px)`;
  videoElement.style.transformOrigin = 'center';
  videoElement.style.transition = 'none';

  // Debug logging (1% of updates)
  if (Math.random() < 0.01) {
    console.log(`Cursor: (${(mouseX * 100).toFixed(0)}%, ${(mouseY * 100).toFixed(0)}%) Pan: (${panX.toFixed(0)}px, ${panY.toFixed(0)}px)`);
  }
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
 * Get current position
 */
export function getGazePosition() {
  return { x: lastMouseX, y: lastMouseY };
}
