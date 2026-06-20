let logs = [];
let currentUtterance = null;
const MEMORY_KEY = 'matchvision_memory';
const $ = (id) => document.getElementById(id);

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}
function loadMemory() {
  return JSON.parse(localStorage.getItem(MEMORY_KEY) || '[]');
}
function saveMemory(entry) {
  const memory = [entry, ...loadMemory()].slice(0, 5);
  localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  renderMemory();
}
function renderMemory() {
  const el = $('memoryList');
  if (!el) return;
  const memory = loadMemory();
  el.innerHTML = memory.length ? memory.map((m) => `<li><strong>${m.mode}</strong> · ${m.clip}: “${m.question}”</li>`).join('') : '<li>No recent questions yet.</li>';
}
function modeInstruction(mode, log) {
  if (mode === 'brief') return `${log.team_in_possession} are attacking ${log.direction}. The ball is ${log.ball_location}. ${log.event}.`;
  if (mode === 'tactical') return `${log.team_in_possession} are moving ${log.direction}. The key tactical point is spacing: ${log.players}. The immediate danger is that ${log.event}.`;
  if (mode === 'beginner') return `${log.team_in_possession} have the ball and are attacking ${log.direction}. In simple terms: ${log.event}. This matters because ${log.crowd_reason}.`;
  if (mode === 'emotional') return `${log.team_in_possession} are surging ${log.direction}. The ball is ${log.ball_location}, and the moment feels dangerous because ${log.crowd_reason}.`;
  return null;
}
function generateAnswer(log, question) {
  const q = normalize(question);
  const mode = $('modeSelect')?.value || 'balanced';
  if (q.includes('brief')) return modeInstruction('brief', log);
  if (q.includes('tactical') || q.includes('shape')) return modeInstruction('tactical', log);
  const modeAnswer = modeInstruction(mode, log);
  if (modeAnswer && mode !== 'balanced') return modeAnswer;
  for (const [key, answer] of Object.entries(log.questions || {})) {
    if (q.includes(key)) return answer;
  }
  return log.improved_description;
}
function renderClip() {
  const log = logs[$('clipSelect').selectedIndex];
  $('matchState').innerHTML = `
    <dl>
      <dt>Possession</dt><dd>${log.team_in_possession}</dd>
      <dt>Direction</dt><dd>${log.direction}</dd>
      <dt>Ball</dt><dd>${log.ball_location}</dd>
      <dt>Visual event</dt><dd>${log.event}</dd>
    </dl>`;
  $('baseline').textContent = log.baseline_description;
  $('improved').textContent = log.improved_description;
  $('answer').textContent = generateAnswer(log, $('questionInput').value);
  renderMemory();
}
function ask() {
  const log = logs[$('clipSelect').selectedIndex];
  const question = $('questionInput').value;
  $('answer').textContent = generateAnswer(log, question);
  saveMemory({ clip: log.title, question, mode: $('modeSelect')?.value || 'balanced', ts: Date.now() });
}
function speak() {
  const text = $('answer').textContent;
  if (!('speechSynthesis' in window) || !text) return;
  if (currentUtterance) window.speechSynthesis.cancel();
  currentUtterance = new SpeechSynthesisUtterance(text);
  currentUtterance.rate = 0.95;
  window.speechSynthesis.speak(currentUtterance);
}
function setupVoiceInput() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    $('voiceBtn').disabled = true;
    $('voiceBtn').textContent = '🎙️ Voice unavailable in this browser';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  $('voiceBtn').addEventListener('click', () => {
    $('voiceBtn').textContent = 'Listening...';
    recognition.start();
  });
  recognition.addEventListener('result', (event) => {
    $('questionInput').value = event.results[0][0].transcript;
    ask();
    speak();
  });
  recognition.addEventListener('end', () => {
    $('voiceBtn').textContent = '🎙️ Ask with voice';
  });
}
async function init() {
  logs = await fetch('data/event_logs.json').then((r) => r.json());
  const select = $('clipSelect');
  logs.forEach((log) => {
    const option = document.createElement('option');
    option.value = log.clip_id;
    option.textContent = log.title;
    select.appendChild(option);
  });
  select.addEventListener('change', renderClip);
  $('modeSelect')?.addEventListener('change', renderClip);
  $('askBtn').addEventListener('click', ask);
  $('speakBtn').addEventListener('click', speak);
  $('questionInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') ask();
  });
  setupVoiceInput();
  renderClip();
}
init().catch((error) => {
  console.error(error);
  $('answer').textContent = 'Failed to load demo data.';
});
