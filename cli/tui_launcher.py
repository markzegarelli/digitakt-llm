"""Launches the Bun TUI from the tui/ subdirectory."""
from __future__ import annotations
import os
import subprocess
import sys
from pathlib import Path


def main() -> None:
    tui_dir = Path(__file__).parent.parent / "tui"
    if not tui_dir.exists():
        print("Error: tui/ directory not found. Run 'bun install' in tui/ first.")
        sys.exit(1)
    url = os.environ.get("DIGITAKT_URL", "http://localhost:8000")
    result = subprocess.run(
        ["bun", "run", "src/index.tsx"],
        cwd=str(tui_dir),
        env={**os.environ, "DIGITAKT_URL": url},
    )
    sys.exit(result.returncode)
