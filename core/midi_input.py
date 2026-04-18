from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING

from core.logging_config import get_logger
from core.midi_utils import CC_NUMBER_TO_PARAM, CHANNEL_TO_TRACK

if TYPE_CHECKING:
    from core.state import AppState
    from core.events import EventBus

logger = get_logger("midi_input")

_POLL_INTERVAL = 0.005   # 5 ms between port polls
_EMIT_INTERVAL = 0.080   # 80 ms min between WebSocket broadcasts per parameter (~12/sec max)


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
        self._last_emit: dict[tuple[str, str], float] = {}   # (track, param) → last broadcast time
        self._pending: dict[tuple[str, str], dict] = {}       # (track, param) → payload to flush

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
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        if self._port is not None:
            try:
                self._port.close()
            except Exception:
                pass
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
                self._flush_pending()
                self._stop_event.wait(_POLL_INTERVAL)

    def _handle(self, msg) -> None:
        if msg.type != "control_change":
            return

        track = CHANNEL_TO_TRACK.get(msg.channel)
        if track is None:
            # Auto channel: apply to whichever track the CC panel has focused
            track = self._state.get_cc_focused_track()
            logger.debug(
                "MIDI CC on auto channel ch=%d → applying to focused track '%s' CC#%d val=%d",
                msg.channel, track, msg.control, msg.value,
            )

        param = CC_NUMBER_TO_PARAM.get(msg.control)
        if param is None:
            logger.debug(
                "MIDI CC with unmapped number (ignored) — ch=%d CC#%d val=%d",
                msg.channel, msg.control, msg.value,
            )
            return

        # Suppress echo: if state already holds this value, it was set by the app
        if self._state.get_cc(track, param) == msg.value:
            return

        self._state.update_cc(track, param, msg.value)

        # Throttle WebSocket broadcasts to avoid flooding the TUI with redraws.
        # Suppressed messages are kept as pending and flushed when the port goes quiet.
        now = time.monotonic()
        key = (track, param)
        payload = {"track": track, "param": param, "value": msg.value, "source": "hardware"}
        if now - self._last_emit.get(key, 0.0) >= _EMIT_INTERVAL:
            self._last_emit[key] = now
            self._pending.pop(key, None)
            self._bus.emit("cc_changed", payload)
            logger.debug("hardware CC → %s/%s = %d", track, param, msg.value)
        else:
            self._pending[key] = payload

    def _flush_pending(self) -> None:
        """Emit any throttled CC values that haven't been broadcast yet."""
        if not self._pending:
            return
        now = time.monotonic()
        for key, payload in list(self._pending.items()):
            if now - self._last_emit.get(key, 0.0) >= _EMIT_INTERVAL:
                self._last_emit[key] = now
                del self._pending[key]
                self._bus.emit("cc_changed", payload)
                logger.debug("hardware CC (flush) → %s/%s = %d", payload["track"], payload["param"], payload["value"])
