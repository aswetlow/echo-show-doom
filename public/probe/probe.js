// Feasibility probe for running a Doom WebAssembly port inside the Alexa Web API for Games web view.
// Every result is shown on screen AND posted to the server (/report), because Amazon's docs say
// you cannot attach a remote debugger to an Echo Show.
'use strict';
window.__probeStarted = true;

const params = new URLSearchParams(location.search);
const IN_ALEXA = params.get('alexa') === '1';
const out = document.getElementById('out');
const statusEl = document.getElementById('status');

const report = { alexa: IN_ALEXA, url: location.href, startedAt: new Date().toISOString(), summary: {}, details: {}, errors: [] };
window.addEventListener('error', (e) => report.errors.push(String(e.message || e)));
window.addEventListener('unhandledrejection', (e) => report.errors.push('unhandled: ' + String(e.reason)));

// ---------- UI helpers ----------
function row(key, value, cls) {
  let tr = document.getElementById('r-' + key);
  if (!tr) {
    tr = document.createElement('tr');
    tr.id = 'r-' + key;
    tr.innerHTML = '<td class="k"></td><td class="v"></td>';
    tr.firstChild.textContent = key;
    out.appendChild(tr);
  }
  tr.lastChild.textContent = String(value);
  tr.lastChild.className = 'v ' + (cls || '');
  report.summary[key] = String(value);
}
function status(t) { statusEl.textContent = t; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmtMB = (b) => (b / 1048576).toFixed(1) + ' MB';

let reportSeq = 0;
function sendReport(stage) {
  report.stage = stage;
  report.seq = ++reportSeq;
  report.sentAt = new Date().toISOString();
  return fetch('/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) })
    .catch((e) => report.errors.push('report POST failed: ' + e));
}

// ---------- 1. Environment ----------
function probeEnvironment() {
  row('userAgent', navigator.userAgent);
  const chrome = /Chrome\/(\d+)/.exec(navigator.userAgent);
  row('chromeVersion', chrome ? chrome[1] : 'n/a', chrome && +chrome[1] >= 80 ? 'ok' : 'warn');
  row('hardwareConcurrency', navigator.hardwareConcurrency);
  row('deviceMemory', navigator.deviceMemory !== undefined ? navigator.deviceMemory + ' GB (rounded by the browser)' : 'n/a');
  row('screen', `${screen.width}x${screen.height}, inner ${innerWidth}x${innerHeight}, dpr ${devicePixelRatio}`);
  row('maxTouchPoints', navigator.maxTouchPoints);
  row('crossOriginIsolated', String(window.crossOriginIsolated) + ', SharedArrayBuffer: ' + (typeof SharedArrayBuffer));
  if (performance.memory) row('jsHeapSizeLimit', fmtMB(performance.memory.jsHeapSizeLimit));
}

// ---------- 2. WebAssembly ----------
// probe.wasm, inlined (source: probe.wat). Exports add(a,b), bench(n,seed), checksum(len), memory.
const PROBE_WASM_B64 = 'AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwAAAQUDAQACByMEBm1lbW9yeQIAA2FkZAAABWJlbmNoAAEIY2hlY2tzdW0AAgqMAQMHACAAIAFqCzYAAkADQCAARQ0BIAEgAUENdHMhASABIAFBEXZzIQEgASABQQV0cyEBIABBAWshAAwACwsgAQtLAQJ/AkADQCABIABPDQEgASABQfsBcDoAACABQQFqIQEMAAsLQQAhAQJAA0AgASAATw0BIAIgAS0AAGohAiABQQFqIQEMAAsLIAIL';
// Tiny module that only validates if WASM SIMD (v128) is supported.
const SIMD_WASM_B64 = 'AGFzbQEAAAABBQFgAAF7AwIBAAoNAQsAQQD9Ef0bAP0RCw==';
const b64bytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function jsBench(n, x) {
  while (n--) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; }
  return x >>> 0;
}
function expectedChecksum(len) { let s = 0; for (let i = 0; i < len; i++) s += i % 251; return s; }

let wasm = null;
async function probeWasm() {
  row('typeof WebAssembly', typeof WebAssembly, typeof WebAssembly === 'object' ? 'ok' : 'fail');
  if (typeof WebAssembly !== 'object') return;

  try {
    const { instance } = await WebAssembly.instantiate(b64bytes(PROBE_WASM_B64));
    wasm = instance.exports;
    const sum = wasm.add(2, 3);
    const len = 100000;
    const cs = wasm.checksum(len);
    const ok = sum === 5 && cs === expectedChecksum(len);
    row('wasm instantiate+run', ok ? `ok (add(2,3)=${sum}, memory checksum ok)` : `WRONG RESULT add=${sum} checksum=${cs}`, ok ? 'ok' : 'fail');
  } catch (e) { row('wasm instantiate+run', 'FAILED: ' + e, 'fail'); }

  // Emscripten builds load via instantiateStreaming, which needs Content-Type application/wasm.
  try {
    if (!WebAssembly.instantiateStreaming) throw new Error('instantiateStreaming missing');
    const t0 = performance.now();
    const { instance } = await WebAssembly.instantiateStreaming(fetch('probe.wasm', { cache: 'no-store' }));
    row('instantiateStreaming', `ok (${instance.exports.add(40, 2)}, ${(performance.now() - t0).toFixed(0)} ms incl. fetch)`, 'ok');
  } catch (e) { row('instantiateStreaming', 'FAILED: ' + e + ' (emscripten falls back to ArrayBuffer)', 'warn'); }

  try { row('wasm SIMD', WebAssembly.validate(b64bytes(SIMD_WASM_B64)) ? 'yes' : 'no', 'ok'); }
  catch (e) { row('wasm SIMD', 'error ' + e, 'warn'); }
}

// ---------- 3. CPU benchmark: same xorshift loop in JS and WASM ----------
async function probeCpu() {
  if (!wasm) return;
  const N = 30e6;
  status('CPU benchmark ...');
  await sleep(50);
  let t0 = performance.now();
  const rw = wasm.bench(N, 2463534242) >>> 0;
  const tw = performance.now() - t0;
  await sleep(50);
  t0 = performance.now();
  const rj = jsBench(N, 2463534242);
  const tj = performance.now() - t0;
  row('bench 30M xorshift', `wasm ${tw.toFixed(0)} ms, js ${tj.toFixed(0)} ms${rw === rj ? '' : ' (RESULT MISMATCH)'}`, rw === rj ? 'ok' : 'fail');
  report.details.bench = { n: N, wasmMs: tw, jsMs: tj };
}

// ---------- 4. requestAnimationFrame rate ----------
function probeRaf() {
  return new Promise((resolve) => {
    const times = [];
    function f(t) {
      times.push(t);
      if (times.length < 121) requestAnimationFrame(f);
      else {
        const d = []; for (let i = 1; i < times.length; i++) d.push(times[i] - times[i - 1]);
        const avg = d.reduce((a, b) => a + b, 0) / d.length;
        const worst = Math.max(...d);
        row('rAF rate (idle page)', `${(1000 / avg).toFixed(1)} fps avg, worst frame ${worst.toFixed(0)} ms`, avg < 20 ? 'ok' : 'warn');
        resolve();
      }
    }
    requestAnimationFrame(f);
  });
}

// ---------- 5. WebGL 2 (not needed for Doom's software renderer, but good to know) ----------
function probeWebgl() {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    if (!gl) { row('WebGL2', 'not available', 'warn'); return; }
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    row('WebGL2', `${renderer}, max texture ${gl.getParameter(gl.MAX_TEXTURE_SIZE)}`, 'ok');
  } catch (e) { row('WebGL2', 'error ' + e, 'warn'); }
}

// ---------- 6. Web Audio ----------
let actx = null;
function beep() {
  try {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    const before = actx.state;
    if (actx.state === 'suspended') actx.resume();
    const o = actx.createOscillator();
    const g = actx.createGain();
    o.frequency.value = 660;
    g.gain.setValueAtTime(0.25, actx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, actx.currentTime + 0.6);
    o.connect(g).connect(actx.destination);
    o.start();
    o.stop(actx.currentTime + 0.6);
    return before;
  } catch (e) { row('Web Audio', 'FAILED: ' + e, 'fail'); return 'error'; }
}
async function probeAudio() {
  if (!window.AudioContext && !window.webkitAudioContext) { row('Web Audio', 'no AudioContext', 'fail'); return; }
  const before = beep();
  await sleep(400);
  const now = actx ? actx.state : 'n/a';
  // "running" without a tap = autoplay really works. Whether you HEAR it is the button test.
  row('Web Audio', `state when created: ${before}, after 400 ms: ${now}, ${actx ? actx.sampleRate + ' Hz' : ''}`, now === 'running' ? 'ok' : 'warn');
  row('beep heard (you)', 'not answered yet - press Yes/No', 'run');
}

// ---------- 7. Download speed (doom1.wad is 4,196,020 bytes) ----------
async function probeDownload() {
  status('Download test (4 MB) ...');
  try {
    const t0 = performance.now();
    const r = await fetch('/blob?bytes=4196020', { cache: 'no-store' });
    const buf = await r.arrayBuffer();
    const s = (performance.now() - t0) / 1000;
    row('download 4 MB', `${s.toFixed(2)} s, ${(buf.byteLength / 1048576 / s).toFixed(2)} MB/s`, s < 5 ? 'ok' : 'warn');
  } catch (e) { row('download 4 MB', 'FAILED: ' + e, 'fail'); }
}

// ---------- 8. Alexa HTML SDK ----------
let alexaClient = null;
function probeAlexa() {
  if (!IN_ALEXA) { row('Alexa SDK', 'skipped (not opened by the skill)'); return Promise.resolve(); }
  return new Promise((resolve) => {
    const done = (v, cls) => { row('Alexa SDK', v, cls); resolve(); };
    const timer = setTimeout(() => done('timeout loading SDK', 'fail'), 10000);
    const s = document.createElement('script');
    s.src = 'https://cdn.html.games.alexa.a2z.com/alexa-html/latest/alexa-html.js';
    s.onerror = () => { clearTimeout(timer); done('SDK script failed to load', 'fail'); };
    s.onload = () => {
      Alexa.create({ version: '1.1' }).then(async ({ alexa, message }) => {
        clearTimeout(timer);
        alexaClient = alexa;
        alexa.skill.onMessage(() => {});
        report.details.alexaStartMessage = message;
        report.details.alexaCapabilities = alexa.capabilities;
        const mic = (alexa.capabilities && alexa.capabilities.microphone) || {};
        done(`ok, version ${alexa.version}, mic pushToTalk=${mic.supportsPushToTalk} wakeWord=${mic.supportsWakeWord}`, 'ok');
        // Amazon: "Don't use the performance interface in production." Fine for a probe.
        try {
          const mem = await alexa.performance.getMemoryInfo();
          report.details.alexaMemoryInfo = mem;
          row('alexa getMemoryInfo', JSON.stringify(mem), 'ok');
        } catch (e) { row('alexa getMemoryInfo', 'error ' + e, 'warn'); }
        // Keep-alive once a minute (max 2 messages/s allowed).
        setInterval(() => { try { alexa.skill.sendMessage({ type: 'keepalive' }); } catch (e) {} }, 60000);
      }).catch((e) => { clearTimeout(timer); done('Alexa.create failed: ' + JSON.stringify(e), 'fail'); });
    };
    document.head.appendChild(s);
  });
}

// ---------- 9. WASM memory: can we get what Doom needs? (doom-wasm is built with TOTAL_MEMORY=64MB) ----------
// Allocates and touches every page so the OS really commits it. Runs last because it is the one
// test that could make the web view crash; the report is sent before it.
async function probeMemory() {
  const results = [];
  for (const mb of [64, 128, 256]) {
    status(`WASM memory test: ${mb} MB ...`);
    await sleep(100);
    try {
      const mem = new WebAssembly.Memory({ initial: mb * 16 }); // 64 KiB pages
      const u8 = new Uint8Array(mem.buffer);
      for (let i = 0; i < u8.length; i += 4096) u8[i] = 1;
      results.push(`${mb}: ok`);
    } catch (e) { results.push(`${mb}: FAIL (${e.name})`); row('wasm memory', results.join(', '), mb > 64 ? 'warn' : 'fail'); return; }
    row('wasm memory', results.join(', '), 'run');
    await sleep(300); // give GC a chance before the next, bigger allocation
  }
  row('wasm memory', results.join(', '), 'ok');
}

// ---------- 10. Multitouch ----------
const touchEl = document.getElementById('touch');
const touchCount = document.getElementById('touchcount');
let maxTouches = 0;
function drawTouches(e) {
  e.preventDefault();
  touchEl.querySelectorAll('.dot').forEach((d) => d.remove());
  const r = touchEl.getBoundingClientRect();
  for (const t of e.touches) {
    const d = document.createElement('div');
    d.className = 'dot';
    d.style.left = (t.clientX - r.left) + 'px';
    d.style.top = (t.clientY - r.top) + 'px';
    touchEl.appendChild(d);
  }
  if (e.touches.length > maxTouches) {
    maxTouches = e.touches.length;
    touchCount.textContent = 'max ' + maxTouches;
    row('multitouch (you)', `max ${maxTouches} simultaneous touches`, maxTouches >= 2 ? 'ok' : 'warn');
  }
}
['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((t) => touchEl.addEventListener(t, drawTouches, { passive: false }));

// ---------- Buttons ----------
function answerBeep(heard) {
  row('beep heard (you)', heard ? 'YES' : 'NO', heard ? 'ok' : 'fail');
  if (!maxTouches) row('multitouch (you)', 'not tested', 'warn');
  status('Final report sent. You can say "Alexa, stop".');
  sendReport('final');
  if (alexaClient) try { alexaClient.skill.sendMessage({ type: 'probe-final', beep: heard, maxTouches }); } catch (e) {}
}
document.getElementById('heardYes').addEventListener('click', () => answerBeep(true));
document.getElementById('heardNo').addEventListener('click', () => answerBeep(false));
document.getElementById('beep').addEventListener('click', () => beep());

// ---------- Run ----------
async function run() {
  const t0 = performance.now();
  status('Running tests ...');
  probeEnvironment();
  await probeAlexa();
  await probeWasm();
  probeWebgl();
  await probeRaf();
  await probeCpu();
  await probeDownload();
  // Audio after a few seconds, so Alexa's spoken reply is over. Still no tap -> tests autoplay.
  await probeAudio();
  await sendReport('auto');
  await probeMemory();
  row('total probe time', ((performance.now() - t0) / 1000).toFixed(1) + ' s');
  await sendReport('auto+memory');
  status('Done. Now: put 2-3 fingers on the box, then answer the beep question (sends the final report).');
}

// Start only after "load": in the second-screen project, starting earlier sometimes caused
// "There was a problem with the requested skill's response".
if (document.readyState === 'complete') run();
else window.addEventListener('load', () => setTimeout(run, 0));
