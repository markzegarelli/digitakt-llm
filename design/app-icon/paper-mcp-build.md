# Paper MCP build script (gen → seq icon)

Run these steps once a **Paper document is open** (MCP returns artboards from `get_basic_info`).

## Artboard 1 — 4×4 grid (v1)

```
create_artboard: "Icon — gen→seq v1", 1024×1024, #0a0908
```

Then `write_html` insert-children in order:

1. Inset frame (`#0d0c0a`, border `#2a2520`, padding 80px, flex center)
2. Sparkle SVG group (cool stars, upper-left)
3. Flow dots + gradient stroke (center)
4. 4×4 grid container (flex row, gap 16px) — 4 columns, each column 4 cells
5. `get_screenshot` → review

## Artboard 2 — 16-step strip (v2)

Offset ~1104px from v1. Same sparkles + horizontal 16 narrow rects.

## Export

```
export: nodeId → png 1024w
```

## Import existing asset

```html
<img src="paper-asset:///Users/markzegarelli/projects/digitakt_llm/design/app-icon/icon-gen-seq.svg" style="width:1024px;height:1024px;" layer-name="Icon v1 import" />
```

Then `finish_working_on_nodes`.
