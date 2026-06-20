import fs from 'node:fs';
const logs = JSON.parse(fs.readFileSync('data/event_logs.json', 'utf8'));
const required = ['clip_id','title','team_in_possession','direction','ball_location','event','baseline_description','improved_description','questions'];
for (const [i, log] of logs.entries()) {
  for (const key of required) {
    if (!(key in log)) throw new Error(`event_logs[${i}] missing ${key}`);
  }
}
console.log(`OK: ${logs.length} event logs validated`);
