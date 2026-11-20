# Where `public/doom/doom.wasm` comes from

Built by us from [jacobenget/doom.wasm](https://github.com/jacobenget/doom.wasm) (GPL-2.0, based on
[doomgeneric](https://github.com/ozkl/doomgeneric) / id Software's Linux Doom source) plus one patch:

| | |
|---|---|
| Upstream | branch `gh-pages`, commit `25ea598859a7dba4e2f86ea0354d583e1b3f5ecd` (2024-12-03) |
| Our patch | [`sound.patch`](sound.patch): adds `i_wasmsound.c`, a Doom sound module that forwards sound effects to four imports (`sound.startSfx/stopSfx/updateSfx/isPlaying`) |
| Build | [`build.sh`](build.sh), no Docker: emsdk 3.1.74's clang 20 + binaryen, wasi-libc `wasi-sdk-24` as sysroot |
| SHA-256 | `d25299fea5b2afb5df35620282642cad9f854b570f261711bb154d62babcbefa` |
| Size | 4,499,680 bytes |

The corresponding source is upstream at that commit plus `sound.patch` (upstream: GPL-2.0; our patch: GPL-2.0-or-later).

## The embedded WAD

The module embeds the Doom shareware IWAD (the upstream build does this). We built it from `doom1.wad` v1.9,
MD5 `f0cefca49926d00903cf57551d901abe`, SHA-1 `5b2e249b9c5133ec987b3ea77596381dc0d6bc1d`
(matches the [Doom Wiki](https://doomwiki.org/wiki/DOOM1.WAD)), unmodified.
The linker splits the data into several segments, so the WAD is not one contiguous block in the file.
[`verify-wad.mjs`](verify-wad.mjs) instantiates the module and checks the WAD in its memory:

```
node port/verify-wad.mjs public/doom/doom.wasm path/to/doom1.wad
found in memory at 97600 f0cefca49926d00903cf57551d901abe
```

Shareware license: `public/doom/doom1.wad-LICENSE.txt`.
