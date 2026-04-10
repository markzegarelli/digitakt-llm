# Project Direction

## Vision

A terminal-native, AI-driven pattern sequencer for the Elektron Digitakt. The goal is a tool that feels like a creative collaborator — you describe the groove you want, and it builds, mutates, and drives the machine in real time.

The terminal is the intentional interface. No browser, no touchscreen. Just text and the hardware.

---

## Core Pillars

### 1. Terminal-first UX
The REPL is the instrument. The sequencer should feel as immediate and expressive as a hardware step sequencer — BPM, pattern length, mutes, variations, fills, and transitions all accessible from the keyboard without leaving the terminal.

### 2. AI as compositional engine
Claude generates patterns. The user steers via natural language. The system should understand musical intent ("make the kick sparser", "add a shuffle feel", "build tension over 4 bars") and translate it into Digitakt-compatible step data.

### 3. Digitakt-native
The output format should map cleanly to how the Digitakt thinks: 16 steps per track, up to 8 tracks (BD, SD, HH, etc.), velocity, probability, and note length. Future features should deepen this model rather than abstract away from it.

---

## Connectivity

### Current: USB MIDI
MIDI notes + 24 PPQN clock over USB. Solid, low-latency, well-understood. This is the primary path.

### To Explore: Overbridge / Direct Protocol
Elektron Overbridge is a proprietary protocol that runs over USB alongside standard MIDI. It enables deeper integration:
- Direct parameter control (filter, LFO, reverb per track)
- Audio return per track
- Potentially: pattern/kit upload without step-by-step note playback

**Realistic assessment:**
- The Overbridge SDK is not public. Reverse-engineering the protocol is possible but brittle.
- A more practical middle path: **MIDI SysEx**. The Digitakt responds to some SysEx messages (backup/restore via Elektron Transfer/C6). The community has partially mapped this — it could allow pattern upload rather than real-time note playback.
- For now, USB MIDI is the right bet. Revisit SysEx exploration once the sequencer is feature-complete on the playback side.

**Decision checkpoint:** Before building deep Overbridge/SysEx support, validate that USB MIDI note-playback is genuinely limiting. If latency, pattern complexity, or parameter control become blockers, that's when to dig in.

---

## Roadmap (Phases)

### Phase 1 — Solid Sequencer Core *(in progress)*
- [x] 16-step pattern generation via Claude
- [x] 8-track note playback with BPM control
- [x] MIDI clock (24 PPQN), transport start/stop
- [x] Variation mode (incremental changes via prior context)
- [ ] Multi-track pattern display in terminal (grid view)
- [ ] Per-track mute/unmute from REPL
- [ ] Pattern length variants (8, 16, 32 steps)
- [ ] Save/load patterns to disk

### Phase 2 — Live Performance Feel
- [ ] Queued pattern transitions (swap at bar boundary, Digitakt-style)
- [ ] Fill/break generation ("generate a 2-bar fill")
- [ ] Per-track probability control
- [ ] Swing/shuffle offset per track
- [ ] Named pattern library (store, recall, arrange)

### Phase 3 — Deeper Digitakt Integration
- [ ] Velocity and note length per step (not just on/off)
- [ ] Track pitch control (for melodic/bass tracks)
- [ ] Conditional trigs (Elektron's p-lock style conditions: "1:2", "not:2")
- [ ] SysEx pattern upload investigation (bypass real-time playback)

### Phase 4 — Compositional Intelligence
- [ ] Section awareness (intro → verse → chorus → breakdown)
- [ ] Multi-pattern arrangement generation
- [ ] Style/genre presets as context seeds
- [ ] Feedback loop: Claude observes what's playing and proposes next variation

---

## Non-Goals
- A web or GUI frontend (the terminal is intentional)
- DAW integration (this is a standalone instrument)
- Support for hardware other than the Digitakt (for now)
