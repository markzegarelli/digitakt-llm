#!/usr/bin/env bash
# Sync Python dependencies with uv and optionally activate .venv.
# Usage: bash scripts/setup-dev.sh
#        source scripts/setup-dev.sh   ← also activates the venv in your shell
#
# Requires: https://docs.astral.sh/uv/getting-started/installation/

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"

if ! command -v uv >/dev/null 2>&1; then
    echo "error: uv is not installed or not on PATH." >&2
    echo "  Install: https://docs.astral.sh/uv/getting-started/installation/" >&2
    exit 1
fi

echo "→ repo: $REPO_ROOT"
cd "$REPO_ROOT"

echo "→ uv sync --extra dev..."
uv sync --extra dev

echo "→ done. Run without activating:"
echo "   uv run digitakt"
echo "   uv run pytest -v"
echo "→ Or activate:"
echo "   source $VENV_DIR/bin/activate"

# If sourced (not executed), activate immediately.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    # shellcheck disable=SC1090
    source "$VENV_DIR/bin/activate"
    echo "→ venv activated ($(python --version))"
fi
