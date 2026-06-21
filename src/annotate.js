const $ = (id) => document.getElementById(id);
const headers = ['task_id', 'rank_1', 'rank_2', 'rank_3', 'rank_4', 'rank_5', 'best_commentary', 'why_best'];
let tasks = [];
let labels = JSON.parse(localStorage.getItem('matchvision_ranking_labels') || '[]');
let selectedTaskId = null;
let draggedId = null;

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function renderCsv() {
  const rows = [headers.join(','), ...labels.map((r) => headers.map((h) => csvEscape(r[h])).join(','))];
  $('csvOutput').value = rows.join('\n');
}

function getVariations(task) {
  const variations = task.commentary_variations || task.candidates?.map((c) => ({ id: c.id, label: c.label, text: c.description })) || [];
  return variations.slice(0, 5);
}

function updateRankNumbers() {
  [...$('rankingList').children].forEach((item, index) => {
    item.querySelector('.rank-number').textContent = `#${index + 1}`;
  });
}

function moveItem(item, direction) {
  const list = $('rankingList');
  if (direction < 0 && item.previousElementSibling) list.insertBefore(item, item.previousElementSibling);
  if (direction > 0 && item.nextElementSibling) list.insertBefore(item.nextElementSibling, item);
  updateRankNumbers();
}

function renderRanking(variations) {
  $('rankingList').innerHTML = variations.map((v, index) => `
    <li class="ranking-item" draggable="true" data-id="${v.id}" data-text="${csvEscape(v.text)}">
      <div class="rank-meta">
        <span class="rank-number">#${index + 1}</span>
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
    item.addEventListener('dragstart', () => {
      draggedId = item.dataset.id;
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      draggedId = null;
      item.classList.remove('dragging');
      updateRankNumbers();
    });
    item.addEventListener('dragover', (event) => {
      event.preventDefault();
      const dragged = [...$('rankingList').children].find((child) => child.dataset.id === draggedId);
      if (!dragged || dragged === item) return;
      const rect = item.getBoundingClientRect();
      const afterMidpoint = event.clientY > rect.top + rect.height / 2;
      $('rankingList').insertBefore(dragged, afterMidpoint ? item.nextSibling : item);
    });
    item.querySelector('[data-move="up"]').addEventListener('click', () => moveItem(item, -1));
    item.querySelector('[data-move="down"]').addEventListener('click', () => moveItem(item, 1));
  }
}

function renderTask() {
  const task = tasks[$('taskSelect').selectedIndex];
  selectedTaskId = task.task_id;
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
  renderRanking(getVariations(task));
}

function currentRanking() {
  return [...$('rankingList').children].map((item) => ({ id: item.dataset.id, text: item.querySelector('p').textContent }));
}

async function init() {
  tasks = await fetch(`data/annotation_tasks.json?v=${Date.now()}`).then((r) => r.json());
  tasks.forEach((task) => {
    const opt = document.createElement('option');
    opt.textContent = `${task.task_id}: ${task.clip_id} (${task.split})`;
    opt.value = task.task_id;
    $('taskSelect').appendChild(opt);
  });
  $('taskSelect').addEventListener('change', renderTask);
  $('labelForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const ranking = currentRanking();
    const row = {
      task_id: selectedTaskId,
      rank_1: ranking[0]?.id,
      rank_2: ranking[1]?.id,
      rank_3: ranking[2]?.id,
      rank_4: ranking[3]?.id,
      rank_5: ranking[4]?.id,
      best_commentary: ranking[0]?.text,
      why_best: $('whyBest').value.trim()
    };
    labels.push(row);
    localStorage.setItem('matchvision_ranking_labels', JSON.stringify(labels));
    renderCsv();
    event.currentTarget.querySelector('button[type="submit"]').textContent = 'Saved ranking ✓';
    setTimeout(() => { event.currentTarget.querySelector('button[type="submit"]').textContent = 'Save ranking locally'; }, 1200);
  });
  $('copyBtn').addEventListener('click', async () => navigator.clipboard.writeText($('csvOutput').value));
  $('clearBtn').addEventListener('click', () => {
    labels = [];
    localStorage.removeItem('matchvision_ranking_labels');
    localStorage.removeItem('matchvision_labels');
    renderCsv();
  });
  renderTask();
  renderCsv();
}

init();
