# MatchVision

**Commentary tells you the game. MatchVision lets you see it.**

MatchVision is a voice-first accessibility companion that gives blind and low-vision soccer fans the missing visual layer of a soccer match: ball location, player positioning, direction of attack, and why key moments matter.

## Run the demo

```bash
npm run dev
```

Open <http://localhost:5173>.

No install is required for the current static MVP. It uses browser speech APIs as a local fallback while Deepgram integration is added.

## Hackathon sponsor strategy

- **Terac:** custom annotation task drag-ranking five commentary variations per clip, then before/after metrics.
- **Deepgram:** voice-first user questions and spoken answers.
- **Gemini:** accessible vision description generation and natural-language Q&A.
- **Redis:** match memory and user preference modes.
- **Arize:** evaluation evidence for helpfulness, event coverage, and hallucination reduction.

## Current MVP

- Static web demo
- 3 structured soccer match moments
- voice/text question flow
- spoken answer fallback using browser TTS
- drag-ranking Terac annotation lab with 5 commentary variations per clip
- initial metrics panel
- annotation task and metric scripts

## Validate data

```bash
npm run check
node scripts/compute-metrics.mjs
```

## AI generation credentials

For the annotation candidate generator and `/api/describe`, use a Google Gemini API key:

```bash
GEMINI_API_KEY=your_google_ai_studio_key
# optional, defaults to gemini-2.5-flash
GEMINI_MODEL=gemini-2.5-flash
```

`GOOGLE_API_KEY` is also accepted as an alias for `GEMINI_API_KEY`.

## Terac fine-tune pipeline (human labels → better commentary prompt)

See [`docs/TERAC_FINETUNE_PLAN.md`](./docs/TERAC_FINETUNE_PLAN.md) for the full design. Short version — zero labels to a champion prompt:

1. **Generate real AI candidates** (replaces hand-written commentary variations):
   ```bash
   GEMINI_API_KEY=your_key node scripts/generate-candidates.mjs
   # or one clip at a time:
   GEMINI_API_KEY=your_key node scripts/generate-candidates.mjs --clip yt_eng_cro_12
   # sanity-check without burning quota / without a key at all:
   node scripts/generate-candidates.mjs --dry-run
   ```
   Writes real Gemini outputs (5 prompt strategies per clip) into `data/annotation_tasks.json`.

2. **Collect Terac rankings** — open `annotate.html`, rank the 5 real candidates per clip. Locally this POSTs to `/api/labels` and is stored in `data/labels.local.json` (gitignored) by `local-server.mjs`; hosted Terac sessions use the same shape.

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
| Generate candidates | `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) | `.env`, read by `scripts/generate-candidates.mjs` |
| Collect labels | none | local — `local-server.mjs` writes `data/labels.local.json` |
| Build preference dataset | none | reads from the local server's `/api/labels` + `/api/sessions` |
| Optimize prompt | none | pure text-pattern analysis over `preference_pairs.jsonl` |
| Live ADC/Q&A with champion prompt | one of `DASHSCOPE_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | `.env`, read by `local-server.mjs` |
| Export DPO dataset | none | pure reshape of `preference_pairs.jsonl` |

Every step degrades gracefully without keys: `generate-candidates.mjs --dry-run` needs none, `optimize-prompt.mjs`/`export-dpo-dataset.mjs` report "no preference data yet" instead of crashing, and `/api/describe` falls back to the client's local deterministic description (`localAdc()`/`localAnswer()` in `src/app.js`) when no LLM key is configured.

## Key docs

- [`SCOPE.md`](./SCOPE.md): full scope and architecture
- [`TODO.md`](./TODO.md): sprint checklist
- [`docs/TERAC_ANNOTATION_PLAN.md`](./docs/TERAC_ANNOTATION_PLAN.md): labeling plan
- [`docs/DEVPOST_DRAFT.md`](./docs/DEVPOST_DRAFT.md): submission draft
