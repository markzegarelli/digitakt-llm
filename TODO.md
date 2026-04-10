# TODO — Future Exploration

See [DIRECTION.md](DIRECTION.md) for the full roadmap and connectivity strategy.

---

## Near-term (Phase 1 completion)

- [x] Multi-track grid display in terminal — show all 8 tracks as a 16-step grid, updating live
- [x] Per-track mute/unmute from REPL (`mute 1`, `unmute bd`, etc.)
- [ ] Pattern length variants — support 8, 16, 32 steps; Claude should be told the target length
- [x] Save/load patterns to disk — JSON files, named by prompt or user label

## Live performance (Phase 2)

- [ ] Fill generation — `fill 2` generates a 2-bar fill queued for next bar boundary
- [ ] Named pattern library — `save "verse"`, `load "verse"`, `list patterns`
- [x] Per-track probability — expose Digitakt's trig probability concept in the pattern model
- [x] Swing offset — add shuffle/swing parameter to BPM control

## Digitakt depth (Phase 3)

- [ ] Velocity and note length per step — currently all steps are full velocity; add per-step values to JSON schema
- [ ] Track pitch — support melodic/bass tracks with per-step pitch offset
- [ ] Conditional trigs — Elektron's trig conditions (1:2, not:2, fill) as an optional step attribute
- [ ] SysEx investigation — research community-documented Digitakt SysEx for direct pattern upload

## Connectivity exploration

- [ ] Research Overbridge protocol (USB HID/bulk transfer alongside MIDI) — check community repos
- [ ] Test Elektron Transfer SysEx format — can patterns be uploaded without real-time playback?
- [ ] Benchmark USB MIDI latency at 120+ BPM with 8 tracks — identify if this is a real bottleneck

## Compositional intelligence (Phase 4)

- [ ] Section-aware generation — tell Claude "this is the chorus, 32 bars in"
- [ ] Multi-pattern arrangement — generate a full 8-pattern set (intro/verse/chorus/etc.) in one shot
- [ ] Style seeds — define reusable prompt prefixes for genre/feel (techno, jungle, afrobeat, etc.)

