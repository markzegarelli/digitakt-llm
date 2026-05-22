# Git hooks

This repo ships optional hooks under `.githooks/`. They are **not** enabled until you install them locally.

## macOS bundle pre-commit

Runs `scripts/bundle-macos.sh` (web build + `cargo tauri build`) when a commit stages changes under `web/`, `src-tauri/`, `crates/`, or `Cargo.toml` / `Cargo.lock`.

**Requires:** macOS, Bun, Rust, [Tauri CLI](https://v2.tauri.app/reference/cli/) (`cargo install tauri-cli --locked`).

Install once per clone:

```bash
bash scripts/install-git-hooks.sh
```

Skip for a single commit:

```bash
DIGITAKT_SKIP_BUNDLE=1 git commit -m "..."
# or
git commit --no-verify -m "..."
```

See [docs/macos-release.md](../docs/macos-release.md) and [CONTRIBUTING.md](../CONTRIBUTING.md).
