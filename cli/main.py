# cli/main.py
from __future__ import annotations

import os
import sys
import json
import threading
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


def _ascii_grid(pattern: dict) -> str:
    beats = "     1 . . . 2 . . . 3 . . . 4 . . ."
    labels = {"kick": "kick", "snare": "snr ", "hihat": "hhat", "clap": "clap",
              "perc1": "prc1", "perc2": "prc2", "perc3": "prc3", "perc4": "prc4"}
    lines = [beats]
    for track in TRACK_NAMES:
        steps = pattern.get(track, [0] * 16)
        cells = " ".join("X" if v > 0 else "." for v in steps)
        lines.append(f"{labels[track]} [{cells}]")
    return "\n".join(lines)


def _subscribe_cli_events(bus: EventBus) -> None:
    def on_generation_started(p):
        print(f"\n[generating: {p['prompt']}...]")

    def on_generation_complete(p):
        print(f"\n[pattern ready: {p['prompt']}]")

    def on_generation_failed(p):
        print(f"\n[generation failed: {p['error']}]")

    def on_midi_disconnected(p):
        print(f"\n[MIDI disconnected: {p.get('port')}. Reconnecting...]")

    bus.subscribe("generation_started", on_generation_started)
    bus.subscribe("generation_complete", on_generation_complete)
    bus.subscribe("generation_failed", on_generation_failed)
    bus.subscribe("midi_disconnected", on_midi_disconnected)


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


def _run_repl(player: Player, generator: Generator, state: AppState) -> None:
    print("\nReady. Commands: bpm <n>, stop, play, show, save <name>, load <name>")
    print("Anything else is sent to Claude as a pattern prompt.\n")

    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            player.stop()
            sys.exit(0)

        if not line:
            continue

        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "bpm" and arg:
            try:
                player.set_bpm(float(arg))
                print(f"BPM set to {arg}")
            except ValueError:
                print("Usage: bpm <number>")

        elif cmd == "stop":
            player.stop()
            print("Stopped.")

        elif cmd == "play":
            player.start()
            print("Playing.")

        elif cmd == "show":
            print(_ascii_grid(state.current_pattern))

        elif cmd == "save" and arg:
            _PATTERNS_DIR.mkdir(exist_ok=True)
            path = _PATTERNS_DIR / f"{arg}.json"
            path.write_text(json.dumps(state.current_pattern, indent=2))
            print(f"Saved to {path}")

        elif cmd == "load" and arg:
            path = _PATTERNS_DIR / f"{arg}.json"
            if not path.exists():
                print(f"Pattern '{arg}' not found.")
            else:
                pattern = json.loads(path.read_text())
                player.queue_pattern(pattern)
                print(f"Queued '{arg}' for next loop.")

        else:
            # Everything else → send to generator
            variation = state.last_prompt is not None
            generator.generate(line, variation=variation)


def main() -> None:
    state = AppState()
    bus = EventBus()

    # Wire generator → player: apply new patterns on generation_complete
    def on_generation_complete(payload: dict) -> None:
        player.queue_pattern(payload["pattern"])

    # Select MIDI port
    port_name = _select_midi_port()
    port = midi_utils.open_port(port_name) if port_name else None
    state.midi_port_name = port_name

    player = Player(state, bus, port)
    generator = Generator(state, bus)

    bus.subscribe("generation_complete", on_generation_complete)
    _subscribe_cli_events(bus)

    # Start FastAPI in background
    api_port = int(os.environ.get("PORT", "8000"))
    server_module.init(state, bus, player, generator)
    server_module.start_background(port=api_port)
    print(f"API server started at http://localhost:{api_port}")

    # Load default pattern and start
    bpm = _prompt_bpm()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    player.set_bpm(bpm)

    if port:
        player.start()
        print(f"Playing at {bpm} BPM.")
    else:
        print("No MIDI port — playback disabled. Generate patterns to preview in 'show'.")

    _run_repl(player, generator, state)


if __name__ == "__main__":
    main()
