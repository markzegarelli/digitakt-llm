# core/tracing.py
"""Local structured prompt tracing for observability.

Records each LLM interaction as a structured trace entry.
Traces are stored in-memory and optionally written to a JSON-lines file.

Usage:
    from core.tracing import tracer

    with tracer.span("generate", prompt="deep techno") as span:
        result = call_api(...)
        span.set_response(result)
        span.set_status("ok")
"""
from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


@dataclass
class TraceSpan:
    """A single traced LLM interaction."""
    operation: str
    prompt: str = ""
    response: str = ""
    status: str = "pending"
    error: str | None = None
    start_time: float = field(default_factory=time.monotonic)
    end_time: float | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def set_response(self, response: str, max_len: int = 1000) -> None:
        self.response = response[:max_len]

    def set_status(self, status: str) -> None:
        self.status = status

    def set_error(self, error: str) -> None:
        self.status = "error"
        self.error = error

    def finish(self) -> None:
        self.end_time = time.monotonic()

    @property
    def latency_ms(self) -> int:
        if self.end_time is None:
            return 0
        return int((self.end_time - self.start_time) * 1000)

    def to_dict(self) -> dict[str, Any]:
        return {
            "operation": self.operation,
            "prompt": self.prompt[:500],  # truncate for safety
            "response": self.response,
            "status": self.status,
            "error": self.error,
            "latency_ms": self.latency_ms,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "metadata": self.metadata,
        }


class Tracer:
    """In-memory + optional file-backed prompt tracer."""

    def __init__(self, max_traces: int = 200) -> None:
        self._traces: list[dict[str, Any]] = []
        self._max_traces = max_traces
        self._lock = threading.Lock()
        self._file_path: str | None = os.environ.get("DIGITAKT_TRACE_FILE")

    def configure(self, file_path: str | None = None) -> None:
        if file_path:
            self._file_path = file_path

    def span(self, operation: str, **kwargs: Any) -> _SpanContext:
        span = TraceSpan(operation=operation, **kwargs)
        return _SpanContext(span, self)

    def _record(self, span: TraceSpan) -> None:
        entry = span.to_dict()
        with self._lock:
            self._traces.append(entry)
            if len(self._traces) > self._max_traces:
                self._traces = self._traces[-self._max_traces:]
        if self._file_path:
            try:
                with open(self._file_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(entry, default=str) + "\n")
            except OSError:
                pass  # best-effort file write

    @property
    def traces(self) -> list[dict[str, Any]]:
        with self._lock:
            return list(self._traces)

    def clear(self) -> None:
        with self._lock:
            self._traces.clear()


class _SpanContext:
    """Context manager for a trace span."""

    def __init__(self, span: TraceSpan, tracer: Tracer) -> None:
        self._span = span
        self._tracer = tracer

    def __enter__(self) -> TraceSpan:
        return self._span

    def __exit__(self, exc_type: type | None, exc_val: BaseException | None, exc_tb: Any) -> None:
        if exc_type is not None:
            self._span.set_error(f"{exc_type.__name__}: {exc_val}")
        self._span.finish()
        self._tracer._record(self._span)


# Module-level singleton
tracer = Tracer()
