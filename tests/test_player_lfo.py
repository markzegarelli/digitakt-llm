# tests/test_player_lfo.py
from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from core.events import EventBus
from core.midi_utils import CC_MAP, TRACK_CHANNELS
from core.player import Player
from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES


def _pattern_with_lfo() -> dict:
    pat: dict = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    pat["lfo"] = {
        "cc:kick:filter": {
            "shape": "square",
            "depth": 100,
            "phase": 0.0,
            "rate": {"num": 1, "den": 8},
        }
    }
    return pat


def test_cc_lfo_emits_lfo_value_per_step():
    state = AppState()
    state.pattern_length = 16
    state.current_pattern = _pattern_with_lfo()
    state.update_cc("kick", "filter", 64)
    bus = EventBus()
    lfo_telemetry: list[dict] = []
    bus.subscribe("lfo_value", lfo_telemetry.append)
    port = MagicMock()
    player = Player(state, bus, port)
    player._play_step(0, set())
    assert len(lfo_telemetry) == 1
    p0 = lfo_telemetry[0]
    assert p0["target"] == "cc:kick:filter"
    assert p0["step"] == 0
    assert "value" in p0 and "base" in p0
    assert p0["base"] == 64
    assert 0 <= p0["value"] <= 127


def test_cc_lfo_emits_lfo_value_without_midi_port():
    """UI can show modulated CC even when no output device is open."""
    state = AppState()
    state.pattern_length = 16
    state.current_pattern = _pattern_with_lfo()
    state.update_cc("kick", "filter", 64)
    bus = EventBus()
    seen: list[dict] = []
    bus.subscribe("lfo_value", seen.append)
    player = Player(state, bus, None)
    player._play_step(0, set())
    assert len(seen) == 1 and seen[0]["target"] == "cc:kick:filter"


def test_cc_lfo_sends_varying_filter_values():
    state = AppState()
    state.pattern_length = 16
    state.current_pattern = _pattern_with_lfo()
    state.update_cc("kick", "filter", 64)
    bus = EventBus()
    port = MagicMock()
    player = Player(state, bus, port)
    # Two-step cycle: cycle_steps(16,1,8) == 2
    for step in range(4):
        player._play_step(step, set())
    filter_cc = CC_MAP["filter"]
    ch = TRACK_CHANNELS["kick"]
    values = [
        c[0][0].value
        for c in port.send.call_args_list
        if c[0][0].type == "control_change"
        and c[0][0].control == filter_cc
        and c[0][0].channel == ch
    ]
    assert len(values) == 4
    assert len(set(values)) == 2


def test_step_cc_base_used_for_lfo_modulation():
    state = AppState()
    state.pattern_length = 16
    pat = {k: [0] * 16 for k in TRACK_NAMES}
    pat["lfo"] = {
        "cc:kick:filter": {
            "shape": "sine",
            "depth": 0,
            "phase": 0.0,
            "rate": {"num": 1, "den": 1},
        }
    }
    pat["step_cc"] = {"kick": {"filter": [80] + [None] * 15}}
    state.current_pattern = pat
    state.update_cc("kick", "filter", 64)
    bus = EventBus()
    port = MagicMock()
    player = Player(state, bus, port)
    player._play_step(0, set())
    filter_cc = CC_MAP["filter"]
    ch = TRACK_CHANNELS["kick"]
    sent = [
        c[0][0].value
        for c in port.send.call_args_list
        if c[0][0].type == "control_change"
        and c[0][0].control == filter_cc
        and c[0][0].channel == ch
    ]
    assert sent == [80]


@pytest.fixture
def player_kick_lfo() -> tuple[Player, MagicMock]:
    state = AppState()
    state.pattern_length = 16
    state.current_pattern = _pattern_with_lfo()
    state.update_cc("kick", "filter", 64)
    bus = EventBus()
    port = MagicMock()
    return Player(state, bus, port), port


def test_lfo_marks_dirty_cc_for_bar_restore(player_kick_lfo):
    player, _ = player_kick_lfo
    dirty: set = set()
    player._play_step(0, dirty)
    assert ("kick", "filter") in dirty


def test_trig_prob_lfo_uses_default_100_when_no_prob_map():
    """`trig:*:prob` LFO modulates a 100% base when the pattern omits a prob row (matches gate: implicit base)."""
    state = AppState()
    state.pattern_length = 16
    state._loop_count = 0
    pat: dict = {k: [0] * 16 for k in TRACK_NAMES}
    pat["kick"][0] = 100
    # ramp at p=0 → w = -1; depth 100% → 50% effective probability
    pat["lfo"] = {
        "trig:kick:prob": {
            "shape": "ramp",
            "depth": 100,
            "phase": 0.0,
            "rate": {"num": 1, "den": 1},
        }
    }
    state.current_pattern = pat
    bus = EventBus()
    port = MagicMock()
    player = Player(state, bus, port)
    ch = TRACK_CHANNELS["kick"]
    with patch("core.player.random.random", return_value=0.6):
        player._play_step(0, set())
    n_high = [
        c
        for c in port.send.call_args_list
        if c[0][0].type == "note_on" and c[0][0].channel == ch
    ]
    assert len(n_high) == 0
    port2 = MagicMock()
    player2 = Player(state, bus, port2)
    with patch("core.player.random.random", return_value=0.4):
        player2._play_step(0, set())
    n_lo = [
        c
        for c in port2.send.call_args_list
        if c[0][0].type == "note_on" and c[0][0].channel == ch
    ]
    assert len(n_lo) >= 1
