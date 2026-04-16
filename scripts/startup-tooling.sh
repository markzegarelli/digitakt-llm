#!/usr/bin/env bash
# Bootstrap cloud/dev sessions with required tooling and dependencies.
# Safe to run multiple times (idempotent). Non-interactive by default.
#
# Usage:
#   bash scripts/startup-tooling.sh
#
# Optional env toggles:
#   RUN_TESTS=1            Run test suite after setup
#   SKIP_SYSTEM_DEPS=1     Skip apt packages on Linux
#   SKIP_BUN_INSTALL=1     Skip frontend dependency install

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "→ repo: $REPO_ROOT"

install_uv() {
  if command -v uv >/dev/null 2>&1; then
    return
  fi
  echo "→ installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="${HOME}/.local/bin:${PATH}"
}

install_bun() {
  if command -v bun >/dev/null 2>&1; then
    return
  fi
  echo "→ installing bun..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="${HOME}/.bun/bin:${PATH}"
}

install_system_deps_linux() {
  if [[ "${SKIP_SYSTEM_DEPS:-0}" == "1" ]]; then
    echo "→ skipping Linux system deps (SKIP_SYSTEM_DEPS=1)"
    return
  fi
  if [[ "$(uname)" != "Linux" ]]; then
    return
  fi
  if ! command -v sudo >/dev/null 2>&1; then
    echo "→ sudo not available; skipping apt system dependencies"
    return
  fi

  echo "→ installing Linux system dependencies..."
  sudo apt-get update -qq
  sudo apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libasound2-dev \
    python3-dev \
    build-essential
}

install_system_deps_linux
install_uv
install_bun

echo "→ syncing python dependencies (uv sync --extra dev)..."
uv sync --extra dev

if [[ "${SKIP_BUN_INSTALL:-0}" != "1" ]]; then
  echo "→ installing frontend dependencies (bun install)..."
  bun install --cwd tui
else
  echo "→ skipping bun install (SKIP_BUN_INSTALL=1)"
fi

if [[ "${RUN_TESTS:-0}" == "1" ]]; then
  echo "→ running tests..."
  uv run pytest -q
fi

echo ""
echo "✓ startup tooling setup complete"
echo "  run app:   uv run digitakt"
echo "  run tests: uv run pytest -v"
