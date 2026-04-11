# Digitakt SysEx Investigation

## Summary

The Elektron Digitakt does **not** publish a public SysEx specification for pattern-level data exchange. Its official MIDI implementation covers standard note, CC, and program-change messages only. Bulk pattern and project data can be transferred via Elektron's proprietary Overbridge protocol (USB audio/MIDI class) and via the C6 SysEx librarian tool using Elektron's undocumented System Exclusive format — but neither is documented for third-party use. Community reverse-engineering efforts on Elektronauts and lines.llll.ee confirm that the SysEx framing is Elektron-proprietary and not stable across firmware versions. The most practical path for real-time parameter control in this project remains MIDI CC on channels 1–8, which is fully documented and works without Overbridge.

## Protocol Support

| Feature | Supported | Notes |
|---------|-----------|-------|
| Pattern dump (send/receive) | Partial | Via C6 librarian and Elektron's undocumented SysEx; not available for third-party use |
| Sample management | No | Overbridge only |
| Project backup | Partial | C6 tool uses SysEx but format is proprietary and firmware-dependent |
| Real-time parameter change | **Yes** | Standard MIDI CC on channels 1–8, fully documented in MIDI implementation chart |
| Note triggering | **Yes** | note_on on channels 1–8, one channel per track |
| Transport control | **Yes** | MIDI start/stop/clock on any port |

## Known SysEx Messages

Elektron uses a proprietary SysEx format. Known framing (from community reverse engineering):

```
F0  3E  <device_id>  <cmd>  <data...>  F7
```

- Manufacturer ID `3E` = Elektron Music Machines
- `<device_id>` varies by product; Digitakt uses `0x0E` (as reported by community, unverified)
- `<cmd>` bytes for dump request/response are not publicly documented
- Format changes between firmware versions (e.g. 1.x vs 1.30+ broke existing tools)

No reliable byte-level documentation for pattern or kit dumps exists in the public domain as of 2026.

## Community Findings

- **Elektronauts** (elektronauts.com): Multiple threads confirm SysEx pattern backup is possible via C6 but the format is undocumented. Users report that SysEx dumps from one firmware version cannot be loaded on a different version.
- **lines.llll.ee**: Norns/SuperCollider users have probed the SysEx stream with MIDI monitors. The general consensus is that Elektron does not want third-party tools reading/writing pattern data directly.
- **Overbridge SDK**: Elektron has not released a public Overbridge plugin SDK. The VST plugin streams audio and parameter data, but its protocol is closed.
- **C6 Librarian**: Elektron's own tool sends/receives SysEx for pattern/kit/project backup. Wireshark-style MIDI captures show variable-length payloads with no published schema.

## Overbridge

Overbridge operates as a USB audio+MIDI class-compliant device. It exposes:
- 8 stereo audio channels (USB audio)
- MIDI in/out over USB (same as native USB MIDI)

Overbridge does **not** expose an additional SysEx channel for parameter read-back or pattern manipulation beyond what standard MIDI CC provides. Real-time parameter automation in DAWs goes through standard MIDI CC. Pattern data stays on the device.

## Recommendation for CP4+

**SysEx is not a viable path** for pattern generation or step-level control in this project. The Digitakt's SysEx format is proprietary, undocumented, and firmware-dependent.

**Viable continuation paths:**
1. **MIDI CC (current approach)** — fully supported, stable, already implemented. Covers all real-time sound shaping.
2. **MIDI Program Change** — can switch between the 128 patterns stored on the device. Could be used to switch between pre-programmed patterns.
3. **MIDI note triggering** — already implemented. Each track is on its own channel; velocity and pitch (note number → different sample slot on some tracks) are supported.
4. **Chromatic mode** — on tracks configured for chromatic mode, different MIDI note numbers play different pitches of the same sample. This is the mechanism behind `track_pitch` in CP3.

If richer pattern transfer is needed in a future CP, the path would be to generate patterns inside the Digitakt via its hardware UI, then use MIDI CC to modulate them in real time from this tool. Full pattern replacement via SysEx is not feasible without Elektron cooperation.
