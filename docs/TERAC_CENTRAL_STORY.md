# Terac-Central Story

MatchVision is intentionally built around Terac.

## What Terac labels train

The core model is a **description selector**. For each soccer moment, MatchVision generates several candidate audio descriptions:

- baseline commentary
- spatial accessibility description
- tactical context description
- brief live-audio description

Terac labelers drag five actual commentary variations into best-to-worst order for blind or low-vision usefulness. They also explain why the #1 commentary wins, describing exact features such as ball location, direction of attack, pressure/open space, concision, and avoiding unsupported claims.

Those rankings tune the selector weights:

- reward ball location
- reward direction of attack
- reward key-event coverage
- reward concision for live audio
- penalize hallucination risk

## Why this is not bolted on

Without Terac labels, MatchVision is just another generated sports description. With Terac, it becomes a measurable human-in-the-loop optimization system for accessibility quality.

## Demo proof

Run:

```bash
npm run metrics
npm run eval-ranker
```

Show:

1. Annotation Lab: humans drag-rank five real commentary variations and explain why the winner is best.
2. Main app: selected output is chosen by the Terac-tuned selector.
3. Eval dashboard: selector beats baseline on accessibility metrics.
