#!/bin/sh
# Source this before building the huddle_vault program:   . scripts/solana-env.sh
# or run one command inside it:                           sh scripts/solana-env.sh anchor build
#
# 1. Puts the Solana CLI, Anchor (avm) and cargo on PATH.
# 2. macOS older than 13.3 only: the LLVM tools in Solana platform-tools (rust-lld, llvm-objcopy, ...)
#    import one libc++ symbol the OS does not have, so every SBF build aborts with
#      "Symbol not found: __ZNSt3__122__libcpp_verbose_abortEPKcz".
#    We build a tiny libc++ proxy (scripts/solana-lld-shim.c) next to the downloaded tools and repoint
#    those tools at it (install_name_tool + ad-hoc codesign). This edits the downloaded tool cache
#    under ~/.cache/solana/<version>/platform-tools only; undo with
#      cargo-build-sbf --install-only --force-tools-install --tools-version <version>
#    On macOS 13.3+ (and on Linux) this step does nothing.
#
# Devnet only.

export PATH="$HOME/.cargo/bin:$HOME/.avm/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"

HUDDLE_ROOT="${HUDDLE_ROOT:-$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)}"
if [ ! -f "$HUDDLE_ROOT/Anchor.toml" ]; then HUDDLE_ROOT="$(pwd)"; fi
# Platform-tools version Anchor 1.2.2 builds with (`anchor build --help`).
HUDDLE_PLATFORM_TOOLS="${HUDDLE_PLATFORM_TOOLS:-v1.57}"

huddle_needs_libcxx_shim() {
  [ "$(uname -s)" = "Darwin" ] || return 1
  os="$(sw_vers -productVersion)"
  major="${os%%.*}"
  rest="${os#*.}"
  minor="${rest%%.*}"
  [ "$major" -lt 13 ] && return 0
  [ "$major" -eq 13 ] && [ "${minor:-0}" -lt 3 ] && return 0
  return 1
}

huddle_patch_platform_tools() {
  tools="$HOME/.cache/solana/$HUDDLE_PLATFORM_TOOLS/platform-tools"
  if [ ! -d "$tools/llvm/bin" ]; then
    # First build on this machine: download platform-tools without building anything.
    cargo-build-sbf --install-only --tools-version "$HUDDLE_PLATFORM_TOOLS" >/dev/null 2>&1 || true
  fi
  if [ ! -d "$tools/llvm/bin" ]; then
    echo "solana-env: WARNING platform-tools $HUDDLE_PLATFORM_TOOLS not found in ~/.cache/solana" >&2
    return 1
  fi
  shim="$tools/huddle-shim/libhuddle_cxx.dylib"
  if [ ! -f "$shim" ]; then
    mkdir -p "$tools/huddle-shim"
    cc -dynamiclib -o "$shim" "$HUDDLE_ROOT/scripts/solana-lld-shim.c" -Wl,-reexport-lc++ -install_name "$shim" || return 1
  fi
  patched=0
  for bin in "$tools"/rust/lib/rustlib/*/bin/rust-lld "$tools"/llvm/bin/*; do
    [ -f "$bin" ] && [ ! -L "$bin" ] || continue
    if otool -L "$bin" 2>/dev/null | grep -q '/usr/lib/libc++.1.dylib'; then
      install_name_tool -change /usr/lib/libc++.1.dylib "$shim" "$bin" 2>/dev/null &&
        codesign -s - -f "$bin" 2>/dev/null &&
        patched=$((patched + 1))
    fi
  done
  if [ "$patched" -gt 0 ]; then
    echo "solana-env: macOS $(sw_vers -productVersion) < 13.3: repointed $patched platform-tools binaries at $shim" >&2
  fi
}

if huddle_needs_libcxx_shim; then
  huddle_patch_platform_tools
fi

# Run directly with a command to execute it inside this environment:
#   sh scripts/solana-env.sh anchor build
case "$(basename "$0")" in
solana-env.sh) if [ $# -gt 0 ]; then exec "$@"; fi ;;
esac
