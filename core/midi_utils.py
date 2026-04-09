# core/midi_utils.py
from __future__ import annotations

import mido

NOTE_MAP: dict[str, int] = {
    "kick":  36,
    "snare": 37,
    "hihat": 38,
    "clap":  39,
    "perc1": 40,
    "perc2": 41,
    "perc3": 42,
    "perc4": 43,
}

# Maps app track name → 0-indexed MIDI channel (Digitakt: ch 1–8)
TRACK_CHANNELS: dict[str, int] = {
    "kick":  0,  # KICK
    "snare": 1,  # SNARE
    "hihat": 2,  # TOM
    "clap":  3,  # CLAP
    "perc1": 4,  # COWBELL
    "perc2": 5,  # CLOSED HAT
    "perc3": 6,  # OPEN HAT
    "perc4": 7,  # CYMBAL
}

CC_MAP: dict[str, int] = {
    "tune":      16,
    "filter":    74,
    "resonance": 71,
    "attack":    80,
    "decay":     82,
    "volume":    95,
    "reverb":    91,
    "delay":     30,
}


def list_ports() -> list[str]:
    return mido.get_output_names()


def find_digitakt(ports: list[str]) -> str | None:
    for port in ports:
        if "Digitakt" in port:
            return port
    return None


def open_port(name: str):
    return mido.open_output(name)


def send_cc(port, channel: int, cc_num: int, value: int) -> None:
    port.send(mido.Message("control_change", channel=channel, control=cc_num, value=value))


def send_note(port, note: int, velocity: int, channel: int = 0) -> None:
    if velocity <= 0:
        return
    port.send(mido.Message("note_on", note=note, velocity=velocity, channel=channel))
    port.send(mido.Message("note_off", note=note, velocity=0, channel=channel))
