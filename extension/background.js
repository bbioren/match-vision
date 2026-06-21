// MatchVision background — routes messages + handles Claude voice agent
importScripts('secrets.js');

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'get-tab-id') {
    sendResponse({ tabId: sender.tab.id });
    return true;
  }

  if (msg.type === 'calibration-point' || msg.type === 'calibration-done') {
    chrome.runtime.sendMessage({ target: 'tracker-window', ...msg }).catch(() => {});
    if (msg.type === 'calibration-done') {
      chrome.runtime.sendMessage({ target: 'tracker-window', type: 'start-gaze' }).catch(() => {});
    }
    return;
  }

  if (msg.type === 'tracker-window-ready') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'run-calibration' }).catch(() => {});
    return;
  }

  if (msg.type === 'gaze-from-tracker') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'gaze', x: msg.x, y: msg.y }).catch(() => {});
    return;
  }

  if (msg.type === 'stop-tracker-window') {
    chrome.runtime.sendMessage({ target: 'tracker-window', type: 'stop-gaze' }).catch(() => {});
    if (msg.tabId) chrome.tabs.sendMessage(msg.tabId, { type: 'remove-tracker-frame' }).catch(() => {});
    return;
  }

  // Content script finished listening → call Claude
  if (msg.type === 'voice-transcript') {
    handleVoiceQuery(msg.tabId, msg.text, msg.currentParams, msg.history || [], !!msg.wakeWordHeard);
    return;
  }

  if (msg.type === 'voice-error') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'voice-response', error: msg.error }).catch(() => {});
    return;
  }

  // A voice command has no real user gesture behind it, and Chrome requires
  // one for element.requestFullscreen(). Grant one for real via the debugger
  // protocol (a CDP-dispatched input event counts as genuine user activation,
  // unlike element.click()/dispatchEvent() from JS), then fullscreen the
  // actual video player.
  if (msg.type === 'request-video-fullscreen' && sender.tab) {
    forceVideoFullscreen(sender.tab.id, sender.tab.windowId);
    return;
  }
  if (msg.type === 'restore-window' && sender.tab) {
    chrome.windows.update(sender.tab.windowId, { state: 'normal' }).catch(() => {});
    return;
  }
});

function cdpSend(tabId, method, params) {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result);
    });
  });
}

async function forceVideoFullscreen(tabId, windowId) {
  let attached = false;
  try {
    await new Promise((resolve, reject) => {
      chrome.debugger.attach({ tabId }, '1.3', () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
    attached = true;

    // Click a near-corner spot, not the player itself, so we don't accidentally
    // toggle play/pause — the activation this grants applies to the whole
    // document, not just the clicked element.
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: 2, y: 2, button: 'left', clickCount: 1 });
    await cdpSend(tabId, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: 2, y: 2, button: 'left', clickCount: 1 });

    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        // YouTube's own player chrome (controls, captions) lives on this wrapper —
        // fullscreening the bare <video> would lose all of that.
        const el = document.querySelector('.html5-video-player') || document.querySelector('video');
        el?.requestFullscreen?.().catch(() => {});
      },
    });
  } catch (err) {
    console.warn('[MV fullscreen] CDP approach failed, maximizing window instead:', err.message);
    chrome.windows.update(windowId, { state: 'fullscreen' }).catch(() => {});
  } finally {
    if (attached) chrome.debugger.detach({ tabId }).catch(() => {});
  }
}

async function handleVoiceQuery(tabId, transcript, currentParams, history, wakeWordHeard) {
  const anthropicApiKey = MV_ANTHROPIC_KEY;
  if (!anthropicApiKey) {
    chrome.tabs.sendMessage(tabId, {
      type: 'voice-response',
      error: 'No Anthropic key configured. Add one to extension/secrets.js.',
    }).catch(() => {});
    return;
  }

  const systemPrompt = `You are the MatchVision eye-tracking assistant, always listening while the user watches video.

WHEN TO IGNORE: Reply with exactly "__ignore__" (nothing else) ONLY if the speech is unmistakably not directed at you — e.g. the user is clearly talking to another person in the room, or making an isolated comment about the video like "what a goal!". When in doubt, respond.

WHEN TO RESPOND (always respond to these):
- Any command about zoom, tracking, smoothness, speed, settings
- Any command about fullscreen (e.g. "go fullscreen", "make it full screen", "exit fullscreen")
- Any question about how the extension works
- Short phrases like "more", "less", "stop", "start", "reset" — these are follow-up commands
- Anything that could plausibly be a request or question to a voice assistant

Keep responses to ONE short sentence, two at most — spoken aloud through a TTS API whose latency scales with reply length, so brevity is critical even for open-ended questions like "tell me about yourself." Use tools to change settings immediately.

Exception: when the user asks to start tracking (control_tracking action=start), calibration runs first and the user needs to know what to do — your reply must briefly explain it before confirming, e.g. "Starting calibration — nine dots will appear one at a time, look at each one and hold still until it fills in." This is the one case where two sentences is expected, not just allowed.

Your reply is converted directly to speech. Respond in plain spoken language only — no markdown, no asterisks, no bullet points, no headers, no code formatting.
${wakeWordHeard ? '\nThe user just said the "MatchVision" wake phrase to address you directly (speech-to-text sometimes mangles it into something like "mattress" or "match division" before the wake-word matcher strips it — that part has already been removed from this transcript). They are definitely talking to you: never reply "__ignore__" to this message. If there is no clear request left after the wake phrase, just greet them briefly and ask how you can help.' : ''}

Current settings:
- Zoom: ${currentParams.zoom?.toFixed(1)}x
- Pan speed: ${currentParams.panSpeed}
- Gaze smoothing: ${currentParams.gazeSmooth?.toFixed(2)}
- kP: ${currentParams.kP?.toFixed(2)}, kI: ${currentParams.kI?.toFixed(3)}, kD: ${currentParams.kD?.toFixed(3)}
- Y bias: ${currentParams.yBias}px, Y scale: ${currentParams.yScale?.toFixed(2)}
- Tracking: ${currentParams.isTracking ? 'active' : 'stopped'}

Parameter guide:
- zoom (1.2–6): video magnification level
- panSpeed (1–20): how fast the view follows your gaze
- gazeSmooth (0.02–0.5): 0.02=jittery but instant, 0.5=very smooth but laggy
- kP: how aggressively it follows gaze (raise if sluggish)
- kI: corrects drift (lower if tracking feels sticky)
- kD: dampens overshoot (raise if panning oscillates)
- yBias (-200 to 400px): shift gaze estimate downward (increase if webcam above screen makes tracking run high)
- yScale (0.5–2.5): amplify vertical gaze range (increase if you feel insensitive to looking down)

When the user asks to change a setting, use the adjust_params tool. Always confirm what you changed.`;

  const tools = [
    {
      name: 'adjust_params',
      description: 'Adjust one or more eye-tracking parameters in real time',
      input_schema: {
        type: 'object',
        properties: {
          zoom:       { type: 'number', description: 'Zoom level 1.2–6' },
          panSpeed:   { type: 'number', description: 'Pan speed 1–20' },
          gazeSmooth: { type: 'number', description: 'Gaze smoothing 0.02–0.5' },
          kP:         { type: 'number', description: 'Proportional gain 0.01–0.5' },
          kI:         { type: 'number', description: 'Integral gain 0–0.2' },
          kD:         { type: 'number', description: 'Derivative gain 0–0.3' },
          yBias:      { type: 'number', description: 'Y offset in pixels -200 to 400' },
          yScale:     { type: 'number', description: 'Y scale factor 0.5–2.5' },
        },
      },
    },
    {
      name: 'control_tracking',
      description: 'Start eye tracking, stop eye tracking, reset the pan position, or toggle fullscreen for the video',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'reset_pan', 'fullscreen', 'exit_fullscreen'],
            description: 'start=begin tracking, stop=end tracking, reset_pan=center the view, fullscreen=make the video fullscreen, exit_fullscreen=leave fullscreen',
          },
        },
        required: ['action'],
      },
    },
  ];

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 80,
        system: systemPrompt,
        tools,
        messages: [...history, { role: 'user', content: transcript }],
      }),
    });

    const data = await res.json();
    console.log('[MV voice] Claude status:', res.status, data.error ?? 'ok');
    if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));

    let text = '';
    let paramChanges = {};
    let action = null;
    for (const block of data.content || []) {
      if (block.type === 'text') text = block.text;
      if (block.type === 'tool_use' && block.name === 'adjust_params') paramChanges = block.input;
      if (block.type === 'tool_use' && block.name === 'control_tracking') action = block.input.action;
    }
    if (!text && (Object.keys(paramChanges).length || action)) text = 'Done.';
    const ignore = text.trim() === '__ignore__';

    chrome.tabs.sendMessage(tabId, {
      type: 'voice-response',
      text: ignore ? '' : text,
      params: paramChanges,
      action,
      userText: transcript,
      ignore,
    }).catch(() => {});
  } catch (err) {
    chrome.tabs.sendMessage(tabId, { type: 'voice-response', error: 'Claude error: ' + err.message }).catch(() => {});
  }
}
