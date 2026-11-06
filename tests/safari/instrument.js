// Se inyecta en una copia del juego para saber qué ocurre en el Safari real.
(function () {
  var send = function (type, data) { try { fetch('/log', { method: 'POST', body: JSON.stringify({ t: Math.round(performance.now()), type: type, data: data }) }).catch(function () {}); } catch (e) {} };
  ['error', 'warn'].forEach(function (k) { var o = console[k]; console[k] = function () { send('console.' + k, Array.prototype.map.call(arguments, String).join(' ').slice(0, 5000)); o.apply(console, arguments); }; });
  addEventListener('error', function (e) { send('onerror', e.message + ' @' + e.lineno + ':' + e.colno); });
  addEventListener('unhandledrejection', function (e) { send('rejection', String(e.reason)); });
  var gc = HTMLCanvasElement.prototype.getContext, gl = null;
  HTMLCanvasElement.prototype.getContext = function (k, o) {
    var c = gc.call(this, k, o);
    if (this.id === 'game' && c && !gl && /webgl/.test(k)) {
      gl = c;
      send('ctx', { kind: k, renderer: c.getParameter(c.RENDERER), ua: navigator.userAgent });
      this.addEventListener('webglcontextlost', function () { send('contextlost', ''); });
    }
    return c;
  };
  var raf = window.requestAnimationFrame.bind(window), frames = 0, first = 0, wanted = [], marks = { 30: 1, 120: 1, 300: 1, 600: 1, 900: 1 };
  window.requestAnimationFrame = function (cb) {
    return raf(function (t) {
      try { cb(t); } catch (e) { send('frame-throw', String(e) + ' ' + (e.stack || '').slice(0, 1500)); throw e; }
      frames++; if (!first) first = performance.now();
      if (gl && marks[frames]) {
        var w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, buf = new Uint8Array(4), out = [];
        [[.5, .5], [.5, .3], [.3, .5], [.7, .5]].forEach(function (p) { gl.readPixels(Math.floor(w * p[0]), Math.floor(h * p[1]), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf); out.push(Array.from(buf)); });
        send('pixels', { frames: frames, w: w, h: h, out: out, glError: gl.getError(), lost: gl.isContextLost(), fps: Math.round(frames / ((performance.now() - first) / 1000 || 1)), visible: document.visibilityState });
      }
      while (wanted.length) { var name = wanted.shift(); fetch('/shot?name=' + name, { method: 'POST', body: document.getElementById('game').toDataURL('image/png') }); }
    });
  };
  var at = function (ms, fn) { setTimeout(function () { try { fn(); } catch (e) { send('flow-error', String(e)); } }, ms); };
  var click = function (sel) { var e = document.querySelector(sel); if (!e) throw new Error('no hay ' + sel); e.click(); };
  addEventListener('load', function () {
    at(1500, function () { wanted.push('titulo'); });
    at(2000, function () { click('#menu'); });
    at(2500, function () { click('#play'); });
    at(11000, function () { wanted.push('partida'); send('hud', document.getElementById('hud').innerText.slice(0, 300)); });
    at(11500, function () { dispatchEvent(new KeyboardEvent('keydown', { key: 'v' })); });
    at(12400, function () { wanted.push('companero'); });
    at(13200, function () { send('fin', { frames: frames }); });
  });
})();
