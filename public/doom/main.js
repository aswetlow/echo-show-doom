// Host page for doom.wasm (based on github.com/jacobenget/doom.wasm, GPL-2.0, plus our sound patch in port/).
// The module imports 10 functions and exports initGame / tickGame / reportKeyDown / reportKeyUp.
// No Emscripten, no SDL: we draw the frame buffer to a 2D canvas and call tickGame at 35 Hz.
//
// Also: FPS / CPU overlay and reports to the server (POST /report), Alexa keep-alive.
//
// URL parameters:
//   ?alexa=1   opened by the skill: load the Alexa HTML SDK and send keep-alive messages
//   ?hud=0     hide the overlay
//   ?touch=1   force the touch controls on (they show automatically on touch screens), ?touch=0 hides them
'use strict';

var params = new URLSearchParams(location.search);
var IN_ALEXA = params.get('alexa') === '1';
var canvas = document.getElementById('canvas');
var hud = document.getElementById('hud');
var loadingEl = document.getElementById('loading');
if (params.get('hud') === '0') hud.style.display = 'none';

var TIC_MS = 1000 / 35; // Doom's fixed game rate

// ---------- Stats ----------
var stats = { wasmReadyMs: null, firstFrameMs: null, errors: [] };
var win = { tick: [], draw: [], frameGap: [] };   // report window (30 s)
var sec = { tick: [], draw: [], frames: 0 };       // HUD window (1 s)
var lastFrameAt = 0;
var winStart = 0;

function pct(arr, p) {
  if (!arr.length) return 0;
  var s = arr.slice().sort(function (a, b) { return a - b; });
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}
function avg(arr) { var t = 0; for (var i = 0; i < arr.length; i++) t += arr[i]; return arr.length ? t / arr.length : 0; }

// ---------- Rendering ----------
var ctx = canvas.getContext('2d', { alpha: false });
var mem = null, img = null, img32 = null, fbW = 0, fbH = 0;

function onGameInit(width, height) {
  fbW = width; fbH = height;
  canvas.width = width; canvas.height = height;
  img = ctx.createImageData(width, height);
  img32 = new Uint32Array(img.data.buffer);
}

function drawFrame(ptr) {
  var t0 = performance.now();
  // Doom pixels are 0xAARRGGBB, stored little endian (bytes B,G,R,A). ImageData wants bytes R,G,B,A,
  // i.e. 0xAABBGGRR as a little-endian uint32: swap R and B, force alpha.
  var src = new Uint32Array(mem.buffer, ptr, fbW * fbH);
  for (var i = 0; i < src.length; i++) {
    var p = src[i];
    img32[i] = 0xff000000 | ((p & 0xff) << 16) | (p & 0xff00) | ((p >>> 16) & 0xff);
  }
  ctx.putImageData(img, 0, 0);
  var now = performance.now();
  win.draw.push(now - t0); sec.draw.push(now - t0); sec.frames++;
  if (lastFrameAt) win.frameGap.push(now - lastFrameAt);
  lastFrameAt = now;
  if (stats.firstFrameMs === null) {
    stats.firstFrameMs = Math.round(now);
    winStart = now;
    loadingEl.style.display = 'none';
    setTimeout(function () { sendReport('loaded'); }, 3000);
  }
}

function readString(ptr, len) { return new TextDecoder().decode(new Uint8Array(mem.buffer, ptr, len)); }

var imports = {
  loading: {
    onGameInit: onGameInit,
    // No WAD data from us: the module uses its embedded, unmodified shareware doom1.wad.
    wadSizes: function () {},
    readWads: function () {},
  },
  ui: { drawFrame: drawFrame },
  runtimeControl: { timeInMilliseconds: function () { return BigInt(Math.trunc(performance.now())); } },
  console: {
    onInfoMessage: function (p, l) { console.log('[doom]', readString(p, l)); },
    onErrorMessage: function (p, l) { var m = readString(p, l); console.error('[doom]', m); stats.errors.push(m); },
  },
  // Sound effects (our build of doom.wasm adds this import module, see port/ and sound.js).
  sound: window.DoomSound ? window.DoomSound.imports : { startSfx: function () {}, stopSfx: function () {}, updateSfx: function () {}, isPlaying: function () { return 0; } },
  // Saving is not supported yet (localStorage is blocked in the Alexa web view anyway).
  gameSaving: { sizeOfSaveGame: function () { return 0; }, readSaveGame: function () { return 0; }, writeSaveGame: function () { return 0; } },
};

// ---------- Input (keyboard for the desktop; touch controls come in step 4) ----------
var doom = null;
var keyMap = null;
function doomKey(e) {
  if (keyMap[e.key] !== undefined) return keyMap[e.key];
  if (e.key.length === 1) return e.key.toLowerCase().charCodeAt(0);
  return null;
}
function onKey(down) {
  return function (e) {
    var k = doomKey(e);
    if (k === null) return;
    e.preventDefault();
    if (down) doom.reportKeyDown(k); else doom.reportKeyUp(k);
  };
}

// ---------- Game loop: tickGame at 35 Hz, driven by requestAnimationFrame ----------
var nextTic = 0;
function loop(now) {
  requestAnimationFrame(loop);
  if (now < nextTic) return;
  // If we fell far behind (tab hidden, long stall), don't try to catch up frame by frame.
  nextTic = Math.max(nextTic + TIC_MS, now - TIC_MS);
  var t0 = performance.now();
  try { doom.tickGame(); } catch (e) { stats.errors.push(String(e)); throw e; }
  var dt = performance.now() - t0;
  win.tick.push(dt); sec.tick.push(dt);
}

// ---------- HUD + reports ----------
setInterval(function () {
  if (stats.firstFrameMs === null) return;
  hud.textContent =
    sec.frames + ' fps\n' +
    'tick ' + avg(sec.tick).toFixed(1) + ' ms (max ' + (sec.tick.length ? Math.max.apply(null, sec.tick) : 0).toFixed(0) + ')\n' +
    'draw ' + avg(sec.draw).toFixed(1) + ' ms\n' +
    'load ' + (stats.firstFrameMs / 1000).toFixed(1) + ' s';
  sec = { tick: [], draw: [], frames: 0 };
}, 1000);

setInterval(function () { if (stats.firstFrameMs !== null) sendReport('running'); }, 30000);

function resourceTimings() {
  var out = {};
  performance.getEntriesByType('resource').forEach(function (e) {
    var name = e.name.split('/').pop().split('?')[0];
    if (/^(main\.js|doom\.wasm)$/.test(name)) out[name] = { ms: Math.round(e.duration), kb: e.transferSize ? Math.round(e.transferSize / 1024) : undefined };
  });
  return out;
}

function sendReport(stage) {
  var now = performance.now();
  var secs = winStart ? (now - winStart) / 1000 : 0;
  var frames = win.frameGap.length;
  var summary = {
    stage: stage,
    fps: secs ? (frames / secs).toFixed(1) + ' fps over ' + secs.toFixed(0) + ' s (target 35)' : 'n/a',
    'frame gap': frames ? 'p95 ' + pct(win.frameGap, 0.95).toFixed(0) + ' ms, worst ' + Math.max.apply(null, win.frameGap).toFixed(0) + ' ms, >50ms: ' + win.frameGap.filter(function (x) { return x > 50; }).length + '/' + frames : 'n/a',
    'tickGame cpu': win.tick.length ? 'median ' + pct(win.tick, 0.5).toFixed(1) + ' ms, p95 ' + pct(win.tick, 0.95).toFixed(1) + ' ms, max ' + Math.max.apply(null, win.tick).toFixed(0) + ' ms (budget 28.6)' : 'n/a',
    'draw cpu': win.draw.length ? 'median ' + pct(win.draw, 0.5).toFixed(1) + ' ms, p95 ' + pct(win.draw, 0.95).toFixed(1) + ' ms' : 'n/a',
    framebuffer: fbW + 'x' + fbH,
    'wasm ready': stats.wasmReadyMs !== null ? (stats.wasmReadyMs / 1000).toFixed(2) + ' s' : 'n/a',
    'first frame': stats.firstFrameMs !== null ? (stats.firstFrameMs / 1000).toFixed(2) + ' s' : 'n/a',
    downloads: JSON.stringify(resourceTimings()),
    audio: window.DoomSound ? window.DoomSound.state() : 'n/a',
    userAgent: navigator.userAgent,
  };
  if (stats.errors.length) summary.errors = stats.errors.slice(-5).join(' | ');
  win = { tick: [], draw: [], frameGap: [] };
  winStart = now;
  return fetch('/report', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'doom', alexa: IN_ALEXA, summary: summary }),
  }).catch(function () {});
}

window.addEventListener('error', function (e) { stats.errors.push(String(e.message || e)); });

// ---------- Start ----------
function start() {
  var load = WebAssembly.instantiateStreaming
    ? WebAssembly.instantiateStreaming(fetch('doom.wasm'), imports)
    : fetch('doom.wasm').then(function (r) { return r.arrayBuffer(); }).then(function (b) { return WebAssembly.instantiate(b, imports); });
  load.then(function (res) {
    doom = res.instance.exports;
    mem = doom.memory;
    if (window.DoomSound) window.DoomSound.init(function () { return mem; });
    stats.wasmReadyMs = Math.round(performance.now());
    keyMap = {
      ArrowUp: doom.KEY_UPARROW.value, ArrowDown: doom.KEY_DOWNARROW.value,
      ArrowLeft: doom.KEY_LEFTARROW.value, ArrowRight: doom.KEY_RIGHTARROW.value,
      Control: doom.KEY_FIRE.value, ' ': doom.KEY_USE.value, Shift: doom.KEY_SHIFT.value,
      Alt: doom.KEY_ALT.value, ',': doom.KEY_STRAFE_L.value, '.': doom.KEY_STRAFE_R.value,
      Tab: doom.KEY_TAB.value, Escape: doom.KEY_ESCAPE.value, Enter: doom.KEY_ENTER.value,
      Backspace: doom.KEY_BACKSPACE.value,
    };
    window.addEventListener('keydown', onKey(true));
    window.addEventListener('keyup', onKey(false));
    canvas.focus();
    doom.initGame();
    if (window.initTouchControls) window.initTouchControls(doom);
    requestAnimationFrame(loop);
  }).catch(function (e) {
    loadingEl.textContent = 'Failed to load Doom: ' + e;
    stats.errors.push('load: ' + e);
    sendReport('load-failed');
  });
}

// Start after "load" (in the second-screen project, earlier starts sometimes broke the skill response).
if (document.readyState === 'complete') start();
else window.addEventListener('load', function () { setTimeout(start, 0); });

// ---------- Alexa ----------
if (IN_ALEXA) {
  var sdk = document.createElement('script');
  sdk.src = 'https://cdn.html.games.alexa.a2z.com/alexa-html/latest/alexa-html.js';
  sdk.onload = function () {
    Alexa.create({ version: '1.1' }).then(function (r) {
      var alexa = r.alexa;
      alexa.skill.onMessage(function () {});
      // Keep-alive once a minute. Whether this extends the 30 min timeout is untested.
      setInterval(function () { try { alexa.skill.sendMessage({ type: 'keepalive' }); } catch (e) {} }, 60000);
    }).catch(function (e) { stats.errors.push('Alexa.create failed: ' + JSON.stringify(e)); });
  };
  document.head.appendChild(sdk);
}
