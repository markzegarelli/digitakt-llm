# core/midi_utils.py
from __future__ import annotations

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
