// Intercepts TF.js model fetches and redirects them to locally-bundled files,
// bypassing the tfhub.dev -> kaggle.com redirect chain that breaks in extension pages.
(function () {
  const MODEL_ROOTS = {
    'https://tfhub.dev/mediapipe/tfjs-model/face_detection/short/1':    'models/face_detection',
    'https://tfhub.dev/mediapipe/tfjs-model/face_landmarks_detection/face_mesh/1': 'models/face_landmarks',
  };

  const origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input instanceof Request ? input.url : String(input));
    for (const [prefix, localDir] of Object.entries(MODEL_ROOTS)) {
      if (url.startsWith(prefix)) {
        const filePart = url.slice(prefix.length).split('?')[0] || '/model.json';
        const localUrl = chrome.runtime.getURL(localDir + filePart);
        console.log('[MV interceptor] redirecting', url, '->', localUrl);
        return origFetch(localUrl, init);
      }
    }
    return origFetch(input, init);
  };
})();
