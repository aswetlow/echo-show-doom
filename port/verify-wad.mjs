// Checks that the shareware WAD inside doom.wasm is unmodified: instantiates the module with stub imports
// and compares its memory against doom1.wad v1.9 (MD5 f0cefca49926d00903cf57551d901abe).
// Usage: node port/verify-wad.mjs public/doom/doom.wasm path/to/doom1.wad
import fs from 'fs'; import crypto from 'crypto';
const bytes = fs.readFileSync(process.argv[2]); const ref = fs.readFileSync(process.argv[3]);
const noop = () => 0;
const imports = { loading: { onGameInit: noop, wadSizes: noop, readWads: noop }, ui: { drawFrame: noop }, runtimeControl: { timeInMilliseconds: () => 0n },
  console: { onInfoMessage: noop, onErrorMessage: noop }, gameSaving: { sizeOfSaveGame: noop, readSaveGame: noop, writeSaveGame: noop },
  sound: { startSfx: noop, stopSfx: noop, updateSfx: noop, isPlaying: noop } };
const { instance } = await WebAssembly.instantiate(bytes, imports);
const mem = Buffer.from(instance.exports.memory.buffer);
const i = mem.indexOf(ref.subarray(0, 4096));
console.log('found in memory at', i, i >= 0 ? crypto.createHash('md5').update(mem.subarray(i, i + ref.length)).digest('hex') : '');
