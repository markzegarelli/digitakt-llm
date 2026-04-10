#!/usr/bin/env bash
# Cloud setup script for Claude Code agentic environments.
# Installs system deps, creates venv, installs Python deps, and runs tests.
# Safe to run multiple times (idempotent). No interactive prompts.
#
# Usage:
#   bash scripts/setup-cloud.sh
#
# Register as a SessionStart hook in .claude/settings.json:
#   { "hooks": { "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": "bash scripts/setup-cloud.sh" }] }] } }

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"

echo "→ repo: $REPO_ROOT"

# ── Step 1: System deps (Linux only) ────────────────────────────────────────
if [[ "$(uname)" == "Linux" ]]; then
    echo "→ installing system dependencies..."
    sudo apt-get update -qq
    sudo apt-get install -y --no-install-recommends \
        libasound2-dev \
        python3-dev \
        build-essential
fi

# ── Step 2: Python venv ──────────────────────────────────────────────────────
if [ ! -d "$VENV_DIR" ]; then
    echo "→ creating venv..."
    python3 -m venv "$VENV_DIR"
fi

echo "→ installing Python dependencies..."
"$VENV_DIR/bin/pip" install --quiet --upgrade pip
"$VENV_DIR/bin/pip" install --quiet -e "$REPO_ROOT/.[dev]"

# ── Step 3: ANTHROPIC_API_KEY ────────────────────────────────────────────────
if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
    if [ -f "$REPO_ROOT/.env" ]; then
        echo "→ sourcing .env for ANTHROPIC_API_KEY..."
        set -a
        # shellcheck disable=SC1091
        source "$REPO_ROOT/.env"
        set +a
    else
        echo "⚠  ANTHROPIC_API_KEY not set — API calls will fail; tests will pass (all mocked)"
    fi
fi

# ── Step 4: Verify with tests ────────────────────────────────────────────────
echo "→ running test suite..."
"$VENV_DIR/bin/pytest" --tb=short -q

echo ""
echo "✓ setup complete"
echo "  activate venv: source $VENV_DIR/bin/activate"
