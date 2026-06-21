function stripMarkdown(s) {
  return s
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/^[-*+]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_#`~]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Live commentary should move at commentator pace, not audiobook pace.
// Tunable without a code change via window.MATCHVISION_TTS_RATE.
function ttsRate() {
  return Number(window.MATCHVISION_TTS_RATE) || 1.35;
}

let currentUtterance = null;

// Resolves once speech actually FINISHES (not once it starts) so callers can
// await "is it safe to do the next thing" — e.g. unmute the live ticker only
// after a spoken Q&A answer has fully played.
export function speakWithBrowserTTS(text) {
  if (!('speechSynthesis' in window) || !text) return Promise.resolve(false);
  window.speechSynthesis.cancel();
  return new Promise((resolve) => {
    const utterance = new SpeechSynthesisUtterance(stripMarkdown(text));
    utterance.rate = ttsRate();
    currentUtterance = utterance;
    utterance.addEventListener('end', () => resolve(true));
    utterance.addEventListener('error', () => resolve(false));
    window.speechSynthesis.speak(utterance);
  });
}

// Live commentary moments can arrive every 1-2s — without this, overlapping
// Deepgram clips would all play at once and turn into noise. Newest line
// always wins, same "interrupt and say the latest thing" behavior
// speechSynthesis.cancel() already gives the browser-TTS fallback.
let currentDeepgramAudio = null;

export async function speakWithDeepgramOrFallback(text, { shouldSpeak = () => true } = {}) {
  // Hackathon-safe default: browser TTS.
  // Production/credential path: set window.MATCHVISION_USE_DEEPGRAM and implement /api/tts.
  text = stripMarkdown(text);
  if (!window.MATCHVISION_USE_DEEPGRAM) return speakWithBrowserTTS(text);
  try {
    const response = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error(`tts API ${response.status}`);
    const blob = await response.blob();
    // The fetch above is async — by the time it resolves, the caller may no
    // longer want this spoken (e.g. a voice question started muting the
    // ticker mid-flight). Without this check, this call would still pause
    // and replace whatever's currently playing (including a Q&A answer) via
    // currentDeepgramAudio below — and .pause() never fires 'ended'/'error',
    // so the answer's own awaited promise would hang forever.
    if (!shouldSpeak()) return false;
    if (currentDeepgramAudio) {
      currentDeepgramAudio.pause();
      currentDeepgramAudio.src = '';
    }
    const audio = new Audio(URL.createObjectURL(blob));
    currentDeepgramAudio = audio;
    // Deepgram's REST API has no speed parameter — playbackRate is the
    // provider-agnostic way to speed up already-generated audio.
    audio.playbackRate = ttsRate();
    return new Promise((resolve) => {
      audio.addEventListener('ended', () => resolve(true));
      audio.addEventListener('error', () => resolve(false));
      audio.play().catch(() => resolve(false));
    });
  } catch (error) {
    console.warn('Deepgram TTS adapter failed, using browser TTS', error);
    return speakWithBrowserTTS(text);
  }
}

// Interrupts whatever's currently speaking (ticker commentary or a prior
// answer) — used the instant the wake word is heard, so the assistant isn't
// talking over itself while a new question comes in.
export function stopSpeaking() {
  if (currentDeepgramAudio) {
    currentDeepgramAudio.pause();
    currentDeepgramAudio.src = '';
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  currentUtterance = null;
}

// Always-on wake-word listening ("Match Vision, <question>"), like Hey Siri.
// Browser SpeechRecognition's `continuous` mode still stops itself after
// silence/errors, so this restarts automatically until explicitly stopped.
export function setupWakeWordListening({ wakeWord = 'match vision', onQuestion, onStatusChange } = {}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const listeningStatus = () => `🎙️ Always listening — say "${capitalize(wakeWord)}" then your question.`;
  if (!SpeechRecognition) {
    onStatusChange?.('🎙️ Voice unavailable in this browser.');
    return { stop() {} };
  }

  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  const wakeRe = new RegExp(`\\b${wakeWord.replace(/\s+/g, '\\s*')}\\b[,:.!]?\\s*`, 'i');
  let awaitingQuestion = false;
  let stopped = false;
  let restartTimer = null;

  function handleTranscript(transcript) {
    const text = transcript.trim();
    if (!text) return;
    const match = wakeRe.exec(text);
    if (match) {
      const after = text.slice(match.index + match[0].length).trim();
      if (after.length > 2) {
        awaitingQuestion = false;
        onQuestion(after);
      } else {
        // Wake word said alone — capture whatever's said next as the question.
        awaitingQuestion = true;
        onStatusChange?.(`🎙️ Heard "${capitalize(wakeWord)}" — go ahead, ask your question…`);
      }
      return;
    }
    if (awaitingQuestion) {
      awaitingQuestion = false;
      onQuestion(text);
    }
  }

  recognition.addEventListener('result', (event) => {
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      if (result.isFinal) handleTranscript(result[0].transcript);
    }
  });
  recognition.addEventListener('error', (event) => {
    if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
      stopped = true;
      onStatusChange?.('🎙️ Microphone access denied — allow it in your browser to use voice questions.');
    }
    // Transient errors (no-speech, network, audio-capture) just let `end` fire next; we restart there.
  });
  recognition.addEventListener('end', () => {
    if (stopped) return;
    restartTimer = setTimeout(() => {
      try { recognition.start(); } catch { /* already running */ }
    }, 250);
  });

  try {
    recognition.start();
    onStatusChange?.(listeningStatus());
  } catch {
    onStatusChange?.('🎙️ Could not start the microphone.');
  }

  return {
    stop() {
      stopped = true;
      clearTimeout(restartTimer);
      recognition.stop();
    }
  };
}

function capitalize(s) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
