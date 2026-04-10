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
from cli.commands import (
    apply_prob_step,
    apply_vel_step,
    apply_swing,
    apply_random_velocity,
    apply_random_prob,
    parse_random_range,
)


class PatternPanel(Static):
    DEFAULT_CSS = """
    PatternPanel {
        border: solid $primary;
        padding: 0 1;
        height: 100%;
    }
    """

    def render_pattern(self, pattern: dict, track_muted: dict | None = None) -> None:
        self.update(_ascii_grid(pattern, track_muted))


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

    BINDINGS = [("ctrl+c", "quit_app", "Quit"), ("ctrl+q", "quit_app", "Quit")]

    def action_quit_app(self) -> None:
        self._player.stop()
        self.exit()

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
            yield PatternPanel(_ascii_grid(self._state.current_pattern, self._state.track_muted), id="pattern-panel")
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
        self._bus.subscribe("mute_changed", self._on_mute_changed)

        self._slash_handlers = {
            "play":   self._cmd_play,
            "stop":   self._cmd_stop,
            "bpm":    self._cmd_bpm,
            "save":   self._cmd_save,
            "load":   self._cmd_load,
            "cc":     self._cmd_cc,
            "help":   self._cmd_help,
            "quit":   self._cmd_quit,
            "q":      self._cmd_quit,
            "mute":   self._cmd_mute,
            "prob":   self._cmd_prob,
            "swing":  self._cmd_swing,
            "vel":    self._cmd_vel,
            "random": self._cmd_random,
        }

        log = self.query_one("#event-log", RichLog)
        log.write("Ready. Type /help for commands. Bare text → Claude prompt.")

    def on_unmount(self) -> None:
        self._player.stop()

    def _cft(self, fn, *args) -> None:
        """call_from_thread, safe to call from the main thread during shutdown."""
        try:
            self.call_from_thread(fn, *args)
        except RuntimeError:
            pass  # app is shutting down; no UI to update

    # ── EventBus callbacks (called from worker threads) ────────────────────

    def _on_generation_started(self, p: dict) -> None:
        self._cft(self._log, f"[yellow]generating:[/yellow] {p['prompt']}...")

    def _on_generation_complete(self, p: dict) -> None:
        self._cft(self._log, f"[green]pattern ready:[/green] {p['prompt']}")
        self._cft(self._refresh_pattern)
        if p.get("bpm") is not None:
            self._cft(self._player.set_bpm, p["bpm"])

    def _on_generation_failed(self, p: dict) -> None:
        self._cft(self._log, f"[red]generation failed:[/red] {p['error']}")

    def _on_pattern_changed(self, _p: dict) -> None:
        self._cft(self._refresh_pattern)
        self._cft(self._refresh_header)

    def _on_bpm_changed(self, _p: dict) -> None:
        self._cft(self._refresh_header)

    def _on_playback_started(self, _p: dict) -> None:
        self._cft(self._refresh_header)

    def _on_playback_stopped(self, _p: dict) -> None:
        self._cft(self._refresh_header)

    def _on_midi_disconnected(self, p: dict) -> None:
        self._cft(self._log, f"[red]MIDI disconnected:[/red] {p.get('port')}. Reconnecting...")

    def _on_cc_changed(self, _p: dict) -> None:
        self._cft(self._refresh_cc)

    def _on_mute_changed(self, _p: dict) -> None:
        self._cft(self._refresh_pattern)

    # ── UI helpers (called on main thread) ────────────────────────────────

    def _log(self, msg: str) -> None:
        self.query_one("#event-log", RichLog).write(msg)

    def _refresh_pattern(self) -> None:
        self.query_one("#pattern-panel", PatternPanel).render_pattern(self._state.current_pattern, self._state.track_muted)

    def _refresh_cc(self) -> None:
        self.query_one("#cc-panel", CcPanel).render_cc(self._state.track_cc)

    def _refresh_header(self) -> None:
        self.query_one("#header-bar", Static).update(self._header_text())

    def _header_text(self) -> str:
        state = self._state
        playback = "▶ PLAYING" if state.is_playing else "■ STOPPED"
        port = state.midi_port_name or "no MIDI"
        swing = state.current_pattern.get("swing", 0)
        swing_str = f"   swing:{swing}" if swing else ""
        return f"  digitakt-llm   ● {state.bpm:.0f} BPM   {playback}   [{port}]{swing_str}"

    # ── Input handler ──────────────────────────────────────────────────────

    def on_input_submitted(self, event: Input.Submitted) -> None:
        line = event.value.strip()
        event.input.value = ""
        if not line:
            return
        if line.startswith("/"):
            self._handle_slash(line[1:])
        else:
            self._handle_bare(line)

    def _handle_slash(self, line: str) -> None:
        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        args = parts[1] if len(parts) > 1 else ""
        handler = self._slash_handlers.get(cmd)
        if handler is None:
            self._log(f"[red]Unknown command:[/red] /{cmd}. Type /help for commands.")
            return
        handler(args)

    def _handle_bare(self, line: str) -> None:
        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "bpm" and arg:
            self._cmd_bpm(arg)

        elif cmd == "stop":
            self._cmd_stop("")

        elif cmd == "play":
            self._cmd_play("")

        elif cmd == "save" and arg:
            self._cmd_save(arg)

        elif cmd == "load" and arg:
            self._cmd_load(arg)

        elif cmd == "cc":
            self._cmd_cc(arg)

        else:
            variation = self._state.last_prompt is not None
            self._generator.generate(line, variation=variation)

    # ── Slash command handlers ─────────────────────────────────────────────

    def _cmd_play(self, args: str) -> None:
        self._player.start()
        self._log("Playing.")

    def _cmd_stop(self, args: str) -> None:
        self._player.stop()
        self._log("Stopped.")

    def _cmd_bpm(self, args: str) -> None:
        if not args:
            self._log("Usage: /bpm <number>")
            return
        try:
            self._player.set_bpm(float(args))
            self._log(f"BPM set to {args}")
        except ValueError:
            self._log("Usage: /bpm <number>")

    def _cmd_save(self, args: str) -> None:
        if not args:
            self._log("Usage: /save <name>")
            return
        try:
            _PATTERNS_DIR.mkdir(exist_ok=True)
            path = _PATTERNS_DIR / f"{args}.json"
            path.write_text(json.dumps(self._state.current_pattern, indent=2))
            self._log(f"Saved to {path}")
        except OSError as e:
            self._log(f"[red]Save failed:[/red] {e}")

    def _cmd_load(self, args: str) -> None:
        if not args:
            self._log("Usage: /load <name>")
            return
        try:
            path = _PATTERNS_DIR / f"{args}.json"
            if not path.exists():
                self._log(f"Pattern '{args}' not found.")
                return
            pattern = json.loads(path.read_text())
            self._player.queue_pattern(pattern)
            self._log(f"Queued '{args}' for next loop.")
        except (OSError, json.JSONDecodeError) as e:
            self._log(f"[red]Load failed:[/red] {e}")

    def _cmd_cc(self, args: str) -> None:
        cc_parts = args.split()
        if len(cc_parts) == 3:
            cc_track, cc_param, cc_raw = cc_parts
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
            self._log("Usage: /cc <track> <param> <value>")

    def _cmd_help(self, args: str) -> None:
        self._log("Commands:")
        self._log("  /play             start playback")
        self._log("  /stop             stop playback")
        self._log("  /bpm <n>          set BPM")
        self._log("  /save <name>      save pattern")
        self._log("  /load <name>      load pattern")
        self._log("  /cc <track> <param> <value>   send CC (0–127)")
        self._log("  /mute <track>     toggle mute")
        self._log("  /prob <track> <step> <value>  set step probability (step is 1-indexed)")
        self._log("  /swing <n>        set swing 0–100")
        self._log("  /vel <track> <step> <value>   set step velocity (step is 1-indexed)")
        self._log("  /random <track|all> <velocity|prob> [lo-hi]  randomize")
        self._log("  /quit or /q       quit")
        self._log("  Bare text → Claude LLM prompt")

    def _cmd_quit(self, args: str) -> None:
        self._player.stop()
        self.exit()

    def _cmd_mute(self, args: str) -> None:
        track = args.strip()
        if not track:
            self._log("Usage: /mute <track>")
            return
        if track not in TRACK_NAMES:
            self._log(f"Unknown track '{track}'. Tracks: {', '.join(TRACK_NAMES)}")
            return
        self._state.track_muted[track] = not self._state.track_muted.get(track, False)
        muted = self._state.track_muted[track]
        self._bus.emit("mute_changed", {"track": track})
        self._log(f"{'Muted' if muted else 'Unmuted'}: {track}")
        self._refresh_pattern()

    def _cmd_prob(self, args: str) -> None:
        parts = args.split()
        if len(parts) != 3:
            self._log("Usage: /prob <track> <step> <value>  (step is 1-indexed, value 0–100)")
            return
        track, step_str, value_str = parts
        if track not in TRACK_NAMES:
            self._log(f"Unknown track '{track}'. Tracks: {', '.join(TRACK_NAMES)}")
            return
        try:
            step = int(step_str)
            value = int(value_str)
            if not (1 <= step <= 16):
                self._log("Step must be 1–16.")
                return
            if not (0 <= value <= 100):
                self._log("Probability value must be 0–100.")
                return
            new_pattern = apply_prob_step(self._state.current_pattern, track, step - 1, value)
            self._player.queue_pattern(new_pattern)
            self._log(f"Prob set: {track} step {step} = {value}%")
        except ValueError:
            self._log("Usage: /prob <track> <step> <value>  (step is 1-indexed, value 0–100)")

    def _cmd_swing(self, args: str) -> None:
        if not args:
            self._log("Usage: /swing <n>  (0–100)")
            return
        try:
            amount = int(args.strip())
            if not (0 <= amount <= 100):
                self._log("Swing must be 0–100.")
                return
            new_pattern = apply_swing(self._state.current_pattern, amount)
            self._player.queue_pattern(new_pattern)
            self._log(f"Swing set to {amount}")
        except ValueError:
            self._log("Usage: /swing <n>  (0–100)")

    def _cmd_vel(self, args: str) -> None:
        parts = args.split()
        if len(parts) != 3:
            self._log("Usage: /vel <track> <step> <value>  (step is 1-indexed, value 0–127)")
            return
        track, step_str, value_str = parts
        if track not in TRACK_NAMES:
            self._log(f"Unknown track '{track}'. Tracks: {', '.join(TRACK_NAMES)}")
            return
        try:
            step = int(step_str)
            value = int(value_str)
            if not (1 <= step <= 16):
                self._log("Step must be 1–16.")
                return
            if not (0 <= value <= 127):
                self._log("Velocity value must be 0–127.")
                return
            new_pattern = apply_vel_step(self._state.current_pattern, track, step - 1, value)
            self._player.queue_pattern(new_pattern)
            self._log(f"Velocity set: {track} step {step} = {value}")
        except ValueError:
            self._log("Usage: /vel <track> <step> <value>  (step is 1-indexed, value 0–127)")

    def _cmd_random(self, args: str) -> None:
        parts = args.split()
        if len(parts) < 2:
            self._log("Usage: /random <track|all> <velocity|prob> [lo-hi]")
            return
        track_arg = parts[0]
        param = parts[1].lower()
        range_str = parts[2] if len(parts) > 2 else None

        if track_arg != "all" and track_arg not in TRACK_NAMES:
            self._log(f"Unknown track '{track_arg}'. Tracks: {', '.join(TRACK_NAMES)} or 'all'")
            return
        if param not in ("velocity", "prob"):
            self._log("Parameter must be 'velocity' or 'prob'.")
            return

        try:
            lo, hi = parse_random_range(range_str, param)
        except ValueError as e:
            self._log(str(e))
            return

        tracks = list(TRACK_NAMES) if track_arg == "all" else [track_arg]
        if param == "velocity":
            new_pattern = apply_random_velocity(self._state.current_pattern, tracks, lo, hi)
        else:
            new_pattern = apply_random_prob(self._state.current_pattern, tracks, lo, hi)

        self._player.queue_pattern(new_pattern)
        range_desc = f"[{lo}-{hi}]" if range_str else "default range"
        self._log(f"Randomized {param} for {track_arg} ({range_desc})")
