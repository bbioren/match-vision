#!/usr/bin/env node
/**
 * upload-clips-to-blob.mjs
 * 
 * Uploads all clip files (first_9_mins, youtube, kaggle) to Vercel Blob Storage
 * 
 * Usage:
 *   BLOB_READ_WRITE_TOKEN=<token> node scripts/upload-clips-to-blob.mjs
 */

import { put } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

if (!TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN environment variable is required');
  process.exit(1);
}

const clipDirs = [
  'clips/real/segments',
  'clips/youtube/segments',
  'clips/kaggle/segments',
];

// Standalone clip files that don't live in one of the segment directories
// above (e.g. full StatsBomb-timeline-tied clips referenced directly from
// data/clips.json).
const individualFiles = [
  'clips/real/argentina_vs_france_wc2022_h2_kickoff_5min.mp4',
];

async function uploadClips() {
  console.log('Uploading clips to Vercel Blob Storage...\n');

  let uploadedCount = 0;
  let failedCount = 0;

  for (const relPath of individualFiles) {
    const fullPath = path.join(__dirname, '..', relPath);
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠ File not found: ${relPath}`);
      continue;
    }
    const blobPath = `match-vision-clips/${relPath}`;
    try {
      console.log(`📄 Uploading ${relPath}...`);
      const fileContent = fs.readFileSync(fullPath);
      const result = await put(blobPath, fileContent, { access: 'public', token: TOKEN });
      console.log(`  ✓ ${result.url}`);
      uploadedCount++;
    } catch (error) {
      console.error(`  ✗ Failed to upload ${relPath}: ${error.message}`);
      failedCount++;
    }
  }

  for (const dir of clipDirs) {
    const fullPath = path.join(__dirname, '..', dir);
    
    if (!fs.existsSync(fullPath)) {
      console.log(`⚠ Directory not found: ${dir}`);
      continue;
    }

    const files = fs.readdirSync(fullPath).filter(f => f.endsWith('.mp4'));
    
    console.log(`\n📂 ${dir} (${files.length} files)`);

    for (const file of files) {
      const filePath = path.join(fullPath, file);
      const blobPath = `match-vision-clips/${dir}/${file}`;
      
      try {
        const fileContent = fs.readFileSync(filePath);
        
        console.log(`  Uploading ${file}...`);
        
        const result = await put(blobPath, fileContent, {
          access: 'public',
          token: TOKEN,
        });
        
        console.log(`  ✓ ${result.url}`);
        uploadedCount++;
      } catch (error) {
        console.error(`  ✗ Failed to upload ${file}: ${error.message}`);
        failedCount++;
      }
    }
  }

  console.log(`\n✅ Upload complete: ${uploadedCount} successful, ${failedCount} failed`);
}

uploadClips().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
