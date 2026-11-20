// Sound effects for doom.wasm (our build, see port/): the module calls the four "sound" imports below,
// we decode Doom's raw DMX lumps once and play them with Web Audio. No music (Doom's music is MIDI-like MUS).
//
// DMX sound lump: u16 format (3), u16 sample rate, u32 sample count, then 8-bit unsigned PCM.
// The sample count includes 16 padding bytes at the start and at the end, which we skip like Chocolate Doom.
'use strict';

window.DoomSound = (function () {
  var AC = window.AudioContext || window.webkitAudioContext;
  var ctx = null;
  var master = null;
  var buffers = {};   // lumpnum -> AudioBuffer (or null if undecodable)
  var channels = {};  // Doom channel -> { src, gain, pan, playing }
  var getMemory = null;
  var started = 0;    // effects started (for the report)

  function ensureContext() {
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);
    }
    // Autoplay works in the Alexa web view; desktop browsers need a user gesture first (see unlock()).
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function decode(lumpnum, ptr, length) {
    if (buffers[lumpnum] !== undefined) return buffers[lumpnum];
    var buf = null;
    var bytes = new Uint8Array(getMemory().buffer, ptr, length);
    var dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (length > 8 && dv.getUint16(0, true) === 3) {
      var rate = dv.getUint16(2, true);
      var count = dv.getUint32(4, true);
      if (count > length - 8) count = length - 8;
      var start = 8, n = count;
      if (n > 32) { start += 16; n -= 32; } // skip DMX padding
      if (n > 0 && rate >= 3000) {
        buf = ctx.createBuffer(1, n, rate);
        var out = buf.getChannelData(0);
        for (var i = 0; i < n; i++) out[i] = (bytes[start + i] - 128) / 128;
      }
    }
    buffers[lumpnum] = buf;
    return buf;
  }

  // Doom: vol 0..127, sep 0..254 where 0 = full left, 254 = full right (as in Chocolate Doom's i_sdlsound.c).
  function applyParams(ch, vol, sep) {
    ch.gain.gain.value = Math.max(0, Math.min(127, vol)) / 127;
    if (ch.pan) ch.pan.pan.value = Math.max(-1, Math.min(1, (sep - 127) / 127));
  }

  function stop(channel) {
    var ch = channels[channel];
    if (!ch) return;
    ch.playing = false;
    try { ch.src.stop(); } catch (e) {}
    ch.src.disconnect();
    delete channels[channel];
  }

  var imports = {
    startSfx: function (channel, lumpnum, ptr, length, vol, sep) {
      if (!ensureContext()) return;
      var buf = decode(lumpnum, ptr, length);
      stop(channel);
      if (!buf) return;
      var src = ctx.createBufferSource();
      src.buffer = buf;
      var gain = ctx.createGain();
      var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      src.connect(gain);
      if (pan) { gain.connect(pan); pan.connect(master); } else gain.connect(master);
      var ch = { src: src, gain: gain, pan: pan, playing: true };
      applyParams(ch, vol, sep);
      src.onended = function () { if (channels[channel] === ch) { ch.playing = false; delete channels[channel]; } };
      channels[channel] = ch;
      src.start();
      started++;
    },
    stopSfx: function (channel) { stop(channel); },
    updateSfx: function (channel, vol, sep) { var ch = channels[channel]; if (ch) applyParams(ch, vol, sep); },
    isPlaying: function (channel) { var ch = channels[channel]; return ch && ch.playing ? 1 : 0; },
  };

  // Desktop browsers start the AudioContext suspended until the first gesture.
  function unlock() { ensureContext(); }
  ['keydown', 'touchstart', 'pointerdown'].forEach(function (t) { window.addEventListener(t, unlock, { capture: true, passive: true }); });

  return {
    imports: imports,
    init: function (memoryGetter) { getMemory = memoryGetter; ensureContext(); },
    state: function () { return (ctx ? ctx.state : 'none') + ', ' + started + ' effects played'; },
  };
})();
