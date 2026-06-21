// ── Terac submission ID capture (must happen before anything else) ──────────
const urlParams = new URLSearchParams(location.search);
const TERAC_SUBMISSION_ID =
  urlParams.get('teracSubmissionId') ??
  urlParams.get('submissionId') ??
  localStorage.getItem('teracSubmissionId') ??
  null;
const TERAC_TASK_ID =
  urlParams.get('taskId') ?? localStorage.getItem('teracTaskId') ?? null;

if (TERAC_SUBMISSION_ID) localStorage.setItem('teracSubmissionId', TERAC_SUBMISSION_ID);
if (TERAC_TASK_ID) localStorage.setItem('teracTaskId', TERAC_TASK_ID);

const $ = (id) => document.getElementById(id);
let tasks = [];
let selectedTask = null;

function renderSubmissionBadge() {
  const badge = $('submissionBadge');
  if (!badge) return;
  if (TERAC_SUBMISSION_ID) {
    badge.textContent = `Terac session: ${TERAC_SUBMISSION_ID.slice(0, 12)}…`;
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function taskLabel(task) {
  const prefix = task.annotation_status === 'example' ? 'Example' : 'To do';
  return `${prefix}: ${task.task_id}`;
}

function setSubmitState(message, disabled = false) {
  const btn = $('submitBtn');
  btn.disabled = disabled;
  btn.textContent = message;
}

function renderTask() {
  const task = tasks[$('taskSelect').selectedIndex];
  selectedTask = task;

  const clipVideo = $('clipVideo');
  if (task.video_src) {
    clipVideo.src = `${task.video_src}?v=${encodeURIComponent(task.task_id)}`;
    clipVideo.hidden = false;
    clipVideo.load();
  } else {
    clipVideo.pause();
    clipVideo.removeAttribute('src');
    clipVideo.hidden = true;
  }

  const isExample = task.annotation_status === 'example';
  $('taskType').textContent = isExample ? 'Example commentary' : 'Commentary task';
  $('taskInstructions').textContent = isExample
    ? 'This is an example written by the requester. Watch the clip and use this level of factual, visual detail as the target style.'
    : 'Watch the full clip and write enthusiastic, factual audio-description commentary for a blind or low-vision soccer fan. Make it ready for a voice AI to speak aloud.';
  $('clipSummary').textContent = task.reference_description || '';
  $('clipSummary').hidden = !isExample;
  $('transcription').value = isExample ? task.reference_description : (task.transcription_draft || '');
  $('transcription').readOnly = isExample;
  $('transcription').required = !isExample;
  $('transcription').placeholder = isExample
    ? ''
    : 'Example: The right winger in white drives toward the corner of the box, with two blue defenders backing off and the ball tight to his feet. He cuts the pass inside toward the penalty spot, where the nearest striker is arriving under pressure. The chance is building fast, but the clip ends before we see a shot.';
  $('exampleHint').hidden = !isExample;
  $('todoHint').hidden = isExample;
  setSubmitState(isExample ? 'Example only' : 'Save commentary', isExample);
}

async function submitTranscription(transcription) {
  const task = selectedTask;
  const payload = {
    task_id: task.task_id,
    clip_id: task.clip_id,
    annotation_type: 'bvi_audio_commentary',
    commentary: transcription,
    transcription,
    teracSubmissionId: TERAC_SUBMISSION_ID,
    teracTaskId: TERAC_TASK_ID,
  };

  try {
    console.log('[MatchVision] Submitting commentary:', { taskId: task.task_id, teracSubmissionId: TERAC_SUBMISSION_ID });
    const res = await fetch('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    console.log('[MatchVision] Submit response:', { status: res.status, ok: res.ok, data });
    return { ok: res.ok, data };
  } catch (err) {
    console.error('[MatchVision] API save failed:', err);
    const saved = JSON.parse(localStorage.getItem('matchvision_transcriptions_fallback') || '[]');
    saved.push({ ...payload, created_at: new Date().toISOString() });
    localStorage.setItem('matchvision_transcriptions_fallback', JSON.stringify(saved));
    console.warn('[MatchVision] Saved to localStorage fallback. Count:', saved.length);
    return { ok: false, fallback: true };
  }
}

async function init() {
  renderSubmissionBadge();
  tasks = await fetch(`data/annotation_tasks.json?v=${Date.now()}`).then(r => r.json());

  $('taskSelect').innerHTML = '';
  tasks.forEach((task) => {
    const opt = document.createElement('option');
    opt.textContent = taskLabel(task);
    opt.value = task.task_id;
    $('taskSelect').appendChild(opt);
  });

  $('taskSelect').addEventListener('change', renderTask);

  $('labelForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (selectedTask.annotation_status === 'example') return;

    const transcription = $('transcription').value.trim();
    if (transcription.length < 120) {
      $('saveStatus').textContent = 'Please write 2-4 complete sentences with enough visual detail for a blind or low-vision fan.';
      return;
    }

    setSubmitState('Saving…', true);
    $('saveStatus').textContent = '';
    const { ok, fallback } = await submitTranscription(transcription);
    setSubmitState(ok ? 'Saved ✓' : fallback ? 'Saved locally (offline)' : 'Save error – try again', false);
    $('saveStatus').textContent = ok || fallback ? 'Thank you. Your commentary was saved.' : 'Could not save. Please try again.';
    setTimeout(() => setSubmitState('Save commentary', false), 2000);
  });

  renderTask();
}

init();
