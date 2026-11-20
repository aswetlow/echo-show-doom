// Touch controls for doom.wasm on the Echo Show (1280x800). Multitouch: move and fire at the same time.
//
//   left half    floating joystick: appears where the finger lands.
//                up/down = forward/back, left/right = turn, pushed to the edge = run
//   right side   FIRE (big), USE (open doors, switches), WPN (next weapon)
//   top corners  MENU (Esc) and OK (Enter) for Doom's menus; in menus the joystick moves the cursor
//
// Each finger is bound to the control it started on until it lifts, so sliding off FIRE keeps firing.
// Doom only sees keys: everything ends up as reportKeyDown / reportKeyUp.
'use strict';

window.initTouchControls = function (doom) {
  var params = new URLSearchParams(location.search);
  var hasTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  if (params.get('touch') === '0' || (!hasTouch && params.get('touch') !== '1')) return;

  var K = function (name) { return doom[name].value; };
  var KEY = {
    up: K('KEY_UPARROW'), down: K('KEY_DOWNARROW'), left: K('KEY_LEFTARROW'), right: K('KEY_RIGHTARROW'),
    fire: K('KEY_FIRE'), use: K('KEY_USE'), run: K('KEY_SHIFT'), esc: K('KEY_ESCAPE'), enter: K('KEY_ENTER'),
  };

  // Reference counting, so two controls holding the same key don't release it for each other.
  var held = {};
  function press(k) { held[k] = (held[k] || 0) + 1; if (held[k] === 1) doom.reportKeyDown(k); }
  function release(k) { if (!held[k]) return; held[k]--; if (held[k] === 0) doom.reportKeyUp(k); }
  // Doom reads some keys (weapon numbers) once per tic (28.6 ms), so a tap must be held a bit longer.
  function tap(k) { press(k); setTimeout(function () { release(k); }, 120); }

  // ---------- DOM ----------
  var css = document.createElement('style');
  css.textContent = [
    '#touch { position: fixed; inset: 0; z-index: 3; touch-action: none; }',
    '#touch .btn { position: absolute; border-radius: 50%; border: 3px solid rgba(255,255,255,.35); background: rgba(255,255,255,.08);',
    '  color: rgba(255,255,255,.75); font: bold 20px system-ui, sans-serif; display: flex; align-items: center; justify-content: center; pointer-events: none; }',
    '#touch .btn.on { background: rgba(255,80,60,.45); border-color: rgba(255,120,100,.8); color: #fff; }',
    '#touch .small { border-radius: 14px; font-size: 18px; }',
    '#touch .stick { position: absolute; width: 180px; height: 180px; margin: -90px 0 0 -90px; border-radius: 50%;',
    '  border: 3px solid rgba(255,255,255,.3); background: rgba(255,255,255,.06); display: none; pointer-events: none; }',
    '#touch .knob { position: absolute; width: 80px; height: 80px; margin: -40px 0 0 -40px; border-radius: 50%;',
    '  background: rgba(255,255,255,.35); display: none; pointer-events: none; }',
    '#touch .hint { position: absolute; left: 24px; bottom: 24px; color: rgba(255,255,255,.35); font: 16px system-ui, sans-serif; pointer-events: none; }',
  ].join('\n');
  document.head.appendChild(css);

  var root = document.createElement('div');
  root.id = 'touch';
  document.body.appendChild(root);

  function el(cls, text) { var d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; root.appendChild(d); return d; }
  var stickBase = el('stick'), stickKnob = el('knob');
  var hint = el('hint', 'move / turn: touch & drag here');

  // Buttons: centre (cx, cy) relative to the right/top edges, so it adapts to the screen size.
  // shape 'circle' uses r; 'rect' uses w/h.
  var buttons = [
    { id: 'fire', label: 'FIRE', shape: 'circle', r: 85, right: 140, bottom: 190, key: KEY.fire, hold: true },
    { id: 'use', label: 'USE', shape: 'circle', r: 58, right: 330, bottom: 110, key: KEY.use, hold: true },
    { id: 'wpn', label: 'WPN', shape: 'circle', r: 50, right: 110, bottom: 390, action: nextWeapon },
    { id: 'menu', label: 'MENU', shape: 'rect', w: 110, h: 56, left: 70, top: 130, action: function () { tap(KEY.esc); } },
    { id: 'ok', label: 'OK', shape: 'rect', w: 110, h: 56, right: 70, top: 130, action: function () { tap(KEY.enter); } },
  ];
  buttons.forEach(function (b) { b.el = el('btn' + (b.shape === 'rect' ? ' small' : ''), b.label); });

  function layout() {
    var W = window.innerWidth, H = window.innerHeight;
    buttons.forEach(function (b) {
      b.cx = b.left !== undefined ? b.left : W - b.right;
      b.cy = b.top !== undefined ? b.top : H - b.bottom;
      var w = b.shape === 'circle' ? 2 * b.r : b.w, h = b.shape === 'circle' ? 2 * b.r : b.h;
      b.el.style.width = w + 'px'; b.el.style.height = h + 'px';
      b.el.style.left = (b.cx - w / 2) + 'px'; b.el.style.top = (b.cy - h / 2) + 'px';
    });
  }
  layout();
  window.addEventListener('resize', layout);

  function hitButton(x, y) {
    for (var i = 0; i < buttons.length; i++) {
      var b = buttons[i], pad = 18; // a little forgiveness around each button
      if (b.shape === 'circle') {
        var dx = x - b.cx, dy = y - b.cy, r = b.r + pad;
        if (dx * dx + dy * dy <= r * r) return b;
      } else if (Math.abs(x - b.cx) <= b.w / 2 + pad && Math.abs(y - b.cy) <= b.h / 2 + pad) return b;
    }
    return null;
  }

  // ---------- Weapons (shareware has 1..5: fist/chainsaw, pistol, shotgun, chaingun, rocket launcher) ----------
  var weapon = 2; // you start with the pistol
  function nextWeapon() {
    // Doom ignores weapons you don't own, so this may need an extra tap. Untracked on purpose:
    // the module doesn't tell us what the player owns.
    weapon = weapon % 5 + 1;
    tap(48 + weapon); // '1'..'5'
  }

  // ---------- Joystick ----------
  var R = 90;            // radius in px for full deflection
  var DEAD = 0.3;        // dead zone per axis
  var RUN = 0.85;        // deflection above which we hold the run key
  var stick = null;      // { id, ox, oy, keys: {} }

  function setStickKeys(nx, ny) {
    var want = {};
    if (ny < -DEAD) want[KEY.up] = 1;
    if (ny > DEAD) want[KEY.down] = 1;
    if (nx < -DEAD) want[KEY.left] = 1;
    if (nx > DEAD) want[KEY.right] = 1;
    if (Math.sqrt(nx * nx + ny * ny) > RUN) want[KEY.run] = 1;
    Object.keys(stick.keys).forEach(function (k) { if (!want[k]) { release(+k); delete stick.keys[k]; } });
    Object.keys(want).forEach(function (k) { if (!stick.keys[k]) { press(+k); stick.keys[k] = 1; } });
  }
  function moveStick(x, y) {
    var dx = x - stick.ox, dy = y - stick.oy, d = Math.sqrt(dx * dx + dy * dy);
    if (d > R) { dx = dx * R / d; dy = dy * R / d; }
    stickKnob.style.left = (stick.ox + dx) + 'px'; stickKnob.style.top = (stick.oy + dy) + 'px';
    setStickKeys(dx / R, dy / R);
  }
  function endStick() {
    Object.keys(stick.keys).forEach(function (k) { release(+k); });
    stick = null;
    stickBase.style.display = stickKnob.style.display = 'none';
  }

  // ---------- Touch routing ----------
  var owner = {}; // touch identifier -> 'stick' | button

  root.addEventListener('touchstart', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], x = t.clientX, y = t.clientY;
      var b = hitButton(x, y);
      if (b) {
        owner[t.identifier] = b;
        b.el.classList.add('on');
        if (b.hold) press(b.key); else b.action();
      } else if (x < window.innerWidth * 0.5 && !stick) {
        owner[t.identifier] = 'stick';
        stick = { id: t.identifier, ox: x, oy: y, keys: {} };
        stickBase.style.left = stickKnob.style.left = x + 'px';
        stickBase.style.top = stickKnob.style.top = y + 'px';
        stickBase.style.display = stickKnob.style.display = 'block';
        hint.style.display = 'none';
      }
    }
  }, { passive: false });

  root.addEventListener('touchmove', function (e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i];
      if (owner[t.identifier] === 'stick' && stick) moveStick(t.clientX, t.clientY);
    }
  }, { passive: false });

  function onEnd(e) {
    e.preventDefault();
    for (var i = 0; i < e.changedTouches.length; i++) {
      var t = e.changedTouches[i], o = owner[t.identifier];
      if (!o) continue;
      delete owner[t.identifier];
      if (o === 'stick') { if (stick) endStick(); }
      else { o.el.classList.remove('on'); if (o.hold) release(o.key); }
    }
  }
  root.addEventListener('touchend', onEnd, { passive: false });
  root.addEventListener('touchcancel', onEnd, { passive: false });

  // Safety net: if the page loses visibility, release everything so no key stays stuck.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    Object.keys(held).forEach(function (k) { while (held[k]) release(+k); });
    owner = {}; if (stick) { stick.keys = {}; endStick(); }
    buttons.forEach(function (b) { b.el.classList.remove('on'); });
  });
};
