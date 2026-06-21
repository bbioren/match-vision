import fs from 'node:fs';

const clips = JSON.parse(fs.readFileSync('data/clips.json', 'utf8'));
const clipRequired = ['clip_id', 'title'];
for (const [i, clip] of clips.entries()) {
  for (const key of clipRequired) {
    if (!(key in clip)) throw new Error(`clips[${i}] missing ${key}`);
  }
  // Every clip needs either a video (live VLM extraction) or a precomputed
  // ground-truth timeline (analytics replay, e.g. StatsBomb/socceraction) —
  // never neither.
  if (!clip.video_asset && !clip.timeline_asset) {
    throw new Error(`clips[${i}] must have either video_asset or timeline_asset`);
  }
  if (clip.match_context) {
    if (!clip.match_context.teams) throw new Error(`clips[${i}] match_context missing teams`);
    if (!clip.match_context.halves?.length) throw new Error(`clips[${i}] match_context missing halves`);
    for (const [name, team] of Object.entries(clip.match_context.teams)) {
      if (!team.outfield_kit && !team.kit_color) {
        throw new Error(`clips[${i}] team ${name} missing outfield_kit`);
      }
    }
  }
}
console.log(`OK: ${clips.length} clips validated`);

const tasksPath = 'data/annotation_tasks.json';
if (fs.existsSync(tasksPath)) {
  const tasks = JSON.parse(fs.readFileSync(tasksPath, 'utf8'));
  for (const [taskIndex, task] of tasks.entries()) {
    if (['visual_transcription', 'bvi_audio_commentary', 'bvi_audio_commentary_example'].includes(task.annotation_type)) {
      for (const key of ['task_id', 'clip_id', 'video_src', 'annotation_status']) {
        if (!task[key]) throw new Error(`annotation_tasks[${taskIndex}] missing ${key}`);
      }
      if (!['example', 'todo'].includes(task.annotation_status)) {
        throw new Error(`annotation_tasks[${taskIndex}] has invalid annotation_status ${task.annotation_status}`);
      }
      if (task.annotation_status === 'example' && String(task.reference_description || '').length < 80) {
        throw new Error(`annotation_tasks[${taskIndex}] example must include reference_description`);
      }
      if (task.annotation_status === 'todo' && task.reference_description) {
        throw new Error(`annotation_tasks[${taskIndex}] todo task should not include a reference description`);
      }
      continue;
    }

    const candidates = task.commentary_variations || task.candidates;
    if (!Array.isArray(candidates) || candidates.length !== 5) {
      throw new Error(`annotation_tasks[${taskIndex}] ${task.task_id || task.clip_id} must have 5 candidates`);
    }
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const text = candidate.text || candidate.description || '';
      if (text.includes('[generation failed:') || text.includes('Gemini API error')) {
        throw new Error(`annotation_tasks[${taskIndex}].candidates[${candidateIndex}] contains generation failure text`);
      }
      if (text.length < 20) {
        throw new Error(`annotation_tasks[${taskIndex}].candidates[${candidateIndex}] is suspiciously short`);
      }
      if (!/[.!?]$/.test(text.trim()) || /["'“‘]$/.test(text.trim())) {
        throw new Error(`annotation_tasks[${taskIndex}].candidates[${candidateIndex}] appears truncated: ${text}`);
      }
      if (/\b(scores?|saves?|shoots?|strikes?|converts?|misses?)\b/i.test(text) && /clip ends before/i.test(task.clip_summary || '')) {
        throw new Error(`annotation_tasks[${taskIndex}].candidates[${candidateIndex}] may describe an unseen penalty outcome: ${text}`);
      }
      if (/\{\s*"error"\s*:/.test(text)) {
        throw new Error(`annotation_tasks[${taskIndex}].candidates[${candidateIndex}] contains raw API error JSON`);
      }
    }
  }
  console.log(`OK: ${tasks.length} annotation tasks validated`);
}
