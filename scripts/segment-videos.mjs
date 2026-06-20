import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const inputDir = process.argv[2] || 'clips/kaggle/raw';
const outputDir = process.argv[3] || 'clips/kaggle/segments';
const segmentSeconds = Number(process.env.SEGMENT_SECONDS || 10);
const strideSeconds = Number(process.env.STRIDE_SECONDS || segmentSeconds);
const maxSegmentsPerVideo = Number(process.env.MAX_SEGMENTS_PER_VIDEO || 20);
const extensions = new Set(['.mp4', '.mov', '.mkv', '.avi', '.webm']);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function safeName(name) {
  return name
    .replace(path.extname(name), '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'clip';
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (extensions.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

function durationSeconds(file) {
  const output = run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file
  ]);
  return Number(output);
}

async function main() {
  try {
    run('ffmpeg', ['-version']);
    run('ffprobe', ['-version']);
  } catch {
    console.error('ffmpeg/ffprobe are required. Install with: brew install ffmpeg');
    process.exit(1);
  }

  await fs.mkdir(outputDir, { recursive: true });
  const videos = await walk(inputDir);
  if (videos.length === 0) {
    console.error(`No videos found in ${inputDir}`);
    process.exit(1);
  }

  const manifest = [];
  for (const video of videos) {
    const duration = durationSeconds(video);
    const base = safeName(path.basename(video));
    const usableStarts = [];
    for (let start = 0; start + segmentSeconds <= duration; start += strideSeconds) {
      usableStarts.push(start);
      if (usableStarts.length >= maxSegmentsPerVideo) break;
    }

    console.log(`Segmenting ${video}: ${usableStarts.length} segments`);
    for (const [index, start] of usableStarts.entries()) {
      const segmentId = `${base}_${String(index + 1).padStart(3, '0')}`;
      const outFile = path.join(outputDir, `${segmentId}.mp4`);
      run('ffmpeg', [
        '-y',
        '-ss', String(start),
        '-i', video,
        '-t', String(segmentSeconds),
        '-vf', 'scale=1280:-2',
        '-an',
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '24',
        outFile
      ]);
      manifest.push({
        segment_id: segmentId,
        source_video: video,
        file: outFile,
        start_seconds: start,
        duration_seconds: segmentSeconds
      });
    }
  }

  const manifestPath = path.join(outputDir, 'manifest.json');
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifest.length} segments and ${manifestPath}`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});
