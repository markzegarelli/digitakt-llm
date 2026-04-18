# core/midi_utils.py
from __future__ import annotations

from collections import defaultdict, deque
import threading
import time

import mido

NOTE_MAP: dict[str, int] = {
    "kick":    60,
    "snare":   60,
    "tom":     60,
    "clap":    60,
    "bell":    60,
    "hihat":   60,
    "openhat": 60,
    "cymbal":  60,
}

# Maps app track name → 0-indexed MIDI channel (Digitakt: ch 1–8)
TRACK_CHANNELS: dict[str, int] = {
    "kick":    0,  # ch 1 — Kick
    "snare":   1,  # ch 2 — Snare
    "tom":     2,  # ch 3 — Tom
    "clap":    3,  # ch 4 — Clap
    "bell":    4,  # ch 5 — Bell
    "hihat":   5,  # ch 6 — Closed hat
    "openhat": 6,  # ch 7 — Open hat
    "cymbal":  7,  # ch 8 — Cymbal
}

_CC_PARAM_DEFS: dict[str, dict] = {
    "tune":      {"cc": 16, "default": 64},   # Source tune
    "filter":    {"cc": 74, "default": 127},  # Filter frequency
    "resonance": {"cc": 75, "default": 0},    # Filter resonance
    "attack":    {"cc": 78, "default": 0},    # Amp attack time
    "hold":      {"cc": 79, "default": 0},    # Amp hold time
    "decay":     {"cc": 80, "default": 64},   # Amp decay time
    "volume":    {"cc":  7, "default": 100},  # Amp volume
    "reverb":    {"cc": 83, "default": 0},    # Amp reverb send
    "delay":     {"cc": 82, "default": 0},    # Amp delay send
}

CC_MAP: dict[str, int] = {k: v["cc"] for k, v in _CC_PARAM_DEFS.items()}
CC_DEFAULTS: dict[str, int] = {k: v["default"] for k, v in _CC_PARAM_DEFS.items()}

# Reverse lookups for MIDI input decoding
CC_NUMBER_TO_PARAM: dict[int, str] = {v["cc"]: k for k, v in _CC_PARAM_DEFS.items()}
CHANNEL_TO_TRACK: dict[int, str] = {v: k for k, v in TRACK_CHANNELS.items()}

# Keep a short-lived history of outbound CC messages so the MIDI input listener
# can suppress device echoes without mutating global state.
_OUTBOUND_CC_ECHO_WINDOW_SEC = 0.35
_outbound_cc_echoes: dict[tuple[int, int, int], deque[float]] = defaultdict(deque)
_outbound_cc_lock = threading.Lock()


def _prune_outbound_cc_echoes_locked(now: float) -> None:
    cutoff = now - _OUTBOUND_CC_ECHO_WINDOW_SEC
    stale_keys: list[tuple[int, int, int]] = []
    for key, sent_times in _outbound_cc_echoes.items():
        while sent_times and sent_times[0] < cutoff:
            sent_times.popleft()
        if not sent_times:
            stale_keys.append(key)
    for key in stale_keys:
        _outbound_cc_echoes.pop(key, None)


def mark_outbound_cc(channel: int, cc_num: int, value: int) -> None:
    now = time.monotonic()
    with _outbound_cc_lock:
        _prune_outbound_cc_echoes_locked(now)
        _outbound_cc_echoes[(channel, cc_num, value)].append(now)


def consume_recent_outbound_cc_echo(channel: int, cc_num: int, value: int) -> bool:
    now = time.monotonic()
    key = (channel, cc_num, value)
    with _outbound_cc_lock:
        _prune_outbound_cc_echoes_locked(now)
        sent_times = _outbound_cc_echoes.get(key)
        if not sent_times:
            return False
        sent_times.popleft()
        if not sent_times:
            _outbound_cc_echoes.pop(key, None)
        return True


def _reset_outbound_cc_echo_tracker_for_tests() -> None:
    with _outbound_cc_lock:
        _outbound_cc_echoes.clear()


def list_ports() -> list[str]:
    return mido.get_output_names()


def list_input_ports() -> list[str]:
    return mido.get_input_names()


def find_digitakt(ports: list[str]) -> str | None:
    for port in ports:
        if "Digitakt" in port:
            return port
    return None


def find_digitakt_input(ports: list[str]) -> str | None:
    for port in ports:
        if "Digitakt" in port:
            return port
    return None


def open_port(name: str):
    return mido.open_output(name)


def open_input_port(name: str):
    return mido.open_input(name)


def send_cc(port, channel: int, cc_num: int, value: int) -> None:
    port.send(mido.Message("control_change", channel=channel, control=cc_num, value=value))
    mark_outbound_cc(channel=channel, cc_num=cc_num, value=value)


def send_note(port, note: int, velocity: int, channel: int = 0) -> None:
    if velocity <= 0:
        return
    port.send(mido.Message("note_on", note=note, velocity=velocity, channel=channel))


def send_note_off(port, note: int, channel: int = 0) -> None:
    port.send(mido.Message("note_on", note=note, velocity=0, channel=channel))


def send_clock(port) -> None:
    port.send(mido.Message("clock"))


def send_start(port) -> None:
    port.send(mido.Message("start"))


def send_stop(port) -> None:
    port.send(mido.Message("stop"))
