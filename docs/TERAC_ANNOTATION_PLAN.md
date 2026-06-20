# Terac Annotation Plan

## Goal

Use real human labels collected during the hackathon to improve MatchVision's accessibility descriptions for blind and low-vision soccer fans.

## What annotators see

For each task, show:

1. A short soccer clip or structured clip summary
2. A baseline description
3. An improved MatchVision description
4. A rubric focused on blind/low-vision usefulness

## Label questions

Use binary or 1-5 scale fields so metrics are fast to compute.

### Required fields

- Which description is more useful for a blind or low-vision fan?
  - baseline
  - improved
  - tie
- Does the improved description mention ball location?
  - yes/no
- Does it mention direction of attack?
  - yes/no
- Does it capture the key event?
  - yes/no
- Is it concise enough to be spoken during a live match?
  - 1-5
- Does it hallucinate or claim something unsupported?
  - yes/no
- Overall helpfulness for accessibility
  - 1-5

## Metrics to report

- Preference win rate: % improved descriptions preferred over baseline
- Ball-location coverage: % yes
- Direction coverage: % yes
- Key-event coverage: % yes
- Hallucination rate: % yes, lower is better
- Mean helpfulness: average 1-5 score

## Held-out evaluation

Reserve at least 20-30% of clip/question examples as held-out eval. Do not tune prompts on these until final metric computation.

## Minimum viable label target

- Good: 30 labels
- Strong: 60 labels
- Excellent: 100+ labels

If time is short, prioritize labels across all clips rather than many labels on only one clip.

## Terac sponsor pitch

> We built a custom accessibility annotation environment, collected real human labels during the event, used those labels to improve our description generator, and evaluated the improved system against a baseline on held-out examples. The result is a measurable increase in useful visual context for blind and low-vision soccer fans.
