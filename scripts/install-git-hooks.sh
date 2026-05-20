#!/usr/bin/env bash
# Point this clone's git hooks at .githooks/ (bundle pre-commit, etc.).
#
# Usage: bash scripts/install-git-hooks.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "error: not inside a git repository" >&2
  exit 1
fi

chmod +x .githooks/pre-commit
chmod +x scripts/bundle-macos.sh

git config core.hooksPath .githooks

echo "→ git hooksPath set to .githooks for this repository"
echo "→ pre-commit will run scripts/bundle-macos.sh on staged web/rust/tauri changes (macOS only)"
echo "→ skip once: DIGITAKT_SKIP_BUNDLE=1 git commit ..."
echo "→ see .githooks/README.md"
