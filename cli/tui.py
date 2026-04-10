# cli/tui.py
from __future__ import annotations

import json
from pathlib import Path

from textual.app import App, ComposeResult
from textual.widgets import Header, Footer, Static, RichLog, Input
from textual.containers import Horizontal, Vertical

from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
from core.midi_utils import CC_MAP, TRACK_CHANNELS, send_cc

from cli.main import _ascii_grid, _cc_table, _PATTERNS_DIR


class PatternPanel(Static):
    DEFAULT_CSS = """
    PatternPanel {
        border: solid $primary;
        padding: 0 1;
        height: 100%;
    }
    """

    def render_pattern(self, pattern: dict) -> None:
        self.update(_ascii_grid(pattern))


class CcPanel(Static):
    DEFAULT_CSS = """
    CcPanel {
        border: solid $primary;
        padding: 0 1;
        height: 100%;
    }
    """

    def render_cc(self, track_cc: dict) -> None:
        self.update(_cc_table(track_cc))


class DigitaktApp(App):
    CSS = """
    #top-row {
        height: 1fr;
    }
    #pattern-panel {
        width: 2fr;
    }
    #cc-panel {
        width: 1fr;
    }
    #event-log {
        height: 8;
        border: solid $primary;
    }
    #cmd-input {
        dock: bottom;
    }
    """

    TITLE = "digitakt-llm"

    def __init__(
        self,
        player: Player,
        generator: Generator,
        state: AppState,
        port,
        bus: EventBus,
    ) -> None:
        super().__init__()
        self._player = player
        self._generator = generator
        self._state = state
        self._port = port
        self._bus = bus

    def compose(self) -> ComposeResult:
        yield Static(self._header_text(), id="header-bar")
        with Horizontal(id="top-row"):
            yield PatternPanel(_ascii_grid(self._state.current_pattern), id="pattern-panel")
            yield CcPanel(_cc_table(self._state.track_cc), id="cc-panel")
        yield RichLog(id="event-log", markup=True)
        yield Input(placeholder="> ", id="cmd-input")

    def on_mount(self) -> None:
        self._bus.subscribe("generation_started", self._on_generation_started)
        self._bus.subscribe("generation_complete", self._on_generation_complete)
        self._bus.subscribe("generation_failed", self._on_generation_failed)
        self._bus.subscribe("pattern_changed", self._on_pattern_changed)
        self._bus.subscribe("bpm_changed", self._on_bpm_changed)
        self._bus.subscribe("playback_started", self._on_playback_started)
        self._bus.subscribe("playback_stopped", self._on_playback_stopped)
        self._bus.subscribe("midi_disconnected", self._on_midi_disconnected)
        self._bus.subscribe("cc_changed", self._on_cc_changed)

        log = self.query_one("#event-log", RichLog)
        log.write("Ready. Commands: bpm <n>, stop, play, save <name>, load <name>")
        log.write("  cc <track> <param> <value>  |  Anything else → Claude prompt")

    # ── EventBus callbacks (called from worker threads) ────────────────────

    def _on_generation_started(self, p: dict) -> None:
        self.call_from_thread(self._log, f"[yellow]generating:[/yellow] {p['prompt']}...")

    def _on_generation_complete(self, p: dict) -> None:
        self.call_from_thread(self._log, f"[green]pattern ready:[/green] {p['prompt']}")
        self.call_from_thread(self._refresh_pattern)

    def _on_generation_failed(self, p: dict) -> None:
        self.call_from_thread(self._log, f"[red]generation failed:[/red] {p['error']}")

    def _on_pattern_changed(self, _p: dict) -> None:
        self.call_from_thread(self._refresh_pattern)
        self.call_from_thread(self._refresh_header)

    def _on_bpm_changed(self, _p: dict) -> None:
        self.call_from_thread(self._refresh_header)

    def _on_playback_started(self, _p: dict) -> None:
        self.call_from_thread(self._refresh_header)

    def _on_playback_stopped(self, _p: dict) -> None:
        self.call_from_thread(self._refresh_header)

    def _on_midi_disconnected(self, p: dict) -> None:
        self.call_from_thread(self._log, f"[red]MIDI disconnected:[/red] {p.get('port')}. Reconnecting...")

    def _on_cc_changed(self, _p: dict) -> None:
        self.call_from_thread(self._refresh_cc)

    # ── UI helpers (called on main thread) ────────────────────────────────

    def _log(self, msg: str) -> None:
        self.query_one("#event-log", RichLog).write(msg)

    def _refresh_pattern(self) -> None:
        self.query_one("#pattern-panel", PatternPanel).render_pattern(self._state.current_pattern)

    def _refresh_cc(self) -> None:
        self.query_one("#cc-panel", CcPanel).render_cc(self._state.track_cc)

    def _refresh_header(self) -> None:
        self.query_one("#header-bar", Static).update(self._header_text())

    def _header_text(self) -> str:
        state = self._state
        playback = "▶ PLAYING" if state.is_playing else "■ STOPPED"
        port = state.midi_port_name or "no MIDI"
        return f"  digitakt-llm   ● {state.bpm:.0f} BPM   {playback}   [{port}]"

    # ── Input handler ──────────────────────────────────────────────────────

    def on_input_submitted(self, event: Input.Submitted) -> None:
        line = event.value.strip()
        event.input.value = ""
        if not line:
            return

        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "bpm" and arg:
            try:
                self._player.set_bpm(float(arg))
                self._log(f"BPM set to {arg}")
            except ValueError:
                self._log("Usage: bpm <number>")

        elif cmd == "stop":
            self._player.stop()
            self._log("Stopped.")

        elif cmd == "play":
            self._player.start()
            self._log("Playing.")

        elif cmd == "save" and arg:
            _PATTERNS_DIR.mkdir(exist_ok=True)
            path = _PATTERNS_DIR / f"{arg}.json"
            path.write_text(json.dumps(self._state.current_pattern, indent=2))
            self._log(f"Saved to {path}")

        elif cmd == "load" and arg:
            path = _PATTERNS_DIR / f"{arg}.json"
            if not path.exists():
                self._log(f"Pattern '{arg}' not found.")
            else:
                pattern = json.loads(path.read_text())
                self._player.queue_pattern(pattern)
                self._log(f"Queued '{arg}' for next loop.")

        elif cmd == "cc":
            cc_parts = line.split()
            if len(cc_parts) == 4:
                _, cc_track, cc_param, cc_raw = cc_parts
                if cc_track not in TRACK_NAMES:
                    self._log(f"Unknown track '{cc_track}'. Tracks: {', '.join(TRACK_NAMES)}")
                elif cc_param not in CC_MAP:
                    self._log(f"Unknown param '{cc_param}'. Params: {', '.join(CC_MAP)}")
                else:
                    try:
                        cc_value = int(cc_raw)
                        if not (0 <= cc_value <= 127):
                            raise ValueError
                        self._state.update_cc(cc_track, cc_param, cc_value)
                        if self._port:
                            send_cc(self._port, TRACK_CHANNELS[cc_track], CC_MAP[cc_param], cc_value)
                        self._log(f"CC set: {cc_track} {cc_param} = {cc_value}")
                    except ValueError:
                        self._log("Value must be an integer 0–127.")
            else:
                self._log("Usage: cc <track> <param> <value>")

        else:
            variation = self._state.last_prompt is not None
            self._generator.generate(line, variation=variation)
