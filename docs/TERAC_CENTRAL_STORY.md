# Terac-Central Story

MatchVision is intentionally built around Terac.

## What Terac labels train

The core model is a **description selector**. For each soccer moment, MatchVision generates several candidate audio descriptions:

- baseline commentary
- spatial accessibility description
- tactical context description
- brief live-audio description

Terac labelers rank which candidate is best for a blind or low-vision listener and score accessibility features: ball location, direction of attack, key-event coverage, concision, hallucination, and helpfulness.

Those labels tune the selector weights:

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

1. Annotation Lab: humans rank candidate descriptions.
2. Main app: selected output is chosen by the Terac-tuned selector.
3. Eval dashboard: selector beats baseline on accessibility metrics.
