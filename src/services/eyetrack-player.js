/**
 * Eye-tracking video player component for low-vision users
 * Integrates eye tracking with soccer video playback
 */

import {
  initEyeTracking,
  stopEyeTracking,
  toggleEyeTracking,
  setZoomLevel,
  isTracking_fn,
  getGazePosition
} from './eyetrack-simple.js';

export class EyeTrackingVideoPlayer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.videoElement = null;
    this.videoWrapper = null;
    this.controls = null;
    this.zoomLevel = 1.5;
    this.isInitialized = false;
  }

  /**
   * Initialize the video player with eye tracking
   */
  async init(videoUrl) {
    if (this.isInitialized) return;

    // Create video wrapper (for zoom/pan transforms)
    this.videoWrapper = document.createElement('div');
    this.videoWrapper.className = 'eyetrack-video-wrapper';
    this.videoWrapper.style.cssText = `
      position: relative;
      width: 100%;
      height: auto;
      aspect-ratio: 16 / 9;
      overflow: hidden;
      background: #000;
      border-radius: 8px;
      margin-bottom: 16px;
    `;

    // Create video element
    this.videoElement = document.createElement('video');
    this.videoElement.src = videoUrl;
    this.videoElement.controls = true;
    this.videoElement.style.cssText = `
      width: 100%;
      height: 100%;
      display: block;
      object-fit: contain;
    `;

    this.videoWrapper.appendChild(this.videoElement);
    this.container.appendChild(this.videoWrapper);

    // Create control panel
    this.createControls();

    this.isInitialized = true;
  }

  /**
   * Create UI controls for eye tracking
   */
  createControls() {
    this.controls = document.createElement('div');
    this.controls.className = 'eyetrack-controls';
    this.controls.style.cssText = `
      display: flex;
      gap: 12px;
      padding: 16px;
      background: #f5f5f5;
      border-radius: 8px;
      margin-bottom: 16px;
      flex-wrap: wrap;
      align-items: center;
    `;

    // Eye tracking toggle button
    const toggleBtn = document.createElement('button');
    toggleBtn.id = 'eyetrack-toggle';
    toggleBtn.textContent = '👁️ Enable Eye Tracking';
    toggleBtn.style.cssText = `
      padding: 10px 16px;
      background: #6500B7;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;

    toggleBtn.addEventListener('click', async () => {
      const enabled = await toggleEyeTracking(this.videoElement, this.zoomLevel);
      toggleBtn.textContent = enabled ? '👁️ Eye Tracking ON' : '👁️ Enable Eye Tracking';
      toggleBtn.style.background = enabled ? '#00aa00' : '#6500B7';
      
      // Disable zoom buttons when eye tracking is on
      this.zoomInBtn.disabled = enabled;
      this.zoomOutBtn.disabled = enabled;
      this.resetBtn.disabled = enabled;

      // Update debug info
      const debugInfo = document.getElementById('debug-info');
      if (debugInfo) {
        debugInfo.textContent = enabled 
          ? '✅ Eye tracking active. Look at different parts of the video. Check console for gaze data.'
          : 'Eye tracking disabled.';
        debugInfo.style.background = enabled ? '#e8f5e9' : '#fff3cd';
      }
    });

    // Zoom in button
    this.zoomInBtn = document.createElement('button');
    this.zoomInBtn.textContent = '🔍+ Zoom In';
    this.zoomInBtn.style.cssText = `
      padding: 10px 16px;
      background: #555;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;

    this.zoomInBtn.addEventListener('click', () => {
      this.zoomLevel = Math.min(this.zoomLevel + 0.25, 3);
      setZoomLevel(this.videoElement, this.zoomLevel);
    });

    // Zoom out button
    this.zoomOutBtn = document.createElement('button');
    this.zoomOutBtn.textContent = '🔍- Zoom Out';
    this.zoomOutBtn.style.cssText = `
      padding: 10px 16px;
      background: #555;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;

    this.zoomOutBtn.addEventListener('click', () => {
      this.zoomLevel = Math.max(this.zoomLevel - 0.25, 1);
      setZoomLevel(this.videoElement, this.zoomLevel);
    });

    // Reset button
    this.resetBtn = document.createElement('button');
    this.resetBtn.textContent = '↺ Reset';
    this.resetBtn.style.cssText = `
      padding: 10px 16px;
      background: #555;
      color: white;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      font-weight: 600;
      font-size: 14px;
    `;

    this.resetBtn.addEventListener('click', () => {
      this.zoomLevel = 1.5;
      setZoomLevel(this.videoElement, this.zoomLevel);
    });

    // Info text
    const infoText = document.createElement('div');
    infoText.style.cssText = `
      font-size: 13px;
      color: #666;
      flex: 1;
      text-align: right;
      font-style: italic;
    `;
    infoText.textContent = '💡 Tip: Enable eye tracking to zoom where you\'re looking. Requires camera + allow permissions.';

    // Add all controls
    this.controls.appendChild(toggleBtn);
    this.controls.appendChild(this.zoomInBtn);
    this.controls.appendChild(this.zoomOutBtn);
    this.controls.appendChild(this.resetBtn);
    this.controls.appendChild(infoText);

    this.container.insertBefore(this.controls, this.container.firstChild);
  }

  /**
   * Cleanup (stop tracking, remove elements)
   */
  async destroy() {
    if (isTracking()) {
      await stopEyeTracking();
    }
    if (this.videoWrapper) {
      this.videoWrapper.remove();
    }
    if (this.controls) {
      this.controls.remove();
    }
    this.isInitialized = false;
  }
}
