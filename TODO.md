# 17-hour sprint todo

## Critical path

- [ ] Lock scope, team roles, sponsor targets, and demo narrative from `SCOPE.md`
- [ ] Collect 3-5 short soccer clips and create structured event logs for each clip
- [ ] Build minimal web demo shell: clip selector, transcript/response pane, voice button, metrics section
- [ ] Implement Claude accessible-description generator from structured event logs and user questions
- [ ] Integrate Deepgram STT for voice questions and TTS for spoken responses
- [ ] Design Terac annotation task: baseline vs improved descriptions, accessibility rubric, held-out eval set
- [ ] Launch Terac labeling and collect enough human labels for before/after evaluation
- [ ] Use labels to improve prompt/ranker and compute before/after metrics
- [ ] Prepare Devpost submission: pitch, screenshots, track selections, sponsor explanations
- [ ] Record 2-3 minute demo video with problem, live voice demo, Terac metrics, sponsor stack
- [ ] Run full judging rehearsal under 5 minutes and fix demo-breaking bugs

## Prize-stack polish

- [ ] Implement Redis memory for recent match events and user preference modes
- [ ] Integrate Arize traces/evals or create equivalent dashboard evidence showing improvement
- [ ] Polish UI for accessibility story: large text, voice-first flow, clear baseline vs improved comparison
- [ ] Write README with sponsor usage, setup, architecture, and judging talking points
