# TODO — Roadmap and release tracking

See [DIRECTION.md](DIRECTION.md) for product vision and phases. Detailed v1 breakdown: [docs/plans/2026-04-12-v1-implementation.md](docs/plans/2026-04-12-v1-implementation.md).

---

## Next release: **v0.6.0** (recommended)

**Tag:** `v0.6.0` on current `main` (after `v0.5.0` at #36).

**Why 0.6 (minor), not patch:** Since `v0.5.0`, merged work includes bidirectional MIDI CC sync (#40), fuzzy targeted track updates in the generator (#41), richer beat prompt context (#43), LLM tool use plus `/ask` / `/fresh` flow (#44), and a user-visible slash-command surface change for chain + track-wide TRIG (#45), plus bar-boundary and CC-echo fixes (#39, #38). That bundle is a coherent **minor** step toward the v1 instrument; it is not yet the full v1 integration milestone.

**Suggested GitHub release title:** `v0.6.0 — CC sync, smarter generator, prompting refresh`

**Release notes (high level):**

- Hardware → TUI MIDI CC sync (with echo-safe input path).
- Generator: fuzzy constraint injection for targeted track edits.
- Beat prompting: stronger genre/machine context for the model.
- Claude: tools + single `/ask`, `/fresh`, fuller pattern context in generation.
- TUI: simplified chain subcommands and track-wide-only slash parameters where applicable; bar-boundary / gate consistency fixes.

**Before tagging:** `uv run pytest -v` green; smoke `uv run digitakt` with `.env`; `cd tui && bun run build`.

---

## Toward v1.0.0 (from implementation plan + current tree)

The plan in `docs/plans/2026-04-12-v1-implementation.md` predates some shipped behavior (e.g. feedback UX may use `/ask` / `/gen` rather than the plan’s `/next` / `/vary` / `/read`). Use that plan plus the checklist below as the merge gate for **1.0.0** (add or restore a design spec under `docs/specs/` if you want a single canonical doc).

- [ ] **Docs pass (plan Task 18):** `CLAUDE.md`, `ARCHITECTURE.md`, and `DIRECTION.md` checklist items match live REST/WebSocket commands and events (including chain, traces, admin token, length, fill).
- [ ] **Spec reconciliation:** Decide whether to implement `/next`, `/vary`, `/read` (API + TUI) as in the plan, or formally retire that slice and update the plan/spec to match `/ask`, `/fresh`, `/gen` (and any server endpoints that replaced them).
- [ ] **Instrument UX audit:** Confirm status/setlist/step UI matches “45-minute set” goal — playhead, chain visibility, generation summary, CC panel coherence under load.
- [ ] **Hardening:** Error paths for missing API key, MIDI disconnect mid-set, and stuck generation; confirm `DIGITAKT_ADMIN_TOKEN` behavior for `/traces` in release notes if exposed.
- [ ] **Release hygiene:** Keep `pyproject.toml` `version` in sync with git tags going forward; add optional `CHANGELOG.md` or GitHub-generated notes per tag.
- [ ] **v1.0.0 tag:** Only after the above; then announce as the first stable “terminal instrument” release.

---

## Near-term product (post v0.6.0)

- [x] Multi-track grid in terminal with live updates
- [x] Per-track mute / queued mute from TUI
- [x] Pattern lengths 8 / 16 / 32 (API + TUI); LLM told target length in prompts
- [x] Save / load / tags / pattern library on disk
- [x] Per-track probability, swing, per-step TRIG (vel / prob / gate / cond / pitch), fills and chain UX (see `CLAUDE.md`)

## Live performance / polish

- [x] Bar-boundary pattern queue / fills / chain advance patterns (core flows shipped — keep stress-testing)
- [ ] **Set rehearsal:** Long-run session notes (CPU, WebSocket reconnect, memory) documented from real hardware runs
- [ ] **Fill intelligence:** Optional LLM-driven fill prompts distinct from main pattern (quality pass)

## Bug investigations

- [ ] App-triggered sounds slower or lower than expected — compare outbound CC/note timing vs Digitakt defaults (see prior MIDI tune suspicion)

## Digitakt depth (later)

- [ ] SysEx / Transfer pattern upload spike (community docs)
- [ ] Overbridge research (non-goal until MIDI path hits a wall — see `DIRECTION.md`)

## Compositional intelligence

- [x] Richer style / machine context in generation (#43+)
- [ ] Explicit **section** metadata through chain + generation (intro / drop / break) end-to-end tested for a full set arc
- [ ] Multi-pattern “one shot” arrangement generation (optional v1.x)
