# Integration Notes

The app is intentionally runnable without credentials. Real sponsor APIs can be swapped in through small adapter seams.

## Claude / Anthropic

Current seam: `src/services/description.js`.

- `buildDescriptionPrompt(log, question, mode)` creates the prompt.
- `generateAccessibleDescription()` uses deterministic fallback unless `window.MATCHVISION_USE_CLAUDE` is enabled and `/api/describe` exists.

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
