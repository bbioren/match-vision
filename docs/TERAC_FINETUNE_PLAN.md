# MatchVision x Terac: Fine-Tuning Plan

## Goal

Use Terac human rankings to fine-tune a model that generates **better accessibility
commentary (ADC) directly** -- not just to pick among pre-written candidates, but to
produce richer, more accurate descriptions from scratch.

---

## How the Current System Works (and its limits)

```
annotation_tasks.json
  └─ 5 hand-written commentary_variations per clip
        ↓
  Annotation Lab: human drags them into best-to-worst order
        ↓
  terac_labels.csv (rank_1…rank_5 + why_best)
        ↓
  ranker.js: hardcoded feature weights pick best candidate at runtime
```

**Problems:**
1. Candidates are hand-written -- the AI never generates them, so human rankings
   don't improve any model, they just pick among our own prose.
2. `ranker.js` weights are frozen guesses, never updated from label data.
3. There is no generation model to tune -- just a scorer over static text.

---

## Revised Pipeline (Three Phases)

### Phase 1 — Generate AI Candidates (replace hand-writing)

Instead of manually writing the 5 commentary options, call Claude with 5 different
prompt strategies per clip and store the real AI outputs as candidates.

```
clip_summary + structured event log
        ↓
  Claude called 5× with different system prompts:
    (a) Spatial      — prioritize ball location and player positions
    (b) Tactical     — emphasize shape, pressure, likely next action
    (c) Concise      — ≤2 sentences, live-audio style
    (d) Narrative    — vivid emotional framing for the blind/LV fan
    (e) Baseline     — generic, minimal prompt (control)
        ↓
  commentary_variations[a..e] written into annotation_tasks.json
```

**Script to build:** `scripts/generate-candidates.mjs`
- Reads `data/annotation_tasks.json`
- Calls `ANTHROPIC_API_KEY` via Claude API for each clip × each style
- Writes real AI outputs back as `commentary_variations`
- Marks each candidate with its `prompt_strategy` field

Now when humans rank in the Annotation Lab, they are ranking **real model outputs**.

---

### Phase 2 — Collect Terac Rankings (what already exists, now meaningful)

The Annotation Lab stays exactly the same UX. But now:

- Each candidate has a `prompt_strategy` tag
- Exported `terac_labels.csv` maps `rank_1…rank_5` to real AI outputs
- The `why_best` free-text field captures the linguistic features humans value

From N rankings, derive a **preference dataset**:

```
For each task, for each pair (winner, loser):
  {
    "clip_summary": "...",
    "chosen": "<text of higher-ranked candidate>",
    "rejected": "<text of lower-ranked candidate>",
    "chosen_strategy": "spatial",
    "rejected_strategy": "baseline",
    "annotator_reason": "..."   // from why_best
  }
```

**Script to build:** `scripts/build-preference-dataset.mjs`
- Reads `data/annotations/terac_labels.csv`
- Joins back to `annotation_tasks.json` for full candidate texts
- Expands each ranking into N*(N-1)/2 = 10 ordered pairs per task
- Outputs `data/training/preference_pairs.jsonl`

---

### Phase 3 — Fine-Tune the Commentary Generator

With the preference dataset, fine-tune a model to generate ADC commentary that
humans prefer, without needing to score pre-written candidates at all.

#### Option A — Prompt Optimization (fastest, no GPU needed)

Use the preference pairs to **automatically improve the Claude system prompt**:

```
Input:  preference_pairs.jsonl
Process:
  1. Find the prompt_strategy that wins most often (say "spatial")
  2. Extract common linguistic patterns from winning texts
     (ball location mentioned, direction named, ≤3 sentences, no hedging)
  3. Build a new "champion prompt" that encodes those patterns explicitly
  4. Evaluate champion prompt on held-out clips vs old baseline prompt
Output: data/prompts/champion_prompt.txt  +  eval metrics
```

**Script:** `scripts/optimize-prompt.mjs`

This is the fastest path and already fits the Terac judging story.
Human rankings → learned prompt → better outputs on held-out clips.

#### Option B — RLHF / DPO Fine-Tune (strongest, requires training budget)

Use the preference pairs as a **Direct Preference Optimization (DPO)** dataset to
fine-tune a smaller open model (e.g. `mistral-7b`, `llama-3-8b`) or submit to
Anthropic's fine-tuning API when available.

DPO format (already what `preference_pairs.jsonl` produces):
```jsonl
{"prompt": "Describe this soccer moment for a blind fan: ...",
 "chosen": "Harry Kane stands over a free kick...",
 "rejected": "England have a free kick near Croatia's goal."}
```

Fine-tune with:
- **Anthropic fine-tuning API** (if available) -- stays in the Claude ecosystem
- **OpenAI fine-tuning** (`gpt-4o-mini`) -- cheap, fast, good baseline
- **Local DPO** via `trl` library on a rented GPU (A100 ~$1.50/hr on Lambda Labs)

Evaluation: run fine-tuned model on held-out clips, compare against base model
using both automated metrics and a blind eval round in the Annotation Lab.

#### Option C — Few-Shot Retrieval (zero extra training cost)

Use the ranked pairs as **retrieval examples** at inference time:

```
At runtime, for a new clip:
  1. Find the 3 most similar clips by clip_summary embedding
  2. For each, retrieve the #1-ranked commentary (the human winner)
  3. Inject them as few-shot examples into the Claude prompt
  4. Claude generates commentary conditioned on winning examples
```

No fine-tuning, no GPU, but meaningfully better than a blank prompt.
Good fallback if Phase 3A/B aren't ready in time.

---

## Updated Data Flow

```
Clip video / clip_summary
        │
        ▼
scripts/generate-candidates.mjs
  → Claude ×5 strategies
  → annotation_tasks.json (real AI outputs)
        │
        ▼
Annotation Lab (annotate.html)
  → humans rank 5 real candidates
  → terac_labels.csv
        │
        ▼
scripts/build-preference-dataset.mjs
  → preference_pairs.jsonl
        │
        ├──▶ Option A: scripts/optimize-prompt.mjs
        │      → champion_prompt.txt
        │      → eval on held-out clips
        │
        ├──▶ Option B: DPO fine-tune
        │      → fine-tuned model endpoint
        │      → eval on held-out clips
        │
        └──▶ Option C: scripts/build-retrieval-index.mjs
               → runtime few-shot injection
               → eval on held-out clips
        │
        ▼
app.js: uses champion prompt / fine-tuned model / retrieval
  → better ADC at runtime for blind/LV users
```

---

## What Changes in the Codebase

| File | Change |
|---|---|
| `scripts/generate-candidates.mjs` | **New** — calls Claude ×5, writes real AI outputs to annotation_tasks.json |
| `scripts/build-preference-dataset.mjs` | **New** — CSV rankings → preference_pairs.jsonl |
| `scripts/optimize-prompt.mjs` | **New** — preference pairs → champion prompt + eval |
| `src/ranker.js` | **Deprecate** — replaced by champion prompt or fine-tuned model |
| `data/annotation_tasks.json` | **Updated** — candidates are now real Claude outputs with `prompt_strategy` field |
| `data/training/preference_pairs.jsonl` | **New artifact** — the actual training data |
| `data/prompts/champion_prompt.txt` | **New artifact** — learned prompt from Phase 3A |

---

## Evaluation (Terac Judging Story)

For each phase, compare against the baseline (option `e`, generic prompt) on
held-out clips using both:

**Automated metrics** (existing `compute-metrics.mjs`):
- ball location mentioned rate
- direction of attack mentioned rate
- key event captured rate
- estimated hallucination rate

**Human eval** (second Annotation Lab round on held-out clips):
- Run held-out clips through champion prompt / fine-tuned model
- Add those outputs as new candidates in the Annotation Lab
- Show that fine-tuned outputs rank #1 more often than baseline

**Target numbers:**

| Metric | Baseline | After fine-tune |
|--------|----------|----------------|
| Ball location rate | ~40% | >85% |
| Direction mentioned | ~30% | >80% |
| Human preference win vs baseline | 15% | >75% |
| Hallucination estimate | ~20% | <8% |

---

## Recommended Execution Order

1. **Now:** Build `generate-candidates.mjs` -- get real Claude outputs as candidates
2. **Collect:** Run Annotation Lab to get 30+ human rankings of real AI outputs  
3. **Process:** Run `build-preference-dataset.mjs` to produce `preference_pairs.jsonl`
4. **Quick win:** Run `optimize-prompt.mjs` (Option A) -- no GPU, shows immediate story
5. **Stretch:** Submit `preference_pairs.jsonl` to fine-tune API (Option B)
6. **Eval:** Run held-out eval, show before/after metrics to judges

---

## Why This Wins Terac

The revised story is stronger than the original:

> "We generated real AI commentary with five different strategies, had humans rank the AI
> outputs directly, converted those rankings into a preference dataset, and used it to
> fine-tune/optimize the generation model. On held-out clips the human never saw during
> annotation, the fine-tuned model produces commentary humans prefer 75%+ of the time
> over the baseline. Every ranking collected through Terac directly improved the model
> that blind and low-vision fans experience."

This satisfies all three rubric components:
- **50% improvement**: measured on unseen clips, derived from real Terac annotations
- **30% annotation UX**: Annotation Lab ranks real AI outputs, not hand-written prose
- **20% credit efficiency**: one ranking session produces 10 preference pairs (N*(N-1)/2)
