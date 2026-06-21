# MatchVision

**Commentary tells you the game. MatchVision lets you see it.**

MatchVision is a voice-first accessibility companion that gives blind and low-vision soccer fans the missing visual layer of a soccer match: ball location, player positioning, direction of attack, and why key moments matter.

## What's in this repo

Two parts that share one accessibility mission:

1. **Chrome extension (`extension/`)** — a gaze-controlled zoom/pan tracker that works on *any* web video, plus an always-on Claude voice agent. Say "Match Vision, what just happened?" and Claude answers out loud via Deepgram TTS (browser TTS as fallback), and can drive the tracker itself (zoom in, reset, follow the ball) via tool calls.
2. **Web app (`src/`, `local-server.mjs`)** — the original ADC (audio description) demo: structured match-moment timelines, a voice/text Q&A flow, a Terac annotation lab for collecting human accessibility labels, and an eval dashboard showing measured improvement from those labels.

## Run the demo

### Web app

```bash
npm run dev
```

Open:

- Main demo: <http://localhost:5173>
- Annotation Lab: <http://localhost:5173/annotate.html>
- Eval Dashboard: <http://localhost:5173/eval.html>

No install or API keys required for the static MVP — it falls back to a deterministic local description and browser speech APIs. Add `GEMINI_API_KEY`/`ANTHROPIC_API_KEY` (see below) for real model-generated descriptions.

### Chrome extension

1. `cp extension/secrets.example.js extension/secrets.js` and fill in `MV_ANTHROPIC_KEY`/`MV_DEEPGRAM_KEY`. `extension/secrets.js` is gitignored — it's never committed, so real keys never hit GitHub.
2. Open `chrome://extensions`, enable Developer Mode, "Load unpacked", select `extension/`.
3. Open any page with video (YouTube, a broadcast stream, etc.) and click the MatchVision icon.
4. Click the mic button and talk — Claude answers (spoken via Deepgram, falling back to browser TTS), and can zoom/pan/reset the tracker for you.

## Current status

- Gaze-controlled video zoom/pan extension (WebGazer-based), with a Claude voice agent layered on top that can both answer questions and control the tracker.
- Structured match-moment web demo with voice/text Q&A and spoken fallback.
- Terac annotation lab: drag-rank 5 commentary variations per clip, collect human accessibility labels.
- Real Terac MCP integration (`scripts/terac-agent.mjs`) that creates a paid labeling opportunity, polls for submissions, and approves them against a budget guardrail — not just a UI mockup.
- Gemini/Claude-generated commentary candidates (`scripts/generate-candidates.mjs`) feed the annotation lab instead of hand-written examples.
- Prompt-optimization pipeline that learns a "champion prompt" from Terac preference labels, plus a DPO dataset exporter for fine-tuning.
- Analytics-replay data source: real StatsBomb matches converted to structured moment timelines via `kloppy` + `socceraction` (xT + VAEP), synced to real broadcast footage — no live VLM required.
- `npm run check` / `npm run metrics` / `npm run eval-ranker` pass; see numbers via those scripts rather than stale copy here.

## Validate data

```bash
npm run check
npm run metrics
```

## Analytics-replay clips (StatsBomb ground truth, no live VLM needed)

Alongside the live-video pipeline, the demo includes a second data source: real StatsBomb open-data matches converted to a structured moment timeline via `kloppy` + `socceraction` (xT + VAEP), with no broadcast video required. See `analytics/build_state_frames.py`.

Currently wired into `data/clips.json`:
- **Turkey vs Italy, Euro 2020 group stage** (`turkey_vs_italy_euro2020_analytics`) — ticker only, no video.
- **Argentina vs France, 2022 World Cup Final** (`argentina_vs_france_wc2022_final_analytics`) — ticker synced to FIFA's official full-match YouTube upload via a `video_offset_seconds` kickoff offset.

Regenerate a timeline (requires the `analytics/.venv` — Python 3.12, see `analytics/requirements.txt`):
```bash
cd analytics && source .venv/bin/activate
python fit_models.py                                    # fits xT + VAEP once, caches to analytics/cache/
python build_state_frames.py                             # default: Turkey vs Italy
python build_state_frames.py --match-id 3869685 --out ../data/analytics/argentina_vs_france_wc2022_final_timeline.json
```

## AI generation credentials

For the annotation candidate generator (`scripts/generate-candidates.mjs`) and `/api/describe`, use either Gemini or Anthropic — both support vision (frame analysis) and text generation:

```bash
# Gemini
GEMINI_API_KEY=your_google_ai_studio_key
GEMINI_MODEL=gemini-2.5-flash       # optional, this is the default

# Anthropic
ANTHROPIC_API_KEY=your_anthropic_key
ANTHROPIC_MODEL=claude-haiku-4-5-20251001   # optional, this is the default
```

`GOOGLE_API_KEY` is also accepted as an alias for `GEMINI_API_KEY`. Set `LLM_PROVIDER=gemini` or `LLM_PROVIDER=anthropic` to force one; otherwise both `local-server.mjs` and `generate-candidates.mjs` auto-detect (Gemini first if both keys are set).

The Chrome extension's voice agent calls the Anthropic API directly from the browser using `MV_ANTHROPIC_KEY` from `extension/secrets.js` (gitignored — see `extension/secrets.example.js`). TTS uses `MV_DEEPGRAM_KEY` from the same file, falling back to browser TTS if it's unset or the call fails.

## Terac fine-tune pipeline (human labels → better commentary prompt)

See [`docs/TERAC_FINETUNE_PLAN.md`](./docs/TERAC_FINETUNE_PLAN.md) for the full design. Short version — zero labels to a champion prompt:

1. **Generate real AI candidates** (replaces hand-written commentary variations):
   ```bash
   GEMINI_API_KEY=your_key node scripts/generate-candidates.mjs
   # or Anthropic instead:
   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=your_key node scripts/generate-candidates.mjs
   # or one clip at a time:
   GEMINI_API_KEY=your_key node scripts/generate-candidates.mjs --clip yt_eng_cro_12
   # sanity-check without burning quota / without a key at all:
   node scripts/generate-candidates.mjs --dry-run
   ```
   Writes real Gemini or Anthropic outputs (5 prompt strategies per clip) into `data/annotation_tasks.json`, tagged with `generation_provider`/`generation_model`.

2. **Collect Terac rankings** — open `annotate.html`, rank the 5 real candidates per clip. Locally this POSTs to `/api/labels` and is stored in `data/labels.local.json` (gitignored) by `local-server.mjs`; hosted Terac sessions use the same shape. For a real paid Terac run, see `scripts/terac-agent.mjs` (`npm run terac`), which launches and manages the opportunity end-to-end via Terac's MCP API.

3. **Build the preference dataset**:
   ```bash
   node scripts/build-preference-dataset.mjs --api=http://localhost:5173
   # -> data/training/preference_pairs.jsonl (+ summary.json)
   ```

4. **Learn the champion prompt** (Phase 3A — no GPU, no fine-tune budget needed):
   ```bash
   node scripts/optimize-prompt.mjs
   # -> data/prompts/champion_prompt.txt + data/prompts/champion_eval.json
   ```
   Finds the prompt strategy that wins most often, extracts the linguistic patterns of winning vs. losing commentary (ball-location rate, direction mentions, hedging, sentence length), and bakes them into an explicit system prompt. If `data/training/preference_pairs.jsonl` doesn't exist yet, this exits cleanly with instructions instead of crashing.

   `local-server.mjs` automatically loads `data/prompts/champion_prompt.txt` at startup (if present) and uses it as the system prompt for every `/api/describe` call, overriding the client-sent default — no code changes needed once the file exists. The response body includes `usedChampionPrompt: true/false` for debugging.

5. **Export a DPO fine-tune file** (Option B — stronger, needs a training budget):
   ```bash
   node scripts/export-dpo-dataset.mjs
   # -> data/training/dpo_dataset.jsonl, one {"prompt","chosen","rejected"} object per line
   node scripts/export-dpo-dataset.mjs --min-rank-gap=2   # keep only high-confidence pairs
   ```
   Ready for the OpenAI fine-tuning API, a local `trl` DPOTrainer run, or the Anthropic fine-tuning API once available.

### API keys needed, by step

| Step | Key | Where |
|---|---|---|
| Generate candidates | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) **or** `ANTHROPIC_API_KEY` | `.env`, read by `scripts/generate-candidates.mjs` |
| Collect labels | none | local — `local-server.mjs` writes `data/labels.local.json` |
| Real Terac labeling run | `TERAC_API_KEY` | `.env.local`, read by `scripts/terac-agent.mjs` |
| Build preference dataset | none | reads from the local server's `/api/labels` + `/api/sessions` |
| Optimize prompt | none | pure text-pattern analysis over `preference_pairs.jsonl` |
| Live ADC/Q&A with champion prompt | one of `DASHSCOPE_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | `.env`, read by `local-server.mjs` |
| Export DPO dataset | none | pure reshape of `preference_pairs.jsonl` |

Every step degrades gracefully without keys: `generate-candidates.mjs --dry-run` needs none, `optimize-prompt.mjs`/`export-dpo-dataset.mjs` report "no preference data yet" instead of crashing, and `/api/describe` falls back to the client's local deterministic description (`localAdc()`/`localAnswer()` in `src/app.js`) when no LLM key is configured.

## Key docs

- [`SCOPE.md`](./SCOPE.md): scope and architecture (the original plan — some sponsor integrations described there are seams/fallbacks rather than wired-up live services; see this README for what's actually implemented)
- [`TODO.md`](./TODO.md): sprint checklist
- [`docs/TERAC_ANNOTATION_PLAN.md`](./docs/TERAC_ANNOTATION_PLAN.md): labeling plan
- [`docs/TERAC_CENTRAL_STORY.md`](./docs/TERAC_CENTRAL_STORY.md): how Terac labels train the description selector
- [`docs/DEVPOST_DRAFT.md`](./docs/DEVPOST_DRAFT.md): submission draft
# Rebuild trigger
