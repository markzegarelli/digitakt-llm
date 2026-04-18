"""Launches the FastAPI backend and Bun TUI together."""
from __future__ import annotations
import os
import socket
import subprocess
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

from dotenv import load_dotenv
load_dotenv()


def _port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(("localhost", port)) == 0


def _start_server(api_port: int) -> None:
    from core.state import AppState, EMPTY_PATTERN, TRACK_NAMES
    from core.events import EventBus
    from core.player import Player
    from core.generator import Generator
    from core import midi_utils
    import api.server as server_module

    state = AppState()
    bus = EventBus()

    port_name = midi_utils.find_digitakt(midi_utils.list_ports())
    port = midi_utils.open_port(port_name) if port_name else None
    state.midi_port_name = port_name

    player = Player(state, bus, port)
    generator = Generator(state, bus)

    def on_gen_complete(p: dict) -> None:
        player.queue_pattern(p["pattern"])
        if p.get("bpm"):
            player.set_bpm(p["bpm"])

    bus.subscribe("generation_complete", on_gen_complete)

    state.current_pattern = {k: list(EMPTY_PATTERN[k]) for k in TRACK_NAMES}
    player.set_bpm(120.0)

    server_module.init(state, bus, player, generator)
    server_module.start_background(port=api_port)

    if port:
        player.start()

    from core.midi_input import MidiInputListener
    import logging as _logging
    input_ports = midi_utils.list_input_ports()
    input_port_name = midi_utils.find_digitakt_input(input_ports)
    if not input_port_name:
        print(f"MIDI input: no Digitakt found. Available ports: {input_ports or '(none)'}")
    else:
        try:
            input_port = midi_utils.open_input_port(input_port_name)
            midi_listener = MidiInputListener(input_port, state, bus)
            midi_listener.start()
            print(f"MIDI input: listening on '{input_port_name}' (hardware→TUI sync enabled)")
        except Exception as e:
            print(f"MIDI input: could not open '{input_port_name}': {e}")


def _wait_for_server(url: str, timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            urllib.request.urlopen(url, timeout=1)
            return True
        except urllib.error.URLError:
            time.sleep(0.2)
    return False


def main() -> None:
    tui_dir = Path(__file__).parent.parent / "tui"
    if not tui_dir.exists():
        print("Error: tui/ directory not found. Run 'bun install' in tui/ first.")
        sys.exit(1)

    api_port = int(os.environ.get("PORT", "8000"))
    url = os.environ.get("DIGITAKT_URL", f"http://localhost:{api_port}")

    if _port_in_use(api_port):
        print(
            f"Error: port {api_port} is already in use. "
            "Stop the existing process manually and retry."
        )
        sys.exit(1)

    _start_server(api_port)

    if not _wait_for_server(f"http://localhost:{api_port}/state"):
        print(f"Error: API server did not start on port {api_port}. Check for errors above.")
        sys.exit(1)

    print(f"API server ready at http://localhost:{api_port}")

    result = subprocess.run(
        ["bun", "run", "src/index.tsx"],
        cwd=str(tui_dir),
        env={**os.environ, "DIGITAKT_URL": url},
    )
    sys.exit(result.returncode)
