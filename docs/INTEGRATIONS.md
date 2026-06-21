# Integration Notes

The app is intentionally runnable without credentials. Real sponsor APIs can be swapped in through small adapter seams.

## Gemini

Current seam: `src/services/description.js`.

- `buildDescriptionPrompt(log, question, mode)` creates the prompt.
- `generateAccessibleDescription()` uses deterministic fallback unless `window.MATCHVISION_USE_GEMINI` is enabled and `/api/describe` exists. The local server calls Gemini when `GEMINI_API_KEY` or `GOOGLE_API_KEY` is present.

Expected `/api/describe` response:

```json
{ "description": "spoken accessible match description" }
```

## Deepgram

Current seam: `src/services/voice.js`.

- Browser speech recognition/TTS works now as fallback.
- For real Deepgram TTS, enable `window.MATCHVISION_USE_DEEPGRAM` and implement `/api/tts` returning audio bytes.
- For real Deepgram STT, replace `setupSpeechRecognition()` internals with Deepgram streaming or prerecorded audio upload.

## Redis

Current seam: `src/services/memory.js`.

- LocalStorage stores recent match questions and preference mode.
- Replace `loadMemory()` / `saveMemory()` with Redis commands for real deployment.

Suggested Redis keys:

- `matchvision:session:{sessionId}:memory`
- `matchvision:session:{sessionId}:preferences`
- `matchvision:clip:{clipId}:events`

## Arize

Current fallback: `eval.html`.

Log each generated answer with:

- clip id
- question
- mode
- generated answer
- retrieved event state
- human/eval labels
- hallucination flag
- helpfulness score

## Local server

Run:

```bash
cp .env.example .env
# fill GEMINI_API_KEY and/or DEEPGRAM_API_KEY if available
npm run dev
```

The server exposes:

- `POST /api/describe`: calls Gemini when `GEMINI_API_KEY` or `GOOGLE_API_KEY` exists, otherwise returns fallback mode.
- `POST /api/tts`: calls Deepgram when `DEEPGRAM_API_KEY` exists, otherwise browser TTS fallback remains available.
