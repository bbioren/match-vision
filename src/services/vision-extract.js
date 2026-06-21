// Capture video frames and ask the vision API for structured match state JSON.

import { interpretMoment } from './match-context.js';

let probeVideo = null;
let probeVideoSrc = '';

function waitForEvent(el, event) {
  return new Promise((resolve) => {
    if (el.readyState >= 2 && event === 'loadeddata') {
      resolve();
      return;
    }
    const handler = () => {
      el.removeEventListener(event, handler);
      resolve();
    };
    el.addEventListener(event, handler);
  });
}

async function ensureProbeVideo(sourceVideo) {
  if (!probeVideo) {
    probeVideo = document.createElement('video');
    probeVideo.muted = true;
    probeVideo.playsInline = true;
    probeVideo.preload = 'auto';
    probeVideo.crossOrigin = sourceVideo.crossOrigin || 'anonymous';
  }
  const src = sourceVideo.currentSrc || sourceVideo.src;
  if (probeVideoSrc !== src) {
    probeVideoSrc = src;
    probeVideo.src = src;
    await waitForEvent(probeVideo, 'loadeddata');
  }
  return probeVideo;
}

export function captureVideoFrame(video, maxWidth = 640) {
  if (!video?.videoWidth) return null;
  const scale = Math.min(1, maxWidth / video.videoWidth);
  const w = Math.round(video.videoWidth * scale);
  const h = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(video, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.72).split(',')[1];
}

// Sample `frameCount` lead-up frames before centerSecond, spaced by `frameInterval`
// frames at `fps`. e.g. count=5, interval=30, fps=30 → t-150, t-120, t-90, t-60, t-30
// frames (oldest first); the newest (t-30) is the current reference frame.
export async function captureVideoFrameSequence(sourceVideo, centerSecond, options = {}) {
  const frameCount = options.frameCount ?? (Number(window.MATCHVISION_VISION_FRAME_COUNT) || 5);
  const frameInterval = options.frameInterval ?? (Number(window.MATCHVISION_VISION_FRAME_INTERVAL) || 30);
  const fps = options.fps ?? (Number(window.MATCHVISION_VIDEO_FPS) || 30);
  const maxWidth = options.maxWidth ?? 640;
  const intervalSeconds = frameInterval / fps;

  const probe = await ensureProbeVideo(sourceVideo);
  const timestamps = [];
  for (let i = frameCount; i >= 1; i -= 1) {
    timestamps.push(Math.max(0, centerSecond - i * intervalSeconds));
  }

  const frames = [];
  for (let i = 0; i < timestamps.length; i += 1) {
    const t = timestamps[i];
    probe.currentTime = t;
    await waitForEvent(probe, 'seeked');
    const imageBase64 = captureVideoFrame(probe, maxWidth);
    if (!imageBase64) continue;
    frames.push({
      atSecond: t,
      timestamp: formatVideoTimestamp(Math.floor(t)),
      imageBase64,
      is_current: i === timestamps.length - 1
    });
  }
  return frames;
}

export async function extractMomentFromFrame({
  imageBase64,
  frames,
  atSecond,
  priorMoments,
  matchContext,
  matchContextRaw
}) {
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      imageBase64,
      frames,
      atSecond,
      priorMoments,
      matchContext,
      matchContextRaw
    })
  });
  if (!response.ok) throw new Error(`extract API ${response.status}`);
  const data = await response.json();
  if (!data.moment) {
    const err = typeof data.error === 'string' ? data.error : JSON.stringify(data.error || data);
    if (err.includes('invalid_api_key') || err.includes('Incorrect API key')) {
      throw new Error('INVALID_API_KEY');
    }
    if (err.includes('model_not_found') || err.includes('does not exist')) {
      throw new Error('MODEL_NOT_FOUND');
    }
    throw new Error(err || 'vision extraction failed');
  }
  if (matchContext && data.moment.source !== 'interpreted') {
    return interpretMoment(data.vlm || data.moment, matchContext);
  }
  return data.moment;
}

export function formatVideoTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function resetProbeVideo() {
  probeVideo = null;
  probeVideoSrc = '';
}
