import { generateAccessibleDescription } from './services/description.js';
import { setupSpeechRecognition, speakWithDeepgramOrFallback } from './services/voice.js';
import { loadMemory, saveMemory } from './services/memory.js';

let logs = [];
const $ = (id) => document.getElementById(id);

function normalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
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
async function ask() {
  const log = logs[$('clipSelect').selectedIndex];
  const question = $('questionInput').value;
  const mode = $('modeSelect')?.value || 'balanced';
  $('answer').textContent = await generateAccessibleDescription({ log, question, mode, fallback: () => generateAnswer(log, question) });
  await saveMemory({ clip: log.title, question, mode, ts: Date.now() });
  renderMemory();
}
function speak() {
  speakWithDeepgramOrFallback($('answer').textContent);
}
function setupVoiceInput() {
  setupSpeechRecognition({
    button: $('voiceBtn'),
    onTranscript: async (transcript) => {
      $('questionInput').value = transcript;
      await ask();
      speak();
    }
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
