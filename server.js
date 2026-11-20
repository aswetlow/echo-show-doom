// echo-show-doom: skill endpoint + static web server in one zero-dependency Node script.
//
//   "Alexa, open Doom"  ->  Alexa cloud  ->  Cloudflare quick tunnel  ->  POST /alexa (this server)
//   -> replies with Alexa.Presentation.HTML.Start  ->  Echo Show opens https://<tunnel>/doom/?alexa=1
//
// Usage (Windows, from this folder):
//   node server.js --tunnel                 start cloudflared, write the URL into skill-package/skill.json,
//                                           run "ask deploy --ignore-hash" automatically
//   node server.js --tunnel --no-deploy     same, but deploy yourself
//   node server.js --public-url https://x   fixed HTTPS URL (named tunnel) instead of a quick tunnel
//   node server.js                          local only: http://localhost:8080/doom/
//
// Options: --port 8080, --page /doom/ (or /probe/), --tunnel-protocol auto|http2|quic, --cloudflared <path>
//
// Endpoints:
//   POST /alexa          Alexa skill endpoint (no request signature check: dev skill on your own account only)
//   POST /report         the probe page posts its results here; saved to reports/<time>.json and printed
//   GET  /blob?bytes=N   N random bytes, uncacheable (download speed test through the tunnel)
//   GET  /*              static files from public/

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const args = process.argv.slice(2);
function opt(name, def) {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
}

const PORT = Number(opt('port', 8080));
const TUNNEL = args.includes('--tunnel');
let PUBLIC_URL = opt('public-url', '').replace(/\/+$/, '');
const PUBLIC_DIR = path.join(__dirname, 'public');
const REPORT_DIR = path.join(__dirname, 'reports');
const SKILL_JSON = path.join(__dirname, 'skill-package', 'skill.json');
// The page the skill opens: Doom by default, --page /probe/ for the feasibility probe.
// Extra query parameters can be added, e.g. --page "/doom/?timedemo=1".
const START_PATH = opt('page', '/doom/');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm', // required for WebAssembly.instantiateStreaming
  '.wat': 'text/plain; charset=utf-8',
  '.wad': 'application/octet-stream',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
};

function log(...a) { console.log(`[${new Date().toLocaleTimeString()}]`, ...a); }

// ---------- Alexa skill ----------
function alexaResponse(response) {
  return { version: '1.0', sessionAttributes: {}, response };
}
// Keyed by language; say() falls back to English. One entry per language of the skill's 17 locales.
const SPEECH = {
  en: { start: 'Starting Doom.', stop: 'Bye.', noScreen: 'This needs an Echo device with a screen.', help: 'This skill runs Doom on your Echo Show. Say stop to end it.', error: 'Something went wrong.' },
  de: { start: 'Doom startet.', stop: 'Tschüss.', noScreen: 'Dafür brauche ich ein Echo Gerät mit Bildschirm.', help: 'Dieser Skill startet Doom auf deinem Echo Show. Sag stopp zum Beenden.', error: 'Da ist etwas schiefgegangen.' },
  fr: { start: 'Doom démarre.', stop: 'Au revoir.', noScreen: 'Il faut un appareil Echo avec écran.', help: 'Cette skill lance Doom sur ton Echo Show. Dis stop pour quitter.', error: 'Une erreur s\'est produite.' },
  es: { start: 'Iniciando Doom.', stop: 'Adiós.', noScreen: 'Para esto necesitas un dispositivo Echo con pantalla.', help: 'Esta skill ejecuta Doom en tu Echo Show. Di para para salir.', error: 'Algo salió mal.' },
  it: { start: 'Avvio Doom.', stop: 'Ciao.', noScreen: 'Serve un dispositivo Echo con schermo.', help: 'Questa skill avvia Doom sul tuo Echo Show. Di stop per uscire.', error: 'Qualcosa è andato storto.' },
  pt: { start: 'Iniciando Doom.', stop: 'Tchau.', noScreen: 'Para isso é preciso um dispositivo Echo com tela.', help: 'Esta skill executa Doom no seu Echo Show. Diga parar para sair.', error: 'Algo deu errado.' },
  nl: { start: 'Doom start.', stop: 'Doei.', noScreen: 'Hiervoor heb je een Echo-apparaat met scherm nodig.', help: 'Deze skill start Doom op je Echo Show. Zeg stop om te stoppen.', error: 'Er ging iets mis.' },
  ja: { start: 'ドゥームを起動します。', stop: 'さようなら。', noScreen: '画面付きのEchoデバイスが必要です。', help: 'このスキルはEcho Showでドゥームを動かします。終了するには、ストップと言ってください。', error: 'エラーが発生しました。' },
  hi: { start: 'Doom शुरू हो रहा है।', stop: 'अलविदा।', noScreen: 'इसके लिए स्क्रीन वाला Echo डिवाइस चाहिए।', help: 'यह skill आपके Echo Show पर Doom चलाती है। बंद करने के लिए stop बोलें।', error: 'कुछ गड़बड़ हो गई।' },
  ar: { start: 'جاري تشغيل دوم.', stop: 'مع السلامة.', noScreen: 'تحتاج إلى جهاز Echo بشاشة.', help: 'هذه المهارة تشغل دوم على جهاز Echo Show. قل توقف للخروج.', error: 'حدث خطأ ما.' },
};
function say(locale, key) {
  const lang = String(locale || '').split('-')[0];
  return { type: 'PlainText', text: (SPEECH[lang] || SPEECH.en)[key] };
}

function startDirective(host) {
  const base = PUBLIC_URL || `https://${host}`;
  return {
    type: 'Alexa.Presentation.HTML.Start',
    data: { startedAt: Date.now() },
    request: { uri: `${base}${START_PATH}${START_PATH.includes('?') ? '&' : '?'}alexa=1`, method: 'GET' },
    // Amazon docs: at most 1800 s (30 min) without user interaction.
    configuration: { timeoutInSeconds: 1800 },
  };
}

function handleAlexa(body, host) {
  const r = body.request || {};
  const intent = r.intent ? r.intent.name : '';
  log(`Alexa: ${r.type}${intent ? ' / ' + intent : ''}${r.reason ? ' (' + r.reason + ')' : ''}${r.error ? ' ' + JSON.stringify(r.error) : ''}`);

  const ifaces = (((body.context || {}).System || {}).device || {}).supportedInterfaces || {};
  if (r.type === 'SessionEndedRequest') return alexaResponse({});

  if (r.type === 'Alexa.Presentation.HTML.Message') {
    const m = r.message || {};
    if (m.type !== 'keepalive') log('  message from page:', JSON.stringify(m).slice(0, 300));
    // No speech, no shouldEndSession -> the web app stays open.
    return alexaResponse({ directives: [{ type: 'Alexa.Presentation.HTML.HandleMessage', message: { type: 'pong', at: Date.now() } }] });
  }

  if (['AMAZON.StopIntent', 'AMAZON.CancelIntent', 'AMAZON.NavigateHomeIntent'].includes(intent)) {
    return alexaResponse({ outputSpeech: say(r.locale, 'stop'), shouldEndSession: true });
  }
  if (!ifaces['Alexa.Presentation.HTML']) {
    log('  device does not report Alexa.Presentation.HTML');
    return alexaResponse({ outputSpeech: say(r.locale, 'noScreen'), shouldEndSession: true });
  }
  // LaunchRequest, StartGameIntent, HelpIntent, FallbackIntent: (re)open the page.
  return alexaResponse({
    outputSpeech: say(r.locale, intent === 'AMAZON.HelpIntent' ? 'help' : 'start'),
    directives: [startDirective(host)],
  });
}

// ---------- Probe reports ----------
function printReport(rep) {
  const line = (k, v) => console.log(`  ${k.padEnd(22)} ${v}`);
  console.log('\n================ PROBE REPORT ================');
  for (const [k, v] of Object.entries(rep.summary || {})) line(k, v);
  console.log('==============================================\n');
}

function handleReport(raw) {
  const rep = JSON.parse(raw);
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const name = new Date().toISOString().replace(/[:.]/g, '-') + '-' + (rep.kind || 'probe') + (rep.alexa ? '-alexa' : '-browser') + '.json';
  fs.writeFileSync(path.join(REPORT_DIR, name), JSON.stringify(rep, null, 2));
  log(`Report saved: reports/${name}`);
  printReport(rep);
}

// ---------- Tunnel + auto deploy (same approach as echo-show-second-screen) ----------
function updateSkillEndpoint(publicUrl) {
  try {
    const j = JSON.parse(fs.readFileSync(SKILL_JSON, 'utf8'));
    j.manifest.apis.custom.endpoint = { uri: `${publicUrl}/alexa`, sslCertificateType: 'Wildcard' };
    fs.writeFileSync(SKILL_JSON, JSON.stringify(j, null, 2) + '\n');
    log(`[skill] endpoint written to skill-package/skill.json: ${publicUrl}/alexa`);
  } catch (e) { console.error('[skill] skill.json not updated:', e.message); }
}

function autoDeploy() {
  log('[skill] running "ask deploy --ignore-hash" so Alexa knows the new URL (about a minute) ...');
  const t0 = Date.now();
  const dep = spawn('ask', ['deploy', '--ignore-hash'], { cwd: __dirname, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  dep.stdout.on('data', (d) => { out += d; });
  dep.stderr.on('data', (d) => { out += d; });
  dep.on('error', (e) => console.error(`[skill] ask CLI not found (${e.message}). Run "ask deploy --ignore-hash" yourself.`));
  dep.on('exit', (code) => {
    const sec = Math.round((Date.now() - t0) / 1000);
    if (code === 0) log(`[skill] Deploy done after ${sec} s. Say "Alexa, öffne Doom" / "Alexa, open Doom" (other languages: README).`);
    else {
      console.error(`\n[skill] Deploy FAILED (code ${code}). Last output:`);
      console.error(out.trim().split(/\r?\n/).slice(-15).join('\n'));
    }
  });
}

function startTunnel() {
  const bin = opt('cloudflared', 'cloudflared');
  log('[tunnel] starting cloudflared quick tunnel ...');
  const cf = spawn(bin, ['tunnel', '--no-autoupdate', '--protocol', opt('tunnel-protocol', 'auto'), '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  const onData = (d) => {
    const s = d.toString();
    for (const l of s.split(/\r?\n/)) if (/Registered tunnel connection|ERR|failed/i.test(l)) console.log('[cloudflared]', l.trim());
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(s);
    if (m && !PUBLIC_URL) {
      PUBLIC_URL = m[0];
      log(`[tunnel] public URL: ${PUBLIC_URL}`);
      updateSkillEndpoint(PUBLIC_URL);
      if (args.includes('--no-deploy')) log('[tunnel] now run in this folder:  ask deploy --ignore-hash');
      else autoDeploy();
      log(`[tunnel] test in any browser:  ${PUBLIC_URL}${START_PATH}`);
    }
  };
  cf.stdout.on('data', onData);
  cf.stderr.on('data', onData);
  cf.on('error', (e) => console.error(`[tunnel] cloudflared not found (${e.message}). Pass its path with --cloudflared.`));
  cf.on('exit', (c) => console.error(`[tunnel] cloudflared exited (code ${c})`));
  process.on('exit', () => cf.kill());
  process.on('SIGINT', () => process.exit(0));
}

// ---------- HTTP ----------
function readBody(req, limit, cb) {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > limit) req.destroy(); });
  req.on('end', () => cb(raw));
}

function sendStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { res.writeHead(400); return res.end(); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(PUBLIC_DIR, path.normalize(rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/alexa' && req.method === 'POST') {
    return readBody(req, 1e6, (raw) => {
      let out;
      try { out = handleAlexa(JSON.parse(raw), req.headers['x-forwarded-host'] || req.headers.host); }
      catch (e) { console.error('[skill] error:', e.message); out = alexaResponse({ outputSpeech: say('en', 'error'), shouldEndSession: true }); }
      res.writeHead(200, { 'Content-Type': 'application/json;charset=UTF-8' });
      res.end(JSON.stringify(out));
    });
  }

  if (p === '/report' && req.method === 'POST') {
    return readBody(req, 2e5, (raw) => {
      try { handleReport(raw); res.writeHead(204); }
      catch (e) { console.error('[report] bad report:', e.message); res.writeHead(400); }
      res.end();
    });
  }

  if (p === '/blob') {
    const n = Math.min(Math.max(Number(url.searchParams.get('bytes')) || 0, 0), 16 * 1024 * 1024);
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': n, 'Cache-Control': 'no-store' });
    // Random data so nothing on the way can compress it.
    let left = n;
    const chunk = () => {
      while (left > 0) {
        const b = crypto.randomBytes(Math.min(left, 65536));
        left -= b.length;
        if (!res.write(b)) return res.once('drain', chunk);
      }
      res.end();
    };
    return chunk();
  }

  if (p === '/') { res.writeHead(302, { Location: START_PATH }); return res.end(); }
  if (req.method === 'GET' || req.method === 'HEAD') return sendStatic(req, res, p);
  res.writeHead(405); res.end();
});

server.listen(PORT, () => {
  log(`Server on http://localhost:${PORT}${START_PATH}`);
  if (PUBLIC_URL) { updateSkillEndpoint(PUBLIC_URL); log(`[skill] public URL: ${PUBLIC_URL}${START_PATH}`); }
  else if (TUNNEL) startTunnel();
  else log('No tunnel. Add --tunnel to reach the server from the Echo.');
});
