# Final Hackathon Checklist

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
# add ANTHROPIC_API_KEY and DEEPGRAM_API_KEY if available
```

## 2. Collect labels fast

Minimum target: 30 labels. Strong target: 60+ labels.

Process:

1. Open Annotation Lab.
2. Ask teammates / nearby hackers to label 3 tasks.
3. Export CSV.
4. Save as `data/annotations/real_labels.csv`.
5. Run:

```bash
node scripts/compute-metrics.mjs data/annotations/real_labels.csv
```

Use these numbers in Devpost and judging.

## 3. Record video

Use `docs/DEMO_VIDEO_SHOTLIST.md`.

Required shots:

1. Problem: commentary assumes sight.
2. Main demo: ask “What just happened?” and “Why did the crowd react?”
3. Annotation Lab: show baseline vs improved labels.
4. Eval Dashboard: show improvement metrics.
5. Sponsor stack close.

## 4. Table judging

Use `docs/JUDGING_SCRIPT.md`.

Core line:

> We are not replacing commentators. We are adding the missing visual layer, personalized and voice-first, for fans who have been excluded from the world's most visual sport.

## 5. Devpost tracks

Submit to:

- Ddoski's World
- Terac
- Deepgram
- Anthropic
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
