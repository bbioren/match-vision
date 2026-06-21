// Isolated-world injector — passes extension URLs into the MAIN world script
(function () {
  if (document.getElementById('mv-tracker-script')) return;
  const s = document.createElement('script');
  s.id = 'mv-tracker-script';
  s.src = chrome.runtime.getURL('tracker.js');
  s.dataset.webgazerUrl = chrome.runtime.getURL('webgazer.min.js');
  (document.head || document.documentElement).appendChild(s);
})();
