import threading
from core.events import EventBus


def test_subscriber_receives_payload():
    bus = EventBus()
    received = []
    bus.subscribe("pattern_changed", lambda p: received.append(p))
    bus.emit("pattern_changed", {"bpm": 120})
    assert received == [{"bpm": 120}]


def test_multiple_subscribers_all_called():
    bus = EventBus()
    results = []
    bus.subscribe("e", lambda p: results.append("first"))
    bus.subscribe("e", lambda p: results.append("second"))
    bus.emit("e", {})
    assert results == ["first", "second"]


def test_emit_unknown_event_does_not_raise():
    bus = EventBus()
    bus.emit("nonexistent", {"x": 1})  # must not raise


def test_emit_default_empty_payload():
    bus = EventBus()
    received = []
    bus.subscribe("e", lambda p: received.append(p))
    bus.emit("e")
    assert received == [{}]


def test_different_events_isolated():
    bus = EventBus()
    a, b = [], []
    bus.subscribe("event_a", lambda p: a.append(p))
    bus.subscribe("event_b", lambda p: b.append(p))
    bus.emit("event_a", {"x": 1})
    assert a == [{"x": 1}]
    assert b == []


def test_thread_safe_emit():
    bus = EventBus()
    results = []
    lock = threading.Lock()
    bus.subscribe("e", lambda p: [lock.acquire(), results.append(1), lock.release()])

    threads = [threading.Thread(target=bus.emit, args=("e", {})) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(results) == 50
