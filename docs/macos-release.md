# macOS release notes (Rust / Tauri)

## Core MIDI entitlements

Add to `src-tauri/Entitlements.plist` for hardware MIDI:

- `com.apple.security.device.audio-input` (if required by midir on your macOS version)
- Ensure the app is signed with a Developer ID certificate.

Digitakt USB MIDI requires the Elektron driver; the Rust stack uses `midir` (same as Python `mido`).

## Notarization

1. `cd web && bun install && bun run build`
2. `cargo tauri build` from `src-tauri/`
3. Notarize the `.app` with `xcrun notarytool submit` and staple the ticket.

## Local dev

- Web + Rust API: `cargo run -p digitakt-cli -- serve` and `cd web && bun run dev`
- Tauri shell: `cargo tauri dev` from `src-tauri/` (starts Vite on :5173 per `tauri.conf.json`)
