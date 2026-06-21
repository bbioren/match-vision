# Final Hackathon Checklist

## Current verified status

- `npm run check` passes: 3 event logs and 8 annotation tasks validated.
- `npm run metrics` passes: Terac-trained selector win rate vs baseline is 100%, hallucination rate is 0%, mean helpfulness is 4.6/5.
- `npm run build` passes and writes `dist/`.
- `npm run rehearse` is 3:20 total, safely under the 5-minute judging target.
- No screenshot/video assets are currently checked into the repo, so media capture is the main remaining submission task.

## 1. Run the app

```bash
npm run dev
```

Open:

- Main demo: <http://localhost:5173>
- Annotation Lab: <http://localhost:5173/annotate.html>
- Eval Dashboard: <http://localhost:5173/eval.html>

Optional credentials:

```bash
cp .env.example .env
# add GEMINI_API_KEY and DEEPGRAM_API_KEY if available
```

## 2. Collect labels fast

Minimum target: 30 labels. Strong target: 60+ labels.

Process:

1. Open Annotation Lab.
2. Ask teammates / nearby hackers to drag-rank all 5 commentary options for 3-5 tasks.
3. Export CSV.
4. Save as `data/annotations/terac_labels.csv`.
5. Run:

```bash
node scripts/compute-metrics.mjs data/annotations/terac_labels.csv
```

Use these numbers in Devpost and judging.

## 3. Record video

Use `docs/DEMO_VIDEO_SHOTLIST.md`.

Required shots:

1. Problem: commentary assumes sight.
2. Main demo: ask “What just happened?” and “Why did the crowd react?”
3. Annotation Lab: show drag-ranking five commentary variations and the “why this is best” explanation.
4. Eval Dashboard: show improvement metrics.
5. Sponsor stack close.

Also capture at least 5 screenshots for Devpost:

1. Home/demo page with a selected match moment.
2. Voice question and generated answer.
3. Annotation Lab drag-ranking task.
4. Eval Dashboard / metric output.
5. Architecture or sponsor stack section from README/docs.

## 4. Table judging

Use `docs/JUDGING_SCRIPT.md`.

Core line:

> We are not replacing commentators. We are adding the missing visual layer, personalized and voice-first, for fans who have been excluded from the world's most visual sport.

## 5. Devpost tracks

Submit to:

- Ddoski's World
- Terac
- Deepgram
- Gemini / Google AI, if available as a track
- Redis
- Arize
- Sentry if you mention reliability/fallbacks

## 6. Do not overclaim

Say:

- MVP uses structured event logs / visual moments.
- Architecture supports live video captions or event feeds.
- Core innovation is voice-first accessibility + human-labeled improvement loop.

Do not say:

- Fully live computer vision is solved.
- It replaces commentators.
- It is medically/safety certified.
