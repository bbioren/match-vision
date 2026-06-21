#!/usr/bin/env node
/**
 * update-blob-urls.mjs
 * 
 * Updates annotation_tasks.json to use Vercel Blob Storage URLs
 */

import fs from 'fs';

const BLOB_BASE = 'https://qg9kbszzfgzph9eb.public.blob.vercel-storage.com/match-vision-clips';

const tasks = JSON.parse(fs.readFileSync('data/annotation_tasks.json', 'utf8'));

let updated = 0;

for (const task of tasks) {
  if (task.video_src && task.video_src.endsWith('.mp4')) {
    // Convert local path to blob URL
    task.video_src = `${BLOB_BASE}/${task.video_src}`;
    updated++;
  }
}

fs.writeFileSync('data/annotation_tasks.json', JSON.stringify(tasks, null, 2));
console.log(`✅ Updated ${updated} tasks with Blob URLs`);
