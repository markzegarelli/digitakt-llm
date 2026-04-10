#!/usr/bin/env bash
# Setup venv and install dependencies for local development / worktree testing.
# Usage: bash scripts/setup-dev.sh
#        source scripts/setup-dev.sh   ← also activates the venv in your shell

set -e

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"

echo "→ repo: $REPO_ROOT"

if [ ! -d "$VENV_DIR" ]; then
    echo "→ creating venv..."
    python3 -m venv "$VENV_DIR"
fi

echo "→ installing dependencies..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -e "$REPO_ROOT/.[dev]"

echo "→ done. To activate:"
echo "   source $VENV_DIR/bin/activate"

# If sourced (not executed), activate immediately.
if [[ "${BASH_SOURCE[0]}" != "${0}" ]]; then
    # shellcheck disable=SC1090
    source "$VENV_DIR/bin/activate"
    echo "→ venv activated ($(python --version))"
fi
