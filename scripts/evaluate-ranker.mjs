import fs from 'node:fs';
import { selectBestCandidate, scoreCandidate, DEFAULT_WEIGHTS } from '../src/ranker.js';

const logs = JSON.parse(fs.readFileSync('data/event_logs.json', 'utf8'));
const rows = logs.map((log) => {
  const selected = selectBestCandidate(log.candidates, DEFAULT_WEIGHTS);
  const baseline = log.candidates.find((c) => c.id === 'baseline');
  return {
    clip_id: log.clip_id,
    baseline_score: Number(scoreCandidate(baseline).toFixed(2)),
    selected_id: selected.id,
    selected_score: Number(scoreCandidate(selected).toFixed(2)),
    improvement: Number((scoreCandidate(selected) - scoreCandidate(baseline)).toFixed(2)),
    split: log.clip_id === 'clip_3' ? 'heldout' : 'train'
  };
});
const avg = (xs) => xs.reduce((a,b)=>a+b,0)/xs.length;
const result = {
  weights: DEFAULT_WEIGHTS,
  examples: rows,
  mean_baseline_score: Number(avg(rows.map((r)=>r.baseline_score)).toFixed(2)),
  mean_ranked_score: Number(avg(rows.map((r)=>r.selected_score)).toFixed(2)),
  mean_improvement: Number(avg(rows.map((r)=>r.improvement)).toFixed(2)),
  heldout: rows.filter((r)=>r.split==='heldout')
};
console.log(JSON.stringify(result, null, 2));
