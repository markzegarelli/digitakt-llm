# cli/main.py
from __future__ import annotations

import os
import json
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()

from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
from core import midi_utils
import api.server as server_module


_PATTERNS_DIR = Path("patterns")


def _ascii_grid(pattern: dict, track_muted: dict | None = None) -> str:
    swing = pattern.get("swing", 0)
    swing_str = f"  swing:{swing}" if swing else ""
    beats = f"        1  .  .  . 2  .  .  . 3  .  .  . 4  .  .  .{swing_str}"
    labels = {"kick": "kick", "snare": "snr ", "tom": "tom ", "clap": "clap",
              "bell": "bell", "hihat": "hhat", "openhat": "opht", "cymbal": "cymb"}
    lines = [beats]
    for track in TRACK_NAMES:
        steps = pattern.get(track, [0] * 16)
        prob_steps = pattern.get("prob", {}).get(track)
        mute_prefix = "[M]" if track_muted and track_muted.get(track) else "   "
        cells = ""
        for i in range(16):
            v = steps[i]
            p = (prob_steps[i] if prob_steps else 100)
            if v > 0:
                cell = f"●{p:02d}" if p < 100 else "X  "
            else:
                cell = ".  "
            cells += cell
        lines.append(f"{mute_prefix}{labels[track]} [{cells}]")
    return "\n".join(lines)


def _cc_table(track_cc: dict) -> str:
    params = ["tune", "filter", "resonance", "attack", "decay", "volume", "reverb", "delay"]
    header = f"{'':6}{'tune':>6}{'filter':>8}{'res':>5}{'atk':>5}{'dec':>5}{'vol':>5}{'rev':>5}{'dly':>5}"
    lines = [header]
    for track in TRACK_NAMES:
        row = track_cc.get(track, {})
        vals = [row.get(p, 0) for p in params]
        lines.append(f"{track:<6}" + "".join(f"{v:>6}" for v in vals))
    return "\n".join(lines)



def _select_midi_port() -> str | None:
    ports = midi_utils.list_ports()
    if not ports:
        print("No MIDI output ports found. Continuing without MIDI.")
        return None

    found = midi_utils.find_digitakt(ports)
    if found:
        print(f"Auto-selected: {found}")
        return found

    print("Available MIDI ports:")
    for i, name in enumerate(ports):
        print(f"  {i}: {name}")
    choice = input("Select port number (or Enter to skip): ").strip()
    if not choice:
        return None
    try:
        return ports[int(choice)]
    except (ValueError, IndexError):
        print("Invalid selection. Continuing without MIDI.")
        return None


def _prompt_bpm() -> float:
    raw = input("BPM [120]: ").strip()
    if not raw:
        return 120.0
    try:
        bpm = float(raw)
        if 20.0 <= bpm <= 400.0:
            return bpm
        print("BPM out of range (20–400). Using 120.")
    except ValueError:
        print("Invalid BPM. Using 120.")
    return 120.0



def main() -> None:
    state = AppState()
    bus = EventBus()

    # Wire generator → player: apply new patterns on generation_complete
    def on_generation_complete(payload: dict) -> None:
        player.queue_pattern(payload["pattern"])
        if payload.get("bpm"):
            player.set_bpm(payload["bpm"])
        for cc_track, params in payload.get("cc_changes", {}).items():
            for cc_param, cc_value in params.items():
                if cc_param != "velocity" and port:
                    send_cc(port, TRACK_CHANNELS[cc_track], CC_MAP[cc_param], cc_value)

    # Select MIDI port
    port_name = _select_midi_port()
    port = midi_utils.open_port(port_name) if port_name else None
    state.midi_port_name = port_name

    player = Player(state, bus, port)
    generator = Generator(state, bus)

    bus.subscribe("generation_complete", on_generation_complete)

    # Start FastAPI in background
    api_port = int(os.environ.get("PORT", "8000"))
    server_module.init(state, bus, player, generator)
    server_module.start_background(port=api_port)

    # Load default pattern and start
    bpm = _prompt_bpm()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    player.set_bpm(bpm)

    if port:
        player.start()

    from cli.tui import DigitaktApp
    app = DigitaktApp(player=player, generator=generator, state=state, port=port, bus=bus)
    try:
        app.run()
    except KeyboardInterrupt:
        pass
    finally:
        player.stop()


if __name__ == "__main__":
    main()
