import threading
from collections import defaultdict
from typing import Callable


class EventBus:
    def __init__(self) -> None:
        self._subscribers: dict[str, list[Callable]] = defaultdict(list)
        self._lock = threading.Lock()

    def subscribe(self, event: str, callback: Callable) -> None:
        with self._lock:
            self._subscribers[event].append(callback)

    def emit(self, event: str, payload: dict | None = None) -> None:
        payload = payload or {}
        with self._lock:
            callbacks = list(self._subscribers[event])
        for callback in callbacks:
            callback(payload)
