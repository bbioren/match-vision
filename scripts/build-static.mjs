import fs from 'node:fs/promises';
import path from 'node:path';

const outDir = 'dist';
const include = [
  'index.html',
  'annotate.html',
  'eval.html',
  'eyetrack.html',
  'src',
  'data',
  'public',
  'clips/clip_1.svg',
  'clips/clip_2.svg',
  'clips/clip_3.svg',
  'clips/real',
  'clips/youtube/segments/england_vs_croatia_extended_highlights_2026_fifa_world_cup_007.mp4',
  'clips/youtube/segments/england_vs_croatia_extended_highlights_2026_fifa_world_cup_008.mp4',
  'clips/youtube/segments/england_vs_croatia_extended_highlights_2026_fifa_world_cup_009.mp4',
  'clips/youtube/segments/england_vs_croatia_extended_highlights_2026_fifa_world_cup_011.mp4',
  'clips/youtube/segments/england_vs_croatia_extended_highlights_2026_fifa_world_cup_012.mp4'
];

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

async function copyEntry(src) {
  if (!(await exists(src))) return;
  const dest = path.join(outDir, src);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.cp(src, dest, { recursive: true });
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
for (const entry of include) await copyEntry(entry);
console.log(`Built static site in ${outDir}`);
