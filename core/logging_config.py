# core/logging_config.py
"""Centralized structured logging for digitakt-llm.

Usage:
    from core.logging_config import get_logger
    logger = get_logger(__name__)

Log output is JSON-lines by default when a log file is configured,
plain text to stderr otherwise. Set DIGITAKT_LOG_FILE env var or
call configure_logging(log_file=...) to enable file logging.
"""
from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone


class JSONFormatter(logging.Formatter):
    """Emit each log record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0] is not None:
            entry["exception"] = self.formatException(record.exc_info)
        # Attach extra structured fields if present
        for key in ("prompt", "raw_response", "error_type", "latency_ms", "status"):
            val = getattr(record, key, None)
            if val is not None:
                entry[key] = val
        return json.dumps(entry, default=str)


_configured = False


def configure_logging(
    log_file: str | None = None,
    level: int = logging.INFO,
) -> None:
    """Set up root logging. Safe to call multiple times (only first call takes effect)."""
    global _configured
    if _configured:
        return
    _configured = True

    root = logging.getLogger("digitakt")
    root.setLevel(level)

    # Always add stderr handler (plain text)
    stderr_handler = logging.StreamHandler(sys.stderr)
    stderr_handler.setFormatter(
        logging.Formatter("%(asctime)s %(levelname)-5s [%(name)s] %(message)s", datefmt="%H:%M:%S")
    )
    root.addHandler(stderr_handler)

    # Optionally add JSON file handler
    file_path = log_file or os.environ.get("DIGITAKT_LOG_FILE")
    if file_path:
        file_handler = logging.FileHandler(file_path, encoding="utf-8")
        file_handler.setFormatter(JSONFormatter())
        root.addHandler(file_handler)


def get_logger(name: str) -> logging.Logger:
    """Return a child logger under the 'digitakt' namespace."""
    configure_logging()  # ensure at least default config
    return logging.getLogger(f"digitakt.{name}")
