import fs from 'node:fs';

const clips = JSON.parse(fs.readFileSync('data/clips.json', 'utf8'));
const clipRequired = ['clip_id', 'title', 'video_asset'];
for (const [i, clip] of clips.entries()) {
  for (const key of clipRequired) {
    if (!(key in clip)) throw new Error(`clips[${i}] missing ${key}`);
  }
}

const tasks = JSON.parse(fs.readFileSync('data/annotation_tasks.json', 'utf8'));
const taskRequired = ['task_id', 'clip_id', 'baseline', 'improved', 'candidates'];
for (const [i, task] of tasks.entries()) {
  for (const key of taskRequired) {
    if (!(key in task)) throw new Error(`annotation_tasks[${i}] missing ${key}`);
  }
}

console.log(`OK: ${clips.length} clips, ${tasks.length} annotation tasks validated`);
