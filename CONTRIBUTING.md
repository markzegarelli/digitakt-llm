# Contributing to digitakt-llm

Thanks for your interest in contributing. This document covers dev setup, testing, and PR conventions.

## Hardware Note

You do not need an Elektron Digitakt to develop or run tests. All MIDI calls are mocked in the test suite. Hardware is only required to test actual playback end-to-end.

## Dev Setup

**Prerequisites:** Python 3.11+, [uv](https://docs.astral.sh/uv/getting-started/installation/), [Bun](https://bun.sh) ≥1.1

```bash
# Clone and install Python dependencies
git clone https://github.com/markzegarelli/digitakt-llm
cd digitakt-llm
uv sync --extra dev

# Install TUI dependencies
cd tui && bun install && cd ..
```

**Without uv:** `python3 -m venv .venv && source .venv/bin/activate` then `pip install -e ".[dev]"`.

Create a `.env` file with your Anthropic API key (required only for live generation, not tests):

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Running Tests

```bash
uv run pytest -v
```

288 tests, ~4s. No real MIDI or Anthropic API calls — everything is mocked.

## Making Changes

### Branches

Use descriptive branch names:

- `feature/pattern-fills` — new features
- `fix/bpm-validation` — bug fixes
- `refactor/event-bus` — internal cleanup

### Commits

Short imperative subject line, body optional:

```
fix(player): clamp BPM to valid range before setting state

Prevents a panic when the LLM returns fractional BPM values
outside the 20–400 range.
```

### Tests

All new behavior must be covered by tests. The project follows TDD — write the test first, then the implementation. Tests live in `tests/`, one file per module.

### Pull Requests

Open a PR against `main`. The PR template will prompt you for:

- A summary of the change
- A test plan
- A checklist confirming tests pass and docs are updated

CI runs `pytest` on Python 3.11 and 3.12. PRs must be green before merging.

### Docs

If your change adds or modifies slash commands, update the command table in `CLAUDE.md`.
If your change affects data flow or module structure, update `ARCHITECTURE.md`.
If your change adds API endpoints, document them in `ARCHITECTURE.md`.

## Project Structure

See `CLAUDE.md` for the full layout and `ARCHITECTURE.md` for system design.
