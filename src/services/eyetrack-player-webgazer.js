/**
 * eyetrack-player-webgazer.js
 * Identical to eyetrack-player.js but wired to the WebGazer backend.
 */
import { initEyeTracking, stopEyeTracking, updateZoom, isTrackingActive } from './eyetrack-webgazer.js';

export class EyeTrackingVideoPlayer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.videoElement = null;
    this.zoomLevel = 2.0;
  }

  init(videoUrl) {
    if (this.videoElement) return;

    // Wrapper enforces 16:9 aspect ratio and clips zoom transforms
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `
      position: relative;
      width: 100%;
      aspect-ratio: 16 / 9;
      background: #000;
      border-radius: 16px;
      overflow: hidden;
    `;

    const video = document.createElement('video');
    video.src = videoUrl;
    video.controls = true;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    video.style.cssText = `
      position: absolute;
      top: 0; left: 0;
      width: 100%; height: 100%;
      display: block;
      object-fit: cover;
      transform-origin: center;
      transition: transform 0.15s ease-out;
    `;

    wrapper.appendChild(video);
    this.container.appendChild(wrapper);
    this.videoElement = video;
    this.wrapper = wrapper;
  }

  async toggleTracking(zoomLevel = this.zoomLevel) {
    this.zoomLevel = zoomLevel;
    if (isTrackingActive()) {
      await stopEyeTracking();
      if (this.videoElement) this.videoElement.style.transform = 'scale(1) translate(0,0)';
      return false;
    }
    return await initEyeTracking(this.videoElement, zoomLevel);
  }

  setZoom(level) {
    this.zoomLevel = level;
    if (!this.videoElement) return;
    if (isTrackingActive()) {
      updateZoom(this.videoElement, level);
    } else {
      this.videoElement.style.transform = level === 1 ? '' : `scale(${level})`;
    }
  }

  async destroy() {
    if (isTrackingActive()) await stopEyeTracking();
    if (this.wrapper) this.wrapper.remove();
    this.videoElement = null;
  }
}
