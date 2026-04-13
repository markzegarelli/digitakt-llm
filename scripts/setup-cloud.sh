#!/usr/bin/env bash
# Cloud setup for agentic environments: system deps (Linux), uv, sync, tests.
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

# ── Step 2: uv (bootstrap if missing) ─────────────────────────────────────────
if ! command -v uv >/dev/null 2>&1; then
    echo "→ installing uv..."
    curl -LsSf https://astral.sh/uv/install.sh | sh
    export PATH="${HOME}/.local/bin:${PATH}"
fi

cd "$REPO_ROOT"
echo "→ uv sync --extra dev..."
uv sync --extra dev

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
uv run pytest --tb=short -q

echo ""
echo "✓ setup complete"
echo "  run tests: uv run pytest -v"
echo "  activate venv (optional): source $VENV_DIR/bin/activate"
