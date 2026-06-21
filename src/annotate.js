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

// ── Calibration checks (~12% of items, injected server-side or here) ────────
// Each calibration item has an obviously strong and obviously weak candidate.
// The correct answer is signed so the client can verify without trusting itself.
const CALIBRATION_TASKS = [
  {
    task_id: 'cal_1',
    clip_summary: 'CALIBRATION CHECK: Read both options carefully and pick the better one for a blind soccer fan.',
    is_calibration: true,
    correct_rank_first: 'cal_good', // the obviously correct #1
    commentary_variations: [
      {
        id: 'cal_good',
        label: 'Descriptive',
        text: 'England attack left to right. The ball is at the edge of Croatia\'s penalty area, with Harry Kane unmarked six yards from goal. A cross is coming in from the right wing.',
      },
      {
        id: 'cal_bad',
        label: 'Vague',
        text: 'Something is happening on the pitch.',
      },
    ],
  },
];

// ── Core state ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
let tasks = [];
let selectedTask = null;
let draggedId = null;

// ── Reason tags (why this commentary is better for a BVI fan) ────────────────
const REASON_TAGS = [
  { id: 'ball_location',     label: 'Ball location specific enough to picture it' },
  { id: 'direction',         label: 'Direction of play is clear' },
  { id: 'play_type',         label: 'Correctly identifies the type of play' },
  { id: 'danger',            label: 'Explains why this moment is dangerous' },
  { id: 'tension',           label: 'Captures the tension or pressure of the moment' },
  { id: 'presence',          label: 'Makes me feel present at the stadium' },
  { id: 'player_named',      label: 'Names the key player so I can follow individual stories' },
  { id: 'concise',           label: 'Short enough to process in real time' },
  { id: 'no_visual_assume',  label: 'No visual-assumption phrases ("as you can see", etc.)' },
  { id: 'beyond_tv',         label: 'Gives me more than standard TV commentary alone' },
];

function renderReasonTags() {
  const container = $('reasonTags');
  if (!container) return;
  container.innerHTML = REASON_TAGS.map(t => `
    <label class="tag-label">
      <input type="checkbox" name="reason_tag" value="${t.id}"> ${t.label}
    </label>`).join('');
}

function getSelectedReasonTags() {
  return [...document.querySelectorAll('input[name="reason_tag"]:checked')].map(el => el.value);
}

// ── Ranking list ─────────────────────────────────────────────────────────────
function updateRankNumbers() {
  [...$('rankingList').children].forEach((item, i) => {
    item.querySelector('.rank-number').textContent = `#${i + 1}`;
  });
}

function moveItem(item, direction) {
  const list = $('rankingList');
  if (direction < 0 && item.previousElementSibling) list.insertBefore(item, item.previousElementSibling);
  if (direction > 0 && item.nextElementSibling) list.insertBefore(item.nextElementSibling, item);
  updateRankNumbers();
}

function renderRanking(variations) {
  $('rankingList').innerHTML = variations.map((v, i) => `
    <li class="ranking-item" draggable="true" data-id="${v.id}" data-text="${v.text.replace(/"/g, '&quot;')}">
      <div class="rank-meta">
        <span class="rank-number">#${i + 1}</span>
        <span class="drag-handle" aria-hidden="true">↕</span>
      </div>
      <div class="rank-body">
        <strong>${v.label}</strong>
        <p>${v.text}</p>
        <div class="rank-controls">
          <button type="button" data-move="up">Move up</button>
          <button type="button" data-move="down">Move down</button>
        </div>
      </div>
    </li>`).join('');

  for (const item of $('rankingList').children) {
    item.addEventListener('dragstart', () => { draggedId = item.dataset.id; item.classList.add('dragging'); });
    item.addEventListener('dragend', () => { draggedId = null; item.classList.remove('dragging'); updateRankNumbers(); });
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragged = [...$('rankingList').children].find(c => c.dataset.id === draggedId);
      if (!dragged || dragged === item) return;
      const rect = item.getBoundingClientRect();
      $('rankingList').insertBefore(dragged, e.clientY > rect.top + rect.height / 2 ? item.nextSibling : item);
    });
    item.querySelector('[data-move="up"]').addEventListener('click', () => moveItem(item, -1));
    item.querySelector('[data-move="down"]').addEventListener('click', () => moveItem(item, 1));
  }
}

function currentRanking() {
  return [...$('rankingList').children].map(item => ({
    id: item.dataset.id,
    text: item.querySelector('p').textContent,
  }));
}

// ── Task rendering ────────────────────────────────────────────────────────────
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

  $('clipSummary').textContent = task.clip_summary;
  $('whyBest').value = '';

  // Reset reason tags
  document.querySelectorAll('input[name="reason_tag"]').forEach(el => el.checked = false);

  const variations = task.commentary_variations ?? [];
  renderRanking(variations);

  // Show calibration warning if applicable
  const calBanner = $('calBanner');
  if (calBanner) calBanner.hidden = !task.is_calibration;
}

// ── Submission ────────────────────────────────────────────────────────────────
async function submitLabel(ranking, reasonTags, whyBest) {
  const task = selectedTask;
  let calibrationPassed = null;

  if (task.is_calibration) {
    calibrationPassed = ranking[0]?.id === task.correct_rank_first;
  }

  const payload = {
    task_id: task.task_id,
    ranking,
    reason_tags: reasonTags,
    why_best: whyBest,
    is_calibration: task.is_calibration ?? false,
    calibration_passed: calibrationPassed,
    teracSubmissionId: TERAC_SUBMISSION_ID,
    teracTaskId: TERAC_TASK_ID,
  };

  try {
    const res = await fetch('/api/labels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    return { ok: res.ok, data };
  } catch (err) {
    console.warn('API save failed, falling back to localStorage', err);
    const saved = JSON.parse(localStorage.getItem('matchvision_labels_fallback') || '[]');
    saved.push({ ...payload, created_at: new Date().toISOString() });
    localStorage.setItem('matchvision_labels_fallback', JSON.stringify(saved));
    return { ok: false, fallback: true };
  }
}

// ── Show Terac submission ID in UI if present ─────────────────────────────────
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

// ── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  renderReasonTags();
  renderSubmissionBadge();

  const regularTasks = await fetch(`data/annotation_tasks.json?v=${Date.now()}`).then(r => r.json());

  // Inject calibration tasks (~12%): roughly 1 calibration per 8 real tasks
  tasks = [];
  regularTasks.forEach((task, i) => {
    tasks.push(task);
    if ((i + 1) % 8 === 0 && CALIBRATION_TASKS.length > 0) {
      tasks.push(CALIBRATION_TASKS[Math.floor(i / 8) % CALIBRATION_TASKS.length]);
    }
  });

  tasks.forEach((task) => {
    const opt = document.createElement('option');
    opt.textContent = task.is_calibration
      ? `⚠ Calibration check`
      : `${task.task_id}: ${task.clip_id} (${task.split})`;
    opt.value = task.task_id;
    $('taskSelect').appendChild(opt);
  });

  $('taskSelect').addEventListener('change', renderTask);

  $('labelForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.currentTarget.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const ranking = currentRanking();
    const reasonTags = getSelectedReasonTags();
    const whyBest = $('whyBest').value.trim();

    const { ok, fallback } = await submitLabel(ranking, reasonTags, whyBest);

    btn.disabled = false;
    btn.textContent = ok ? 'Saved ✓' : fallback ? 'Saved locally (offline)' : 'Save error – try again';
    setTimeout(() => { btn.textContent = 'Save ranking'; }, 2000);
  });

  renderTask();
}

init();
