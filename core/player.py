from __future__ import annotations

import random
import time
import threading
from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core import midi_utils
from core.midi_utils import TRACK_CHANNELS


class Player:
    def __init__(self, state: AppState, bus: EventBus, port) -> None:
        self.state = state
        self.bus = bus
        self.port = port
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        if self.port is None:
            return
        midi_utils.send_start(self.port)
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self.state.is_playing = True
        self.bus.emit("playback_started", {})

    def stop(self) -> None:
        self._stop_event.set()
        self.state.is_playing = False
        if self.port is not None:
            midi_utils.send_stop(self.port)
        self.bus.emit("playback_stopped", {})

    def set_bpm(self, bpm: float) -> None:
        self.state.bpm = bpm
        self.bus.emit("bpm_changed", {"bpm": bpm})

    def queue_pattern(self, pattern: dict) -> None:
        self.state.pending_pattern = pattern

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

    def _play_step(self, step: int) -> None:
        pattern = self.state.current_pattern
        for track in TRACK_NAMES:
            note = midi_utils.NOTE_MAP.get(track)
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
            velocity = pattern[track][step]
            if velocity > 0:
                scale = self.state.track_velocity.get(track, 127)
                velocity = max(1, (velocity * scale) // 127)
                try:
                    midi_utils.send_note(self.port, note, velocity, channel=TRACK_CHANNELS[track])
                except Exception:
                    self.bus.emit(
                        "midi_disconnected",
                        {"port": self.state.midi_port_name},
                    )
                    self._stop_event.set()
                    return

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            next_tick = time.perf_counter()
            for step in range(16):
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
                        self._play_step(step)
                    if self._stop_event.is_set():
                        break
                    try:
                        midi_utils.send_clock(self.port)
                    except Exception:
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

            # End of loop: atomic pattern swap
            if self.state.pending_pattern is not None:
                self.state.current_pattern = self.state.pending_pattern
                self.state.pending_pattern = None
                self.bus.emit(
                    "pattern_changed",
                    {
                        "pattern": self.state.current_pattern,
                        "prompt": self.state.last_prompt or "",
                    },
                )
