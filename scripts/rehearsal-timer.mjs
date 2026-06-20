const steps = [
  ['Problem opener', 30],
  ['Core voice demo', 45],
  ['Personalization / memory', 40],
  ['Terac annotation + metrics', 40],
  ['Sponsor stack close', 25],
  ['Buffer / Q&A handoff', 20]
];
let elapsed = 0;
for (const [name, seconds] of steps) {
  elapsed += seconds;
  console.log(`${String(Math.floor(elapsed / 60)).padStart(2,'0')}:${String(elapsed % 60).padStart(2,'0')} - ${name} (${seconds}s)`);
}
console.log(`Total: ${elapsed}s`);
