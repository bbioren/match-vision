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

## Key docs

- [`SCOPE.md`](./SCOPE.md): full scope and architecture
- [`TODO.md`](./TODO.md): sprint checklist
- [`docs/TERAC_ANNOTATION_PLAN.md`](./docs/TERAC_ANNOTATION_PLAN.md): labeling plan
- [`docs/DEVPOST_DRAFT.md`](./docs/DEVPOST_DRAFT.md): submission draft
