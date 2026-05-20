# macOS release notes (Rust / Tauri)

## Core MIDI entitlements

Add to `src-tauri/Entitlements.plist` for hardware MIDI:

- `com.apple.security.device.audio-input` (if required by midir on your macOS version)
- Ensure the app is signed with a Developer ID certificate.

Digitakt USB MIDI requires the Elektron driver; the Rust stack uses `midir` (same as Python `mido`).

## Bundle build

From the repo root (macOS only):

```bash
bash scripts/bundle-macos.sh
```

Produces `target/release/bundle/macos/Digitakt LLM.app`. Requires Bun, Rust, and Tauri CLI (`cargo install tauri-cli --locked`).

### Pre-commit hook (optional)

To run the bundle build automatically before each commit that touches `web/`, `src-tauri/`, `crates/`, or workspace `Cargo.*`:

```bash
bash scripts/install-git-hooks.sh
```

Skip for one commit: `DIGITAKT_SKIP_BUNDLE=1 git commit …` or `git commit --no-verify`. Details: [.githooks/README.md](../.githooks/README.md).

## Notarization

1. `bash scripts/bundle-macos.sh` (or the steps below manually)
2. Notarize the `.app` with `xcrun notarytool submit` and staple the ticket.

## Local dev

- Web + Rust API: `cargo run -p digitakt-cli -- serve` and `cd web && bun run dev`
- Tauri shell: `cargo tauri dev` from `src-tauri/` (starts Vite on :5173 per `tauri.conf.json`)
