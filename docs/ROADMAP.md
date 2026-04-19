# Roadmap — digitakt-llm

**North star:** v1.0.0 — a terminal instrument solid enough for a long live set (see goal in [implementation plan](./plans/2026-04-12-v1-implementation.md)).

**Sources of truth for behavior:** [CLAUDE.md](../CLAUDE.md) (commands and UX), [ARCHITECTURE.md](../ARCHITECTURE.md) (events, threading, REST), and this file for **release gates** and **milestone ordering**.

---

## Shipped vs original v1 plan (codebase audit)

| Original plan slice | Status | Where it lives in code / docs |
|---------------------|--------|-------------------------------|
| **Chain engine** (setlist, bar sync, auto) | Shipped (extended) | `core/state.py` — `chain`, `chain_patterns`, `chain_index`, `chain_auto`, `chain_queued_*`, `chain_armed`; `core/player.py` — advance + fills; `api/server.py` — `POST /chain`, `POST /chain/next`, `POST /chain/fire`, `DELETE /chain`; TUI `/chain …`, `/chain next`, `/chain fire`, `/chain status`, `/chain clear` per `CLAUDE.md` |
| **Instrument panel** | Shipped | `tui/src/components/StatusBar.tsx`, `ChainPanel.tsx`, `StepGrid.tsx`, `GenerationSummary.tsx` wired in `tui/src/App.tsx`; `generation_complete` carries `summary` (see `ARCHITECTURE.md`) |
| **Feedback as `POST /next`, `/vary`, `/read` + matching TUI** | **Not implemented** — superseded | **Current product:** `POST /generate` with optional `variation`, `POST /ask` (Haiku Q&A), TUI `/fresh`, `/gen`, chat vs beat modes (`tui/src/hooks/useDigitakt.ts`, `api/server.py`). The long-form plan Tasks 14–17 are historical; do not treat `/next` `/vary` `/read` as v1 blockers unless you explicitly re-scope v1. |
| **Docs / integration (old Task 18)** | In progress | Keep `CLAUDE.md` and `ARCHITECTURE.md` aligned with the routes and events above; drop references to unimplemented endpoints. |

---

## Milestone sequence (refactored — ordered gates)

Work toward v1.0.0 **in this order**. Later gates assume earlier ones stay green.

### Gate A — Command and API contract (frozen)

- [ ] Confirm **no internal doc** advertises `POST /next`, `POST /vary`, `POST /read`, or `GET /chain` unless they exist in `api/server.py` (they do not today).
- [ ] Slash-command help in `tui/src/components/Prompt.tsx` matches `CLAUDE.md` and actual handlers in `tui/src/App.tsx`.

### Gate B — Architecture doc parity

- [ ] `ARCHITECTURE.md` endpoint table matches `api/server.py` (including `/ask`, `/chain/fire`, traces, CC routes).
- [ ] WebSocket event table includes all `_ALL_EVENTS` (or documented subset) consistent with `api/server.py` broadcast list.
- [ ] Chain semantics (queued vs armed vs `chain_advanced`) described the way `core/state.py` and `core/player.py` behave.

### Gate C — Set-length hardening (qualitative v1 bar)

- [ ] Long session smoke: stable memory/CPU with WebSocket + playback (document findings in a PR or issue).
- [ ] Failure modes: missing API key, MIDI disconnect mid-playback, stuck generation — predictable UI/log behavior.
- [ ] Optional: `DIGITAKT_ADMIN_TOKEN` + `GET /traces` documented for operators who enable tracing.

### Gate D — Release hygiene

- [ ] `pyproject.toml` `version` matches the git tag you cut for each release.
- [ ] `uv run pytest` and `cd tui && bun run build` documented as pre-release checks (see `CLAUDE.md` / README).

### Gate E — v1.0.0 tag

- [ ] Gates A–D complete (or explicitly waived with rationale in a short “v1 acceptance” issue).
- [ ] Tag **v1.0.0** on the release commit; publish GitHub release notes summarizing operator-facing behavior (not internal plan task IDs).

---

## After v1.0.0 (v1.x / research)

Not required for the first stable “instrument” release:

- Section metadata through chain + generation for full set arcs (beyond current chain + prompts).
- Multi-pattern one-shot arrangement generation.
- SysEx / Transfer pattern upload spike; Overbridge research (see ignored `DIRECTION.md` locally if you maintain it).

---

## Related files

| File | Role |
|------|------|
| [docs/plans/2026-04-12-v1-implementation.md](plans/2026-04-12-v1-implementation.md) | Detailed historical task breakdown; header + Task 18 updated for superseded feedback API |
| [CLAUDE.md](../CLAUDE.md) | Agent + human command reference |
| [ARCHITECTURE.md](../ARCHITECTURE.md) | System design and API |
