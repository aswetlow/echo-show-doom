# echo-show-doom

Doom (shareware episode) running natively on an Amazon Echo Show's own CPU as WebAssembly, inside a custom Alexa
skill built with the **Alexa Web API for Games**. No streaming: the Echo's built-in web view runs the game, the
rendering and the sound. A server on your PC only delivers the files (about 4.5 MB, once) and answers the skill.
No jailbreak, only official means. A fun and blog project, development mode only, not for the skill store.



https://github.com/user-attachments/assets/fcc2509b-d700-4daf-89b7-6517f32fec38



```
"Alexa, open Doom"
   │
Alexa cloud ──HTTPS──► Cloudflare quick tunnel ──► server.js  POST /alexa
   │                                                   │  replies with Alexa.Presentation.HTML.Start
   ▼                                                   ▼
Echo Show opens https://…trycloudflare.com/doom/?alexa=1  (Chromium web view)
   └── runs doom.wasm, posts FPS/CPU stats to POST /report ──► console + reports/*.json
```

No Lambda, no npm dependencies: `server.js` is the skill endpoint and the web server at the same time,
modeled on [echo-show-second-screen](https://github.com/aswetlow/echo-show-second-screen).

## Setup (Windows)

- Node 18 or newer. That's all you need for the desktop.
- For the Echo: `cloudflared` in PATH (`winget install Cloudflare.cloudflared`) and the ASK CLI
  (`npm install -g ask-cli`, then `ask configure` once, answer **No** to linking an AWS account).
  Use the Amazon account your Echo Show is registered to.

## Play

**Desktop:** `.\start.cmd`, then open http://localhost:8080/doom/ .
Arrows move/turn, Ctrl fire, Space use, `,` `.` strafe, Shift run, 1–7 weapons, Esc menu, Enter confirm.

**Echo:** `.\start.cmd --tunnel --tunnel-protocol http2`. The server starts a tunnel, writes its URL into
`skill-package\skill.json` and deploys the skill (about a minute, on every start). Wait for `[skill] Deploy done`,
then say "Alexa, open Doom" in your Echo's language:

| | |
|---|---|
| English, Dutch | "Alexa, open Doom" |
| German | "Alexa, öffne Doom" |
| French | "Alexa, ouvre Doom" |
| Spanish | "Alexa, abre Doom" |
| Italian | "Alexa, apri Doom" |
| Portuguese (BR) | "Alexa, abra Doom" |
| Japanese | 「アレクサ、ドゥームを開いて」 |
| Hindi | "Alexa, doom खोलो" |
| Arabic | «أليكسا، افتحي دوم» |

The skill covers all 17 Alexa locales, but only German has been tried on a real device; the other non-English
texts are machine translations.

**Touch controls:**

| Where | Control |
|---|---|
| Left half | Floating joystick: move and turn, push to the edge to run |
| Right, big | FIRE (hold) |
| Right, bottom | USE: doors, switches |
| Right, upper | WPN: next weapon |
| Top left / right | MENU / OK |

Each finger stays on the control it started on, so you can walk and fire at the same time.
The overlay shows fps and CPU time per frame (`?hud=0` hides it), and every 30 s a report appears in the
server console.

## How it performs

On the author's Echo Show (Intel Atom x5/x7, Chrome 108 web view, 1280×800): about 33.5 fps of Doom's 35,
with a median 25.6 ms of CPU per game tick out of a 28.6 ms budget. Loads in about 4 s. WebAssembly, Web Audio
without a tap and multitouch all work. `--page /probe/` runs the feasibility check that measured this.

## The engine

`public/doom/doom.wasm` is [jacobenget/doom.wasm](https://github.com/jacobenget/doom.wasm) (based on
[doomgeneric](https://github.com/ozkl/doomgeneric)) plus our sound patch. It needs no Emscripten or SDL,
just 10 imports and 16 MB of memory. The patch forwards sound effects to `sound.js`, which plays them with
Web Audio. No music. Build script and provenance: [port/](port/SOURCE.md).

[cloudflare/doom-wasm](https://github.com/cloudflare/doom-wasm) was tried first and dropped: its single player
showed the deathmatch status bar and "player 4 left the game" messages.

## Notes

- The endpoint doesn't verify Alexa request signatures, and "doom" as an invocation name would fail certification.
  Both are fine for a development-stage skill on your own account.
- The server rewrites `skill-package/skill.json` on every start. To keep git quiet:
  `git update-index --skip-worktree skill-package/skill.json`.

## License

GPL-2.0 (see [LICENSE](LICENSE)), because some doomgeneric files have no "or later" clause. Our own code is
GPL-2.0-or-later. The shareware `doom1.wad` (v1.9, MD5 `f0cefca49926d00903cf57551d901abe`) is embedded unmodified
in `doom.wasm` under id Software's shareware terms, see [doom1.wad-LICENSE.txt](public/doom/doom1.wad-LICENSE.txt).
