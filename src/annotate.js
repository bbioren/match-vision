const $ = (id) => document.getElementById(id);
const headers = ['task_id','best_candidate','second_best','ball_location','direction','key_event','conciseness','hallucination','helpfulness'];
let tasks = [];
let labels = JSON.parse(localStorage.getItem('matchvision_labels') || '[]');

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
function renderCsv() {
  const rows = [headers.join(','), ...labels.map((r) => headers.map((h) => csvEscape(r[h])).join(','))];
  $('csvOutput').value = rows.join('\n');
}
function renderTask() {
  const task = tasks[$('taskSelect').selectedIndex];
  const clipVideo = $('clipVideo');
  if (task.video_src) {
    clipVideo.src = task.video_src;
    clipVideo.hidden = false;
    clipVideo.load();
  } else {
    clipVideo.removeAttribute('src');
    clipVideo.hidden = true;
  }
  $('clipSummary').textContent = task.clip_summary;
  $('baseline').textContent = task.baseline;
  $('improved').textContent = task.improved;
  const candidates = task.candidates || [];
  $('candidateList').innerHTML = candidates.map((c) => `<label><input type="radio" name="best_candidate" value="${c.id}" ${c.id === 'spatial' ? 'checked' : ''}/> <strong>${c.label}</strong><br/><span>${c.description}</span></label>`).join('');
  $('secondBest').innerHTML = candidates.map((c) => `<option value="${c.id}">${c.label}</option>`).join('');
}
async function init() {
  tasks = await fetch('data/annotation_tasks.json').then((r) => r.json());
  tasks.forEach((task) => {
    const opt = document.createElement('option');
    opt.textContent = `${task.task_id}: ${task.clip_id} (${task.split})`;
    opt.value = task.task_id;
    $('taskSelect').appendChild(opt);
  });
  $('taskSelect').addEventListener('change', renderTask);
  $('labelForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    labels.push({ task_id: $('taskSelect').value, ...Object.fromEntries(data.entries()) });
    localStorage.setItem('matchvision_labels', JSON.stringify(labels));
    renderCsv();
  });
  $('copyBtn').addEventListener('click', async () => navigator.clipboard.writeText($('csvOutput').value));
  $('clearBtn').addEventListener('click', () => {
    labels = [];
    localStorage.removeItem('matchvision_labels');
    renderCsv();
  });
  renderTask();
  renderCsv();
}
init();
