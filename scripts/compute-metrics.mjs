import fs from 'node:fs';
const file = process.argv[2] || 'data/annotations/sample_labels.csv';
const raw = fs.readFileSync(file, 'utf8').trim().split(/\r?\n/);
const headers = raw.shift().split(',').map((h) => h.trim());
const rows = raw.filter(Boolean).map((line) => Object.fromEntries(line.split(',').map((v, i) => [headers[i], v.trim()])));
const pct = (n, d) => `${Math.round((100 * n) / Math.max(d, 1))}%`;
const yesRate = (key) => pct(rows.filter((r) => r[key] === 'yes').length, rows.length);
const preferred = pct(rows.filter((r) => r.preferred === 'improved').length, rows.length);
const hallucination = pct(rows.filter((r) => r.hallucination === 'yes').length, rows.length);
const helpfulness = rows.reduce((s, r) => s + Number(r.helpfulness || 0), 0) / Math.max(rows.length, 1);
const metrics = {
  labels: rows.length,
  improved_preference_win_rate: preferred,
  ball_location_coverage: yesRate('ball_location'),
  direction_coverage: yesRate('direction'),
  key_event_coverage: yesRate('key_event'),
  hallucination_rate: hallucination,
  mean_helpfulness_1_to_5: Number(helpfulness.toFixed(2))
};
console.log(JSON.stringify(metrics, null, 2));
