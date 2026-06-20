export function speakWithBrowserTTS(text) {
  if (!('speechSynthesis' in window) || !text) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = 0.95;
  window.speechSynthesis.speak(utterance);
  return true;
}

export async function speakWithDeepgramOrFallback(text) {
  // Hackathon-safe default: browser TTS.
  // Production/credential path: set window.MATCHVISION_USE_DEEPGRAM and implement /api/tts.
  if (!window.MATCHVISION_USE_DEEPGRAM) return speakWithBrowserTTS(text);
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error(`tts API ${response.status}`);
    const blob = await response.blob();
    const audio = new Audio(URL.createObjectURL(blob));
    await audio.play();
    return true;
  } catch (error) {
    console.warn('Deepgram TTS adapter failed, using browser TTS', error);
    return speakWithBrowserTTS(text);
  }
}

export function setupSpeechRecognition({ button, onTranscript }) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    button.disabled = true;
    button.textContent = '🎙️ Voice unavailable in this browser';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  button.addEventListener('click', () => {
    button.textContent = 'Listening...';
    recognition.start();
  });
  recognition.addEventListener('result', (event) => onTranscript(event.results[0][0].transcript));
  recognition.addEventListener('end', () => { button.textContent = '🎙️ Ask with voice'; });
}
