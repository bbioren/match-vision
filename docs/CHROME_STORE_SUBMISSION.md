# Chrome Web Store Submission Checklist

## Done already

- [x] `extension/icons/icon{16,48,128}.png` generated and wired into `manifest.json` (`icons` + `action.default_icon`).
- [x] `privacy.html` drafted at the repo root — deploy it (it'll go live automatically with your existing Vercel deployment, e.g. `https://<your-vercel-domain>/privacy.html`) and use that URL in the listing's "Privacy policy" field. **Edit the contact email in `privacy.html` if you don't want `ben.bioren@gmail.com` listed publicly.**
- [x] `scripts/package-extension.sh` — run it any time to produce `dist/matchvision-eye-tracker-v<version>.zip`, ready to upload.
- [x] `extension/secrets.js` (your real Anthropic + Deepgram keys) is included in the package, per your explicit decision. **Anyone who installs the extension can unzip it and read these keys.** Worth keeping an eye on usage/billing on both accounts once this is public, and rotating the keys if you ever see unexpected usage.

## You still need to do, manually

### 1. Developer account
- One-time $5 registration fee at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole) if you haven't registered before.

### 2. Screenshots (required, at least 1)
- 1280×800 or 640×400 PNG/JPEG, no alpha channel.
- Show the extension actually doing something: the floating circle + panel open, calibration dots, gaze-tracked zoom on a real video, the voice agent responding. I can't capture these for you — needs a real browser session.

### 3. Store listing copy
Draft below — edit to taste, then paste into the dashboard.

**Short description** (132 char max):
> Gaze-controlled zoom & pan for any video, plus a voice assistant — accessibility for low-vision users.

**Detailed description:**
> MatchVision Eye Tracker helps low-vision users follow video content more easily. It tracks where you're looking through your webcam (100% local — no video is ever uploaded) and automatically zooms and pans to keep that area in view. A built-in voice assistant lets you adjust zoom, pan speed, and sensitivity, or jump to fullscreen, completely hands-free.
>
> Features:
> - Gaze-controlled zoom & pan on any web video
> - Voice assistant (say "MatchVision...") for hands-free control
> - Adjustable sensitivity, pan speed, and webcam-position correction
> - Works on YouTube and most video sites
>
> Privacy: webcam frames are processed entirely in your browser and never leave your device. Voice audio is sent to Deepgram (speech-to-text/text-to-speech) and Anthropic (Claude) to power the assistant. See full privacy policy: <your privacy.html URL>

**Category:** Accessibility

**Language:** English

### 4. Permission justifications
The dashboard will ask you to justify each sensitive permission. Suggested text:

- **Host permission (`<all_urls>`)**: "The extension provides gaze-controlled zoom/pan for video on any website the user chooses to use it on, so it needs to be able to run on arbitrary pages."
- **`activeTab` / `tabs`**: "Used to identify the current tab so the background service worker can route voice commands and tracking state to the correct page."
- **`scripting`**: "Used to inject the fullscreen call into the page after granting real user activation (see `debugger` below)."
- **`debugger`**: "Used briefly and only when the user asks the voice assistant to make the video fullscreen. The Fullscreen API requires a real user gesture, which an async voice command doesn't carry; the debugger protocol is used to dispatch one synthetic input event so the browser grants real fullscreen permission, then immediately detaches. It is not used for any inspection, logging, or data collection." **Be aware this permission draws the most scrutiny in review — see the note below.**
- **Camera / microphone** (via `getUserMedia`, not a manifest permission but will be asked about): "Camera is used for client-side gaze estimation (WebGazer.js) — frames never leave the device. Microphone is used for the voice assistant, sent to Deepgram for transcription."

### 5. Review risk — `debugger` permission
Flagging again since it's the biggest risk to a smooth approval: `debugger` is one of the permissions Google's automated and manual review scrutinizes hardest, because it's normally reserved for actual DevTools-style tools. Expect either:
- An extended manual review (can take days to weeks beyond the normal ~hours-to-days turnaround), or
- A rejection/clarification request asking you to justify or remove it.

If that happens and you want a faster path to approval, the fallback is to drop `debugger`/`scripting` from `manifest.json` and let voice-triggered fullscreen fall back to maximizing the browser window only (the code already does this automatically if the debugger approach fails — see `forceVideoFullscreen()` in `extension/background.js`).

## Build/update flow going forward

1. Bump `"version"` in `extension/manifest.json`.
2. Run `./scripts/package-extension.sh`.
3. Upload the new zip from `dist/` to the existing listing in the Developer Dashboard.
