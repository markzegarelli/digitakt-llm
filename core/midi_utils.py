# core/midi_utils.py
from __future__ import annotations

import mido

NOTE_MAP: dict[str, int] = {
    "kick":    36,
    "snare":   37,
    "tom":     38,
    "clap":    39,
    "bell":    40,
    "hihat":   41,
    "openhat": 42,
    "cymbal":  43,
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

CC_MAP: dict[str, int] = {
    "tune":      16,   # Source tune
    "filter":    74,   # Filter frequency
    "resonance": 75,   # Filter resonance
    "attack":    78,   # Amp attack time
    "decay":     80,   # Amp decay time
    "volume":     7,   # Amp volume
    "reverb":    83,   # Amp reverb send
    "delay":     82,   # Amp delay send
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
