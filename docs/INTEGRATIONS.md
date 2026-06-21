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

Wired: `src/services/voice.js` + `/api/tts` in `local-server.mjs`.

- TTS is live: `window.MATCHVISION_USE_DEEPGRAM = true` (set in `index.html`) routes spoken answers through `POST /api/tts`, which calls Deepgram's `speak` endpoint (`aura-2-thalia-en`) when `DEEPGRAM_API_KEY` is set in `.env`. Falls back to browser TTS if the key is missing or the call fails.
- STT is still browser `SpeechRecognition` only (`setupSpeechRecognition()`). Real Deepgram STT would mean capturing a `MediaRecorder` blob and POSTing it to a new transcribe route — not done.

## Extension voice agent (Claude + Deepgram)

Separate from the web app — `extension/background.js` and `extension/tracker.js`.

- Keys come from `extension/secrets.js` (`MV_ANTHROPIC_KEY`, `MV_DEEPGRAM_KEY`), gitignored. Copy `extension/secrets.example.js` to `extension/secrets.js` and fill them in; no UI key entry, no `chrome.storage` involved.
- `background.js` calls `api.anthropic.com` directly with `MV_ANTHROPIC_KEY`. `tracker.js`'s `speak()` calls Deepgram's `speak` endpoint with `MV_DEEPGRAM_KEY`, falling back to browser TTS if unset or the call fails.

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
