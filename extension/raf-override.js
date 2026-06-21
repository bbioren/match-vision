// Must load BEFORE webgazer.min.js. Replaces rAF with setTimeout so WebGazer's
// prediction loop runs at full speed even when the window/iframe is not focused.
(function () {
  let _id = 0;
  const _pending = {};
  window.requestAnimationFrame = function (cb) {
    const id = ++_id;
    _pending[id] = setTimeout(() => { delete _pending[id]; cb(performance.now()); }, 30);
    return id;
  };
  window.cancelAnimationFrame = function (id) {
    clearTimeout(_pending[id]);
    delete _pending[id];
  };
})();
