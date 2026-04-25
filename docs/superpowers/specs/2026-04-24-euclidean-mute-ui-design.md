# Euclidean Mute UI Design

## Goal

Make Euclidean SEQ a horizontally layered interface that supports the same immediate and queued mute workflow as standard SEQ, without changing backend or core player behavior.

## Scope

This is a TUI layout and input-state change only. The implementation should stay in the Bun/Ink UI, primarily near the Euclidean render path in `tui/src/App.tsx` and `tui/src/components/EuclidRingPanel.tsx`.

No FastAPI endpoint, core state model, MIDI player behavior, or command semantics need to change. Existing mute actions already provide the required behavior through `actions.setMute` and `actions.setMuteQueued`.

## Layout Model

Euclidean SEQ has three horizontal depth levels:

1. Track strip: a compact 8-track list shown to the left of the ring.
2. Active ring: the Euclidean ring for the selected track.
3. TRIG subpanel: available only after entering the active ring.

`Tab` remains vertical navigation between major panels and features, including `SEQ`, `MIX`, and `CMD`. `Tab` must not move through horizontal Euclidean depth.

Horizontal depth is controlled by `Enter` and `Esc`. `Enter` moves right into the selected feature. `Esc` moves left one level: `TRIG` to active ring, active ring to track strip.

## Track Strip

Add a compact Euclidean track strip to the left of `EuclidRingPanel` in the Euclidean render path. The strip lists all 8 tracks and marks the selected track with `>`.

The ring always previews and renders the currently selected track. While the track strip is focused, `Up` and `Down` change `patternTrack`, and the ring follows immediately.

`Enter` from the track strip enters active ring mode for the selected track. Existing k/n/r editing belongs to active ring mode, not to the track strip landing state.

## Active Ring And TRIG

The active ring continues to render from `state.euclid[TRACK_NAMES[patternTrack]]`. Ring behavior and k/n/r editing remain attached to the selected track.

The `t` and `Shift+T` shortcuts only work while active ring mode is selected. They must not open TRIG from the track strip.

When k is 0, the user can still enter active ring mode so they can edit k/n/r. Pressing `t` or `Shift+T` with k set to 0 keeps the existing no-pulses log hint and does not open TRIG.

## Mute Behavior

Euclidean SEQ reuses the standard SEQ mute model:

- `m` immediately toggles mute for the selected track.
- `q` stages or unstages the selected track locally.
- `Shift+Q` fires all staged mute changes through the existing queued mute action, applying them at the next bar boundary.

Mute controls work from both the track strip and active ring mode, always targeting `patternTrack`.

The track strip displays mute state using existing badge language:

- `M`: track is muted.
- `Q`: track has a staged mute change.
- `MQ`: track is muted and has a staged mute change.

## Data Flow

The implementation should feed the strip and ring from existing TUI state:

- `state.track_muted`
- `pendingMuteTracks`
- `patternTrack`
- current panel focus
- a new local Euclidean horizontal depth state

Queued and immediate mute actions should continue to call the existing TUI actions:

- `actions.setMute`
- `actions.setMuteQueued`

No new server data shape is required.

## Required Edge Cases

- Standard SEQ mute behavior stays unchanged.
- `k=0` still allows entering active ring mode for k/n/r editing.
- `t` and `Shift+T` with `k=0` keep the existing no-pulses hint and do not open TRIG.
- `Tab` does not traverse track strip, active ring, or TRIG depth.
- `Esc` backs out one horizontal level at a time.
- TRIG opens only from active ring mode.

## Test Expectations

Tests should cover:

- Euclidean `m` immediate mute targeting the selected track.
- Euclidean `q` staging and unstaging the selected track.
- Euclidean `Shift+Q` firing all staged mute changes through the queued mute action.
- `Enter` and `Esc` depth transitions between track strip, active ring, and TRIG.
- `Tab` preserving vertical panel navigation instead of horizontal depth navigation.
- TRIG opening only from active ring mode.
- Standard mode mute behavior remaining unchanged.
