from __future__ import annotations

import random
import time
import threading
from core.state import AppState, DEFAULT_GATE_PCT, TRACK_NAMES
from core.events import EventBus
from core.logging_config import get_logger
from core import midi_utils
from core.midi_utils import TRACK_CHANNELS, send_note_off

logger = get_logger("player")


class Player:
    def __init__(self, state: AppState, bus: EventBus, port) -> None:
        self.state = state
        self.bus = bus
        self.port = port
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._loop_count: int = 0

    def start(self) -> bool:
        if self._thread and self._thread.is_alive():
            return True
        if self.port is not None:
            midi_utils.send_start(self.port)
            # Flush all stored CC values so the Digitakt syncs immediately
            for track, params in self.state.track_cc.items():
                channel = TRACK_CHANNELS[track]
                for param, value in params.items():
                    if param in midi_utils.CC_MAP:
                        midi_utils.send_cc(self.port, channel, midi_utils.CC_MAP[param], value)
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self.state.set_playing(True)
        self.bus.emit("playback_started", {})
        return True

    def stop(self) -> None:
        self._stop_event.set()
        self.state.set_playing(False)
        if self.port is not None:
            midi_utils.send_stop(self.port)
        self.bus.emit("playback_stopped", {})

    def set_bpm(self, bpm: float) -> None:
        self.state.set_bpm(bpm)
        self.bus.emit("bpm_changed", {"bpm": bpm})

    def queue_pattern(self, pattern: dict) -> None:
        self.state.queue_pattern(pattern)

    def _step_duration(self) -> float:
        return 60.0 / self.state.bpm / 4.0

    def _tick_duration(self) -> float:
        return 60.0 / self.state.bpm / 24.0

    def _swing_delay(self) -> float:
        """Return swing timing delay in seconds for odd steps.

        swing=0 → 0s delay. swing=100 → step_duration/3 delay.
        Applied only to odd-indexed steps (1, 3, 5, ...) in the caller.
        """
        swing = self.state.current_pattern.get("swing", 0)
        if not swing:
            return 0.0
        return (swing / 100.0) * self._step_duration() / 3.0

    def _play_step(self, step: int, dirty_cc: set | None = None) -> None:
        if dirty_cc is None:
            dirty_cc = set()
        self.bus.emit("step_changed", {"step": step})
        pattern = self.state.current_pattern
        for track in TRACK_NAMES:
            note = self.state.track_pitch.get(track, midi_utils.NOTE_MAP.get(track, 60))
            if note is None or track not in pattern:
                continue
            if self.state.track_muted.get(track, False):
                continue
            # Check per-step probability
            prob_track = pattern.get("prob", {}).get(track)
            if prob_track is not None:
                step_prob = prob_track[step]
                if random.random() * 100 >= step_prob:
                    continue
            # Check conditional trig
            cond_track = pattern.get("cond", {}).get(track)
            if cond_track is not None:
                cond = cond_track[step]
                if cond == "1:2" and self._loop_count % 2 != 0:
                    continue
                elif cond == "not:2" and self._loop_count % 2 == 0:
                    continue
                elif cond == "fill" and not self.state.is_fill_active():
                    continue
            velocity = pattern[track][step]
            if velocity > 0:
                scale = self.state.track_velocity.get(track, 127)
                velocity = max(1, (velocity * scale) // 127)
                if self.port is not None:
                    try:
                        midi_utils.send_note(self.port, note, velocity, channel=TRACK_CHANNELS[track])
                    except Exception:
                        logger.error(
                            "MIDI send failed during note playback",
                            extra={"error_type": "midi_disconnect"},
                            exc_info=True,
                        )
                        self.state.set_playing(False)
                        self.bus.emit("playback_stopped", {})
                        self.bus.emit(
                            "midi_disconnected",
                            {"port": self.state.midi_port_name},
                        )
                        self._stop_event.set()
                        return
                    # Schedule note_off if gate < 100
                    gate_track = pattern.get("gate", {}).get(track)
                    gate_pct = gate_track[step] if gate_track is not None else DEFAULT_GATE_PCT
                    if gate_pct < 100:
                        note_off_delay = max(0.001, gate_pct / 100.0 * self._step_duration())
                        port_ref = self.port
                        note_ref = note
                        ch_ref = TRACK_CHANNELS[track]
                        def _send_off(p=port_ref, n=note_ref, ch=ch_ref):
                            try:
                                send_note_off(p, n, channel=ch)
                            except Exception:
                                pass
                        threading.Timer(note_off_delay, _send_off).start()
        # Send per-step CC overrides
        step_cc = pattern.get("step_cc", {})
        for track in TRACK_NAMES:
            channel = TRACK_CHANNELS[track]
            for param, steps in step_cc.get(track, {}).items():
                override = steps[step]
                if override is not None and param in midi_utils.CC_MAP:
                    dirty_cc.add((track, param))
                    if self.port is not None:
                        try:
                            midi_utils.send_cc(self.port, channel, midi_utils.CC_MAP[param], override)
                        except Exception:
                            logger.error(
                                "MIDI send failed during CC override",
                                extra={"error_type": "midi_disconnect"},
                                exc_info=True,
                            )
                            self.state.set_playing(False)
                            self.bus.emit("playback_stopped", {})
                            self.bus.emit(
                                "midi_disconnected",
                                {"port": self.state.midi_port_name},
                            )
                            self._stop_event.set()
                            return

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            dirty_cc: set[tuple[str, str]] = set()
            next_tick = time.perf_counter()
            for step in range(self.state.pattern_length):
                if self._stop_event.is_set():
                    break
                for tick in range(6):
                    if self._stop_event.is_set():
                        break
                    if tick == 0:
                        if step % 2 == 1:
                            swing_delay = self._swing_delay()
                            if swing_delay > 0:
                                self._stop_event.wait(swing_delay)
                        self._play_step(step, dirty_cc)
                    if self._stop_event.is_set():
                        break
                    if self.port is not None:
                        try:
                            midi_utils.send_clock(self.port)
                        except Exception:
                            logger.error(
                                "MIDI clock send failed",
                                extra={"error_type": "midi_disconnect"},
                                exc_info=True,
                            )
                            self.state.set_playing(False)
                            self.bus.emit("playback_stopped", {})
                            self.bus.emit(
                                "midi_disconnected",
                                {"port": self.state.midi_port_name},
                            )
                            self._stop_event.set()
                            return
                    next_tick += self._tick_duration()
                    sleep_time = next_tick - time.perf_counter()
                    if sleep_time > 0:
                        self._stop_event.wait(sleep_time)

            # Restore global CC for any params overridden during this loop
            if self.port is not None:
                for track, param in dirty_cc:
                    global_val = self.state.track_cc.get(track, {}).get(param)
                    if global_val is not None and param in midi_utils.CC_MAP:
                        midi_utils.send_cc(
                            self.port, TRACK_CHANNELS[track], midi_utils.CC_MAP[param], global_val
                        )

            boundary = self.state.apply_bar_boundary()
            mute_changes = boundary.get("mute_changes")
            if mute_changes:
                for track, muted in mute_changes.items():
                    self.bus.emit("mute_changed", {"track": track, "muted": muted})

            chain_armed = boundary.get("chain_armed")
            if chain_armed:
                self.bus.emit("chain_armed", chain_armed)

            if boundary.get("pattern_changed"):
                self.bus.emit(
                    "pattern_changed",
                    {"pattern": boundary["current_pattern"], "prompt": self.state.last_prompt or ""},
                )

            chain_advanced = boundary.get("chain_advanced")
            if chain_advanced:
                self.bus.emit("chain_advanced", chain_advanced)

            fill_event = boundary.get("fill_event")
            if fill_event in {"fill_started", "fill_ended"}:
                self.bus.emit(fill_event, {"pattern": boundary["current_pattern"]})

            self._loop_count += 1
