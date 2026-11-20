# echo-show-doom

Doom (shareware episode) running natively on an Amazon Echo Show's own CPU as WebAssembly, inside a custom Alexa
skill built with the **Alexa Web API for Games**. No streaming: game logic, rendering and sound are computed by the
Echo's built-in web view. A server on your PC only delivers the files (about 4.5 MB, once) and answers the skill
requests. Started with "Alexa, open Doom" / "Alexa, öffne Doom" (the skill has all 17 Alexa locales, see [Languages](#languages)).
No jailbreak, only official means. A fun and blog project, development mode only, not for the skill store.

**Status: step 4 of 5.** Doom runs on the Echo Show via the skill, with multitouch controls and an FPS/CPU
overlay that reports to the server console, and sound effects. Keyboard works on the desktop. No music.
The feasibility probe from step 1 is still available (`--page /probe/`), see [Probe results](#probe-results-step-1).

```
"Alexa, open Doom"
   │
Alexa cloud ──HTTPS──► Cloudflare quick tunnel ──► server.js  POST /alexa
   │                                                   │  replies with Alexa.Presentation.HTML.Start
   ▼                                                   ▼
Echo Show opens https://…trycloudflare.com/doom/?alexa=1  (Chromium web view)
   └── runs doom.wasm, posts FPS/CPU stats to POST /report ──► console + reports/*.json
```

No Lambda, no npm dependencies: `server.js` is the skill endpoint and the web server at the same time.
The approach is taken from [echo-show-second-screen](https://github.com/aswetlow/echo-show-second-screen) (`web-api-for-games`).

## Requirements (Windows)

- Node 18 or newer (tested with Node 22; developed for Node 24).
- For the Echo only: the next two items. For playing on the desktop, Node is enough.
- `cloudflared` in PATH: `winget install Cloudflare.cloudflared`.
- ASK CLI v2: `npm install -g ask-cli`, then `ask configure` once (browser login, answer **No** to linking an AWS account).
  The developer account must be the same Amazon account the Echo Show is registered to.

## Play Doom

**Desktop only (no Alexa, no tunnel):**
```
.\start.cmd
```
Open http://localhost:8080/doom/ . Keys: arrows move/turn, Ctrl fire, Space use/open, `,` `.` strafe, Shift run,
1–7 weapons, Esc menu, Enter confirm.

**On the Echo:**
```
.\start.cmd --tunnel --tunnel-protocol http2
```
The server starts a quick tunnel, writes the URL into `skill-package\skill.json` and runs `ask deploy --ignore-hash`.
The first deploy creates the skill "Doom" in your developer account and enables it for testing (development stage).
Wait for `[skill] Deploy done`, then "Alexa, öffne Doom" / "Alexa, open Doom". Every 30 s a `PROBE REPORT`
with fps, frame gaps and `tickGame` CPU time appears in the console (also saved in `reports\`).

### Languages

The skill is set up for all 17 locales Amazon lists for custom skills: ar-SA, de-DE, en-AU, en-CA, en-GB, en-IN,
en-US, es-ES, es-MX, es-US, fr-CA, fr-FR, hi-IN, it-IT, ja-JP, nl-NL, pt-BR. Use the language your Echo is set to:

| Language | Say |
|---|---|
| English | "Alexa, open Doom" |
| German | "Alexa, öffne Doom" |
| French | "Alexa, ouvre Doom" |
| Spanish | "Alexa, abre Doom" |
| Italian | "Alexa, apri Doom" |
| Portuguese (BR) | "Alexa, abra Doom" |
| Dutch | "Alexa, open Doom" |
| Japanese | 「アレクサ、ドゥームを開いて」 (invocation name ドゥーム) |
| Hindi | "Alexa, doom खोलो" |
| Arabic | «أليكسا، افتحي دوم» (invocation name دوم) |

Only de-DE has been tried on a real Echo Show. Amazon's Web API for Games docs don't say whether the web view is
available in every marketplace; if your device doesn't report `Alexa.Presentation.HTML`, the skill says so and exits.
The non-English and non-German texts are machine translations.

### Touch controls

| Where | Control | Doom key |
|---|---|---|
| Left half, anywhere | Floating joystick: up/down = forward/back, left/right = turn, pushed to the edge = run | arrows, Shift |
| Right, big | FIRE (hold) | Ctrl |
| Right, bottom | USE: doors, switches (hold) | Space |
| Right, upper | WPN: next weapon, cycling 1→5. Doom ignores weapons you don't have, so it can take an extra tap | 1–5 |
| Top left / top right | MENU / OK | Esc / Enter |

In Doom's menus the joystick moves the cursor and OK selects. Every finger stays bound to the control it started
on, so you can walk and fire at the same time, and sliding off FIRE keeps firing. The controls show up
automatically on touch screens; `?touch=1` forces them on a desktop, `?touch=0` hides them.

The overlay (top left) shows fps, CPU time per `tickGame` call (game logic + rendering + copy to canvas) and the
load time. Hide it with `?hud=0`.

## Run the feasibility probe (step 1)

Add `--page /probe/` to the start command, e.g. `.\start.cmd --tunnel --tunnel-protocol http2 --page /probe/`.

On the Echo:
1. Wait until the status line says "Done" (about 10 s, longer on a slow device).
2. Put 2–3 fingers on the dashed box at the same time.
3. Answer "Did you hear a short beep?" with Yes/No. This sends the final report.
4. "Alexa, stop".

Every report is printed in the console and saved to `reports\<time>-alexa.json`.
For a desktop baseline open the `test in any browser` URL from the console on your PC (saved as `-browser.json`).

## What the probe checks

| Check | Why it matters for Doom |
|---|---|
| `typeof WebAssembly`, instantiate + run a tiny module, linear memory | The engine is WASM. Amazon's docs neither mention nor forbid WebAssembly. |
| `instantiateStreaming` with `application/wasm` | Emscripten's default loader. |
| WASM SIMD | Nice to have, not required. |
| Allocate and touch 64 / 128 / 256 MB of WASM memory | Cloudflare's doom-wasm is built with a fixed `TOTAL_MEMORY=64MB`. |
| CPU benchmark (same loop in WASM and JS) | Compare Echo vs. desktop. Amazon only says CPU is "constrained on lower end Alexa devices". |
| `requestAnimationFrame` rate | Doom runs at 35 tics/s; we need at least that. |
| Web Audio: does `AudioContext` run without a tap, did you hear the beep | Amazon says autoplay is allowed; this verifies it. |
| Download 4,196,020 random bytes (size of `doom1.wad`) | Load time through the tunnel. |
| Multitouch: max simultaneous touches | Move and fire at the same time. |
| Alexa HTML SDK: `Alexa.create`, capabilities, `performance.getMemoryInfo()` | Keep-alive messages, memory info (Amazon: debugging only). |
| User agent, cores, screen, `deviceMemory`, WebGL 2 renderer | Background for the blog post. |

## Notes

- The skill endpoint does not verify Alexa request signatures. Fine for a dev skill on your own account; mandatory for publishing.
- Single-word invocation names ("doom") violate Amazon's publishing rules unless you own the brand. For a development-stage
  skill the console does not block them (community reports; Amazon's docs only state the rule applies to publishing).
- The quick tunnel URL changes on every start, so every start redeploys the skill (about a minute). `--no-deploy` turns that off.
- The server writes that URL into `skill-package/skill.json`, so git shows it as modified. Don't commit it, or hide it locally:
  `git update-index --skip-worktree skill-package/skill.json`.

## The Doom engine: which WASM port and why

`public/doom/doom.wasm` is built from [jacobenget/doom.wasm](https://github.com/jacobenget/doom.wasm)
(GPL-2.0, based on [doomgeneric](https://github.com/ozkl/doomgeneric)) plus our sound patch.
Provenance, checksums, the patch and the build script (no Docker): [port/](port/SOURCE.md).

Why this one: upstream imports 10 functions and exports 4 (`initGame`, `tickGame`, `reportKeyDown`, `reportKeyUp`).
No Emscripten runtime, no SDL, no Asyncify, 16 MB of memory. Touch controls are just `reportKeyDown/Up` calls.

**Sound:** upstream has no audio. [`port/sound.patch`](port/sound.patch) adds a small Doom sound module that
forwards every sound effect (channel, volume, stereo separation, raw lump) to four imports. `public/doom/sound.js`
decodes Doom's 8-bit DMX lumps once and plays them with Web Audio (gain + stereo panner per channel).
Music is not implemented (it would need a MUS/MIDI synthesizer).

Tried first and dropped: [cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) (Chocolate Doom + Emscripten
+ SDL2, has sound). Built it without `SAFE_HEAP`, it ran at 35 fps, but single player was broken: the status bar
showed the deathmatch FRAG panel and wrong max ammo, plus "player 4 left the game" messages. The same happened with
`-O0`, so it is the port's multiplayer-oriented logic, not the compiler. It also needs 64 MB and Asyncify.

## License

GPL-2.0 (see [LICENSE](LICENSE)), because the Doom engine is GPL-2.0: some doomgeneric/doom.wasm source files
carry no "or any later version" clause, so the bundled `doom.wasm` can't be relicensed under GPL-3.0.
Our own code (server, pages, `port/sound.patch`) is GPL-2.0-or-later.
The shareware `doom1.wad` (v1.9, MD5 `f0cefca49926d00903cf57551d901abe`) is embedded unmodified in `doom.wasm`.
It is not GPL; it is distributed under id Software's shareware terms, see
[public/doom/doom1.wad-LICENSE.txt](public/doom/doom1.wad-LICENSE.txt).

## Probe results (step 1)

On the author's Echo Show (UA `Android 5.1.1; AEOBP … Chrome/108`, Intel Atom x5/x7, 4 cores, 1280×800):
WebAssembly works (incl. `instantiateStreaming` and SIMD), 64/128/256 MB of WASM memory can be allocated,
`alexa.performance.getMemoryInfo()` reports 585 MB available, Web Audio plays without a tap, 3 simultaneous
touches were detected (`maxTouchPoints` 5), 4 MB downloads through the tunnel in 1.3 s.
A plain integer loop ran about 5–6× slower than on a desktop CPU.
