# Web UI debugging (Chrome DevTools MCP)

Use this when the React workbench (`web/`) misbehaves: empty sequencer after generation, chat shows slash commands instead of patterns, controls not updating, stale UI after a fix, etc.

**Prerequisite:** [Chrome DevTools MCP](https://github.com/anthropics/claude-code/tree/main/plugins/chrome-devtools-mcp) enabled in Cursor (`plugin-chrome-devtools-mcp-chrome-devtools`).

## Which URL are you hitting?

| URL | Frontend source | When to use |
|-----|-----------------|-------------|
| `http://localhost:5173` | Vite dev server (`cd web && bun run dev`) | Active development; HMR picks up `web/src` changes immediately |
| `http://localhost:8000` | Built static `web/dist/` mounted by FastAPI / Rust server | Production-style; **must** run `cd web && bun run build` after frontend changes |
| Tauri `Digitakt LLM.app` | Embedded `web/dist/` inside the bundle | Same as `:8000`; rebuild with `bash scripts/bundle-macos.sh` |

If a fix works on `:5173` but not `:8000`, the bug is almost always a **stale bundle**, not backend logic.

## Start the stack

```bash
# Python API (port 8000)
uv run digitakt --ui web
# or Rust/Tauri path:
cargo run -p digitakt-cli -- serve

# Web dev (port 5173) — separate terminal if not using --ui web fallback
cd web && bun run dev
```

Backend health: `GET http://localhost:8000/state` should return JSON with `current_pattern`, `bpm`, etc.

## Chrome MCP self-diagnose loop

Run this loop until evidence confirms or rejects each hypothesis. Do **not** patch from code alone.

### 1. Baseline

1. `navigate_page` → target URL (`http://localhost:5173` or `http://localhost:8000`).
2. If you suspect a cached bundle: `navigate_page` with `type: reload`, `ignoreCache: true`.
3. `take_snapshot` — note MODE (SEQ/CHAT/CMD), BPM/SWG header, sequencer grid, chat log.

### 2. Reproduce

1. Focus CHAT: `press_key` → `c` (or click the chat input from snapshot `uid`).
2. `fill` the chat input with the user prompt.
3. `press_key` → `Enter`.

### 3. Collect runtime evidence

Run **all** of these after each reproduction:

| Tool | What to check |
|------|----------------|
| `list_network_requests` (`resourceTypes: ["fetch","xhr"]`) | Which API was called? See signal table below. |
| `list_console_messages` | React errors, WebSocket failures, failed fetches. |
| `evaluate_script` | DOM text snapshot, e.g. chat tail + header BPM/SWG + selected step velocity. |
| `take_snapshot` | Post-action UI state (lit SEQ cells, chat pending/resolved text). |

Example `evaluate_script` helper:

```javascript
() => ({
  chat: document.body.innerText.match(/CHAT[\s\S]{0,600}/)?.[0],
  bpm: document.body.innerText.match(/BPM\s*\n\s*([\d.]+)/)?.[1],
  swg: document.body.innerText.match(/SWG\s*\n\s*(\d+)/)?.[1],
  vel: document.body.innerText.match(/velocity\s*\n\s*(\d+)/)?.[1],
})
```

### 4. Interpret signals

**Network (fetch/xhr)**

| Request | Meaning |
|---------|---------|
| `POST /generate` | Pattern generation queued (Opus + `emit_pattern` tool). Expect `generating…` in chat, then `generation_complete` over WS. |
| `POST /ask` | Text-only Haiku reply. Often returns runnable slash commands — **does not** populate the sequencer. Plain CHAT should **not** hit this (beat mode uses `/generate`). |
| `GET /state` | Initial hydrate on load. |
| `POST /play`, `/stop`, `/vel`, … | Direct mutation endpoints. |

**WebSocket** (`resourceTypes: ["websocket"]` if available, or infer from UI updates)

| Event (via `client.ts` → `{type, ...}`) | Meaning |
|------------------------------------------|---------|
| `generation_started` | UI should show pending `generating…` |
| `generation_complete` | Pattern + `summary` applied; chat resolves with `Pattern: BDx4 …` |
| `generation_failed` | Chat shows error string |
| `pattern_changed` | Manual edits, `/new`, bar-boundary swap |

**Chat text patterns**

| LLM reply shape | Likely cause |
|-----------------|--------------|
| `bpm 120` / `prob kick 0 100` / `play` | `/ask` path or stale bundle still calling `ask()` |
| `generating…` → `Pattern: BDx4 · CHx8 · …` | `/generate` path working |
| `Pattern ready.` with empty grid | WS event missing `pattern`, parse failure, or euclidean display gap (hits in `euclid`, velocities all 0) |

### 5. Cross-check backend

In parallel with the browser loop:

```bash
curl -s http://localhost:8000/state | python3 -m json.tool | head -40
```

After `generation_complete`, `current_pattern.kick` (and other tracks) should contain non-zero velocities for standard-mode patterns.

### 6. Decide, fix, verify

For each hypothesis:

- **CONFIRMED** — implement minimal fix; keep MCP instrumentation if any; re-run steps 1–3 on the **same URL** the user reports.
- **REJECTED** — revert speculative code; generate new hypotheses; repeat.

Verification pass must show:

1. `POST /generate` (not `/ask`) for plain CHAT prompts.
2. `generation_complete` received (grid + chat summary update).
3. If testing `:8000` or Tauri: fresh `web/dist` or rebuilt `.app`.

## Common failure modes

| Symptom | First check | Fix |
|---------|-------------|-----|
| Chat lists slash commands, grid empty | Network: `/ask` vs `/generate`; URL `:8000` vs `:5173` | Route CHAT to `generate()`; `cd web && bun run build` |
| Fix works in dev, not production | Compare network on both ports | Rebuild `web/dist` / `bundle-macos.sh` |
| Chat says “Pattern: …” but grid empty | `evaluate_script` velocities; `seq_mode` in `/state` | Euclidean mode: hits may be in `euclid` k/n/r with zero velocities — web SEQ only renders `velocity > 0` |
| No WS updates at all | Console + backend running on `:8000` | Confirm API up; check mixed origins (5173 proxy vs direct 8000) |
| Controls revert immediately | `pattern_changed` overwriting state | Trace event order in network/WS |

## Key frontend files

| Area | File |
|------|------|
| CHAT submit path | `web/src/App.tsx` (`onChatSend`) |
| WS → state | `web/src/backend/client.ts`, `web/src/hooks/useDigitakt.ts` |
| Sequencer view | `web/src/lib/viewModel.ts` (`buildTrackViews`) |
| Slash commands | `web/src/lib/commandDispatch.ts` |

## Related docs

- [ARCHITECTURE.md](../ARCHITECTURE.md) — EventBus events, `/generate` flow
- [docs/macos-release.md](macos-release.md) — Tauri bundle rebuild
- [CLAUDE.md](../CLAUDE.md) — launch commands and web layout
