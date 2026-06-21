# Terac Annotation Plan

## Goal

Use real human rankings collected during the hackathon to improve MatchVision's soccer commentary for blind and low-vision fans.

## What annotators see

For each task, annotators see:

1. A short soccer clip, usually 10 seconds
2. Five actual commentary variations for that clip
3. A drag-and-drop ranking interface
4. One explanation question about why the #1 commentary is best

Annotators are ranking the commentary text itself, not the prompt that created it.

## Label task

### Required action

Drag the five commentary options into best-to-worst order:

- `#1` = most useful commentary for a blind or low-vision soccer fan
- `#5` = weakest commentary

### Required explanation

Answer:

> Why is your #1 commentary the best? Describe the exact features of the commentary that made it strongest.

Good explanations should mention specific commentary features, such as:

- clear ball location
- direction of attack
- nearby pressure or open space
- key event or likely next action
- concise spoken wording
- avoiding unsupported or hallucinated details

## CSV schema

The Annotation Lab exports:

```csv
task_id,rank_1,rank_2,rank_3,rank_4,rank_5,best_commentary,why_best
```

Where:

- `rank_1` through `rank_5` are commentary IDs in ranked order
- `best_commentary` is the full text of the winning commentary
- `why_best` is the annotator's explanation

Save collected labels as:

```text
data/annotations/terac_labels.csv
```

## Metrics to report

From the rankings, report:

- Win rate by commentary style: how often each style is ranked #1
- Mean rank by commentary style: lower is better
- Top-2 rate: how often a style appears in the top two
- Explanation themes: common reasons annotators preferred the winner
- Held-out improvement: whether the selected commentary style performs better on clips not used for prompt tuning

## Held-out evaluation

Reserve at least 20-30% of clip tasks as held-out evaluation. Do not tune commentary wording on those tasks until final metric computation.

Current convention:

- `train`: use for prompt/commentary iteration
- `heldout`: use only for final evidence

## Minimum viable label target

- Good: 30 rankings
- Strong: 60 rankings
- Excellent: 100+ rankings

If there are 5 clip tasks, each annotator can produce 5 rankings. That means:

- 6 annotators = 30 rankings
- 12 annotators = 60 rankings
- 20 annotators = 100 rankings

## Terac sponsor pitch

> We built a custom accessibility annotation environment where humans watch real soccer clips and rank five commentary variations for blind and low-vision usefulness. Those rankings tell us which commentary features experts value most, such as ball location, direction of attack, pressure, concision, and avoiding unsupported claims. We use the ranked labels to improve MatchVision's commentary selection and evaluate the improvement on held-out clips.
