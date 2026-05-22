# Digitakt LLM — app icon (gen → seq)

Design concept: **LLM generation sparkles** (cool cyan) flow into a **4×4 step grid** (warm amber), using web UI tokens from `web/src/styles/theme.css`.

## Paper MCP

1. Open **Paper.app** and create or open a document (File → New).
2. In Cursor, ask the agent to continue Paper iteration — MCP tools require an active Paper file.

## Files

| File | Purpose |
|------|---------|
| `paper-v3-chaos-order.png` | **v3** — full 8×8 grid, chaos (left) → order (right), no sparkles |
| `paper-v4-diagonal.png` | **v4** — 10×10 grid, diagonal derive (gray noise → amber pattern) |
| `paper-v1-4x4.png` | Deprecated — sparkles + small grid |
| `paper-v2-strip.png` | Deprecated — sparkles + step strip |
| `icon-gen-seq.svg` | Early SVG export (sparkle era) |

## Tauri (active icon)

Source: `paper-v3-chaos-order.png` → `src-tauri/icons/` (via `cargo tauri icon`).

```bash
cd src-tauri && cargo tauri icon ../design/app-icon/paper-v3-chaos-order.png
bash scripts/bundle-macos.sh
```

Rasterize SVG (macOS):

```bash
qlmanage -t -s 1024 -o design/app-icon design/app-icon/icon-gen-seq.svg
# renames to icon-gen-seq.svg.png — mv to icon-gen-seq.png
```
