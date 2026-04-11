# tests/test_tracing.py
"""Tests for the prompt tracing observability module."""
import json
import os
import tempfile

from core.tracing import Tracer, TraceSpan, tracer


def test_trace_span_records_latency():
    span = TraceSpan(operation="test")
    import time
    time.sleep(0.01)
    span.finish()
    assert span.latency_ms >= 10


def test_trace_span_to_dict():
    span = TraceSpan(operation="generate", prompt="deep techno")
    span.set_response('{"kick": [100]}')
    span.set_status("ok")
    span.finish()
    d = span.to_dict()
    assert d["operation"] == "generate"
    assert d["prompt"] == "deep techno"
    assert d["status"] == "ok"
    assert "timestamp" in d
    assert d["latency_ms"] >= 0


def test_trace_span_error():
    span = TraceSpan(operation="test")
    span.set_error("ValueError: bad input")
    assert span.status == "error"
    assert span.error == "ValueError: bad input"


def test_tracer_records_spans():
    t = Tracer()
    with t.span("op1", prompt="test") as span:
        span.set_status("ok")
    assert len(t.traces) == 1
    assert t.traces[0]["operation"] == "op1"


def test_tracer_bounds_traces():
    t = Tracer(max_traces=5)
    for i in range(10):
        with t.span(f"op{i}") as span:
            span.set_status("ok")
    assert len(t.traces) == 5
    assert t.traces[0]["operation"] == "op5"


def test_tracer_clear():
    t = Tracer()
    with t.span("op") as span:
        span.set_status("ok")
    assert len(t.traces) == 1
    t.clear()
    assert len(t.traces) == 0


def test_tracer_file_output():
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        file_path = f.name

    try:
        t = Tracer()
        t.configure(file_path=file_path)
        with t.span("test_op", prompt="test prompt") as span:
            span.set_response("test response")
            span.set_status("ok")

        with open(file_path) as f:
            lines = f.readlines()
        assert len(lines) == 1
        data = json.loads(lines[0])
        assert data["operation"] == "test_op"
        assert data["prompt"] == "test prompt"
    finally:
        os.unlink(file_path)


def test_span_context_captures_exceptions():
    t = Tracer()
    try:
        with t.span("failing_op") as span:
            raise ValueError("boom")
    except ValueError:
        pass

    assert len(t.traces) == 1
    assert t.traces[0]["status"] == "error"
    assert "ValueError" in t.traces[0]["error"]


def test_span_truncates_long_prompts():
    span = TraceSpan(operation="test", prompt="x" * 1000)
    d = span.to_dict()
    assert len(d["prompt"]) == 500  # truncated to 500


def test_span_truncates_long_responses():
    span = TraceSpan(operation="test")
    span.set_response("y" * 2000, max_len=1000)
    assert len(span.response) == 1000
    d = span.to_dict()
    assert len(d["response"]) == 1000  # to_dict returns the full stored response
