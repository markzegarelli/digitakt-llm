# tests/test_logging.py
"""Tests for crash logging and invalid JSON response logging."""
import json
import logging
import os
import tempfile
from unittest.mock import MagicMock

from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core.generator import Generator
from core.logging_config import JSONFormatter, configure_logging, get_logger


# ── JSONFormatter ──────────────────────────────────────────────────────────

def test_json_formatter_basic():
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test", level=logging.INFO, pathname="", lineno=0,
        msg="hello", args=(), exc_info=None,
    )
    output = formatter.format(record)
    data = json.loads(output)
    assert data["level"] == "INFO"
    assert data["message"] == "hello"
    assert "ts" in data


def test_json_formatter_includes_extras():
    formatter = JSONFormatter()
    record = logging.LogRecord(
        name="test", level=logging.WARNING, pathname="", lineno=0,
        msg="bad json", args=(), exc_info=None,
    )
    record.prompt = "test prompt"
    record.raw_response = "not json at all"
    record.error_type = "json_parse_failed"
    output = formatter.format(record)
    data = json.loads(output)
    assert data["prompt"] == "test prompt"
    assert data["raw_response"] == "not json at all"
    assert data["error_type"] == "json_parse_failed"


def test_json_formatter_includes_exception():
    formatter = JSONFormatter()
    try:
        raise ValueError("boom")
    except ValueError:
        import sys
        record = logging.LogRecord(
            name="test", level=logging.ERROR, pathname="", lineno=0,
            msg="crash", args=(), exc_info=sys.exc_info(),
        )
    output = formatter.format(record)
    data = json.loads(output)
    assert "exception" in data
    assert "ValueError" in data["exception"]


# ── get_logger ─────────────────────────────────────────────────────────────

def test_get_logger_returns_child_of_digitakt():
    log = get_logger("mymodule")
    assert log.name == "digitakt.mymodule"


# ── Generator logging on invalid JSON ─────────────────────────────────────

def _make_mock_client(response_text: str) -> MagicMock:
    client = MagicMock()
    msg = MagicMock()
    msg.content = [MagicMock(text=response_text)]
    client.messages.create.return_value = msg
    return client


def test_invalid_json_logs_warning_with_raw_response(caplog):
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client("this is not valid json")

    with caplog.at_level(logging.WARNING, logger="digitakt.generator"):
        gen._run("test prompt")

    # Should have logged a warning about invalid JSON
    warning_records = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warning_records) >= 1
    rec = warning_records[0]
    assert hasattr(rec, "raw_response")
    assert "this is not valid json" in rec.raw_response


def test_invalid_json_after_retry_logs_error(caplog):
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client("still not json")

    with caplog.at_level(logging.ERROR, logger="digitakt.generator"):
        gen._run("test prompt")

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(error_records) >= 1
    rec = error_records[0]
    assert hasattr(rec, "error_type")
    assert rec.error_type == "json_parse_failed_after_retry"


def test_api_exception_logs_error_with_traceback(caplog):
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = MagicMock()
    gen._client.messages.create.side_effect = Exception("network error")

    with caplog.at_level(logging.ERROR, logger="digitakt.generator"):
        gen._run("test")

    error_records = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert len(error_records) >= 1
    rec = error_records[0]
    assert hasattr(rec, "error_type")
    assert rec.error_type == "Exception"


def test_successful_generation_logs_info(caplog):
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    valid_pattern = {k: [0] * 16 for k in TRACK_NAMES}
    gen._client = _make_mock_client(json.dumps(valid_pattern))

    with caplog.at_level(logging.INFO, logger="digitakt.generator"):
        gen._run("heavy kick")

    info_records = [r for r in caplog.records if r.levelno == logging.INFO]
    assert any("complete" in r.message.lower() for r in info_records)


def test_api_call_logs_latency(caplog):
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    valid_pattern = {k: [0] * 16 for k in TRACK_NAMES}
    gen._client = _make_mock_client(json.dumps(valid_pattern))

    with caplog.at_level(logging.INFO, logger="digitakt.generator"):
        gen._run("test")

    api_records = [r for r in caplog.records if hasattr(r, "latency_ms")]
    assert len(api_records) >= 1
    assert api_records[0].latency_ms >= 0
