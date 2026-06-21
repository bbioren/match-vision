// Capture a video frame and ask the vision API for structured match state JSON.

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

export async function extractMomentFromFrame({ imageBase64, atSecond }) {
  const response = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, atSecond })
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
  return data.moment;
}

export function formatVideoTimestamp(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
