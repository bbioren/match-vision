// MatchVision background — routes messages between content script and tracker iframe
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Content script asks for its own tab ID (content scripts can't get this directly)
  if (msg.type === 'get-tab-id') {
    sendResponse({ tabId: sender.tab.id });
    return true;
  }

  // Forward calibration points from content script → tracker iframe
  if (msg.type === 'calibration-point' || msg.type === 'calibration-done') {
    chrome.runtime.sendMessage({ target: 'tracker-window', ...msg }).catch(() => {});
    if (msg.type === 'calibration-done') {
      chrome.runtime.sendMessage({ target: 'tracker-window', type: 'start-gaze' }).catch(() => {});
    }
    return;
  }

  // Tracker iframe is ready → trigger calibration on the YouTube tab
  if (msg.type === 'tracker-window-ready') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'run-calibration' }).catch(e => {
      console.error('[MV bg] run-calibration failed:', e.message);
    });
    return;
  }

  // Tracker iframe sends gaze → forward to content script
  if (msg.type === 'gaze-from-tracker') {
    chrome.tabs.sendMessage(msg.tabId, { type: 'gaze', x: msg.x, y: msg.y }).catch(() => {});
    return;
  }

  // Stop: remove iframe via message to content script
  if (msg.type === 'stop-tracker-window') {
    chrome.runtime.sendMessage({ target: 'tracker-window', type: 'stop-gaze' }).catch(() => {});
    if (msg.tabId) {
      chrome.tabs.sendMessage(msg.tabId, { type: 'remove-tracker-frame' }).catch(() => {});
    }
    return;
  }
});
