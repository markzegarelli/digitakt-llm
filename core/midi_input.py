from __future__ import annotations

import threading
from typing import TYPE_CHECKING

from core.logging_config import get_logger
from core.midi_utils import CC_NUMBER_TO_PARAM, CHANNEL_TO_TRACK

if TYPE_CHECKING:
    from core.state import AppState
    from core.events import EventBus

logger = get_logger("midi_input")

_POLL_INTERVAL = 0.005  # 5 ms poll — imperceptible latency for knob feedback


class MidiInputListener:
    """Background thread that reads incoming MIDI CC from hardware and
    updates AppState + emits cc_changed events on the EventBus.
    """

    def __init__(self, port, state: AppState, bus: EventBus) -> None:
        self._port = port
        self._state = state
        self._bus = bus
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._loop, name="midi-input-listener", daemon=True
        )
        self._thread.start()
        logger.info("MIDI input listener started")

    def stop(self) -> None:
        self._stop_event.set()
        if self._port is not None:
            try:
                self._port.close()
            except Exception:
                pass
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        logger.info("MIDI input listener stopped")

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            try:
                msg = self._port.poll()
            except Exception:
                logger.error("MIDI input port error — stopping listener", exc_info=True)
                self._stop_event.set()
                break

            if msg is not None:
                self._handle(msg)
            else:
                self._stop_event.wait(_POLL_INTERVAL)

    def _handle(self, msg) -> None:
        if msg.type != "control_change":
            return

        track = CHANNEL_TO_TRACK.get(msg.channel)
        if track is None:
            return

        param = CC_NUMBER_TO_PARAM.get(msg.control)
        if param is None:
            return

        # Suppress echo: if state already holds this value, it was set by the app
        if self._state.track_cc.get(track, {}).get(param) == msg.value:
            return

        self._state.update_cc(track, param, msg.value)
        self._bus.emit("cc_changed", {"track": track, "param": param, "value": msg.value, "source": "hardware"})
        logger.debug("hardware CC received", extra={"track": track, "param": param, "value": msg.value})
