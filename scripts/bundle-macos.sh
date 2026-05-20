#!/usr/bin/env bash
# Build web dist and a release macOS .app bundle (Tauri).
# Used by docs, CI-style checks, and the optional pre-commit hook.
#
# Usage: bash scripts/bundle-macos.sh
#
# Output: target/release/bundle/macos/Digitakt LLM.app

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "error: macOS bundle build requires Darwin (found $(uname -s))." >&2
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "error: bun is not on PATH (https://bun.sh)" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "error: cargo is not on PATH (https://rustup.rs)" >&2
  exit 1
fi

if ! cargo tauri --version >/dev/null 2>&1; then
  echo "error: cargo tauri not found. Install with:" >&2
  echo "  cargo install tauri-cli --locked" >&2
  exit 1
fi

echo "→ bundle-macos: building web dist..."
(cd web && bun install && bun run build)

echo "→ bundle-macos: cargo tauri build (release)..."
(cd src-tauri && cargo tauri build)

APP_PATH="$REPO_ROOT/target/release/bundle/macos/Digitakt LLM.app"
if [[ ! -d "$APP_PATH" ]]; then
  echo "error: expected app bundle at: $APP_PATH" >&2
  exit 1
fi

echo "→ bundle-macos: done"
echo "   $APP_PATH"
