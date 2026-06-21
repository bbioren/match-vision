// MatchVision background — routes messages + handles Claude voice agent
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
    handleVoiceQuery(msg.tabId, msg.text, msg.currentParams, msg.history || []);
    return;
  }

  if (msg.type === 'voice-error') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'voice-response', error: msg.error }).catch(() => {});
    return;
  }
});

async function handleVoiceQuery(tabId, transcript, currentParams, history) {
  const { anthropicApiKey } = await chrome.storage.local.get('anthropicApiKey');
  console.log('[MV voice] key present:', !!anthropicApiKey, 'prefix:', anthropicApiKey?.slice(0, 12));
  if (!anthropicApiKey) {
    chrome.tabs.sendMessage(tabId, {
      type: 'voice-response',
      error: 'No API key. Enter your Anthropic API key in the panel settings.',
    }).catch(() => {});
    return;
  }

  const systemPrompt = `You are the MatchVision eye-tracking assistant, always listening while the user watches video.

WHEN TO IGNORE: Reply with exactly "__ignore__" (nothing else) ONLY if the speech is unmistakably not directed at you — e.g. the user is clearly talking to another person in the room, or making an isolated comment about the video like "what a goal!". When in doubt, respond.

WHEN TO RESPOND (always respond to these):
- Any command about zoom, tracking, smoothness, speed, settings
- Any question about how the extension works
- Short phrases like "more", "less", "stop", "start", "reset" — these are follow-up commands
- Anything that could plausibly be a request or question to a voice assistant

Keep responses to 1-2 short sentences — spoken aloud. Use tools to change settings immediately.

Your reply is converted directly to speech. Respond in plain spoken language only — no markdown, no asterisks, no bullet points, no headers, no code formatting.

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
      description: 'Start eye tracking, stop eye tracking, or reset the pan position to center',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'reset_pan'],
            description: 'start=begin tracking, stop=end tracking, reset_pan=center the view',
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
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
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
