#!/usr/bin/env bash
# Rebuilds public/doom/doom.wasm: jacobenget/doom.wasm + port/sound.patch, without Docker.
# Runs on Linux (or WSL). Needs: git, make, cmake, python3, and an LLVM with WebAssembly support
# (this used the clang 20 + binaryen that ship with emsdk 3.1.74: ./emsdk install 3.1.74).
#
#   LLVM_BIN=/path/to/emsdk/upstream/bin  DOOM1_WAD=/path/to/doom1.wad  ./port/build.sh
#
# doom1.wad must be the shareware v1.9 file (MD5 f0cefca49926d00903cf57551d901abe).
set -euo pipefail
: "${LLVM_BIN:?set LLVM_BIN to a directory with clang, llvm-ar, llvm-nm, wasm-as, wasm-merge, wasm-metadce}"
: "${DOOM1_WAD:?set DOOM1_WAD to the shareware doom1.wad}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
WORK="${WORK:-$HERE/.build}"
mkdir -p "$WORK"; cd "$WORK"

# 1. wasi-libc as sysroot (same version as wasi-sdk 24, which the upstream Docker build uses).
#    Its final "check-symbols" step may fail with a newer clang; the libraries are built before that.
if [ ! -f sysroot/lib/wasm32-wasi/libc.a ]; then
  git clone --depth 1 -b wasi-sdk-24 https://github.com/WebAssembly/wasi-libc.git wasi-libc
  make -C wasi-libc -j"$(nproc)" CC="$LLVM_BIN/clang" AR="$LLVM_BIN/llvm-ar" NM="$LLVM_BIN/llvm-nm" SYSROOT="$WORK/sysroot" || true
fi
# clang wants compiler-rt builtins for wasm32 in its resource dir. emsdk's libcompiler_rt.a works.
RD="$("$LLVM_BIN/clang" -print-resource-dir)"
if [ ! -f "$RD/lib/wasi/libclang_rt.builtins-wasm32.a" ]; then
  mkdir -p "$RD/lib/wasi"
  cp "$LLVM_BIN/../emscripten/cache/sysroot/lib/wasm32-emscripten/libcompiler_rt.a" "$RD/lib/wasi/libclang_rt.builtins-wasm32.a"
fi

# 2. Upstream source at the commit we use, plus our sound patch.
rm -rf doom.wasm-src
git clone -b gh-pages https://github.com/jacobenget/doom.wasm.git doom.wasm-src
git -C doom.wasm-src checkout 25ea598859a7dba4e2f86ea0354d583e1b3f5ecd
git -C doom.wasm-src apply "$HERE/port/sound.patch"

# 3. Build. A bare Python venv is enough for the WAD-embedding script; the CC path must contain "wasi".
cd doom.wasm-src
mkdir -p build .dev_virtualenvs && python3 -m venv .dev_virtualenvs/python_virtualenv
cp "$DOOM1_WAD" build/DOOM1.WAD
make -j"$(nproc)" build/doom.wasm CC="$LLVM_BIN/clang --sysroot=$WORK/sysroot" \
  WASM_AS="$LLVM_BIN/wasm-as" WASM_MERGE="$LLVM_BIN/wasm-merge" WASM_METADCE="$LLVM_BIN/wasm-metadce"
cp build/doom.wasm "$HERE/public/doom/doom.wasm"
node "$HERE/port/verify-wad.mjs" "$HERE/public/doom/doom.wasm" "$DOOM1_WAD"
echo "done: public/doom/doom.wasm"
