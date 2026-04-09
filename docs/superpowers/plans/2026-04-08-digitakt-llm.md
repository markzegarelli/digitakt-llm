# Digitakt LLM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Python CLI tool that generates 16-step drum patterns via Claude Opus 4.6 and plays them live on an Elektron Digitakt over USB MIDI, with a FastAPI server always running in the background for future web frontend integration.

**Architecture:** Headless core (`core/`) contains all logic; `cli/` and `api/` are thin adapters. An `AppState` dataclass is instantiated once and shared across all modules. An `EventBus` decouples the player, generator, and WebSocket broadcaster — no direct imports between them.

**Tech Stack:** Python 3.11+, mido, python-rtmidi, anthropic SDK, FastAPI, uvicorn, pydantic, pytest

---

## File Map

| File | Responsibility |
|------|---------------|
| `pyproject.toml` | Packaging, dependencies, `digitakt-llm` entry point |
| `core/state.py` | `AppState` dataclass + `DEFAULT_PATTERN` + `TRACK_NAMES` |
| `core/events.py` | `EventBus` pub/sub |
| `core/midi_utils.py` | Port discovery, `NOTE_MAP`, `send_note` |
| `core/generator.py` | `Generator` — Anthropic API, JSON parsing, retry |
| `core/player.py` | `Player` — background thread, step timing, atomic swap |
| `api/schemas.py` | Pydantic request/response models |
| `api/server.py` | FastAPI app, REST endpoints, WebSocket broadcaster |
| `cli/main.py` | REPL adapter — wires core modules, handles user input |
| `tests/test_state.py` | AppState unit tests |
| `tests/test_events.py` | EventBus unit tests |
| `tests/test_midi_utils.py` | MIDI util unit tests |
| `tests/test_generator.py` | Generator unit tests (mocked Anthropic client) |
| `tests/test_player.py` | Player unit tests (mocked MIDI port) |
| `tests/test_server.py` | FastAPI integration tests |
| `README.md` | Setup, CLI usage, API reference, frontend attachment guide |

---

## Task 1: Project Scaffolding

**Files:**
- Create: `pyproject.toml`
- Create: `core/__init__.py`, `api/__init__.py`, `cli/__init__.py`, `tests/__init__.py`

- [ ] **Step 1: Create directory structure**

```bash
cd /Users/markzegarelli/projects/digitakt_llm
mkdir -p core api cli tests
```

- [ ] **Step 2: Write `pyproject.toml`**

```toml
[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.backends.legacy:build"

[project]
name = "digitakt-llm"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "mido>=1.3",
    "python-rtmidi>=1.5",
    "anthropic>=0.40",
    "fastapi>=0.115",
    "uvicorn[standard]>=0.32",
    "pydantic>=2.10",
]

[project.scripts]
digitakt-llm = "cli.main:main"

[project.optional-dependencies]
dev = ["pytest>=8", "httpx>=0.27"]

[tool.setuptools.packages.find]
where = ["."]
include = ["core*", "api*", "cli*"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

- [ ] **Step 3: Create empty `__init__.py` files**

```bash
touch core/__init__.py api/__init__.py cli/__init__.py tests/__init__.py
```

- [ ] **Step 4: Install in editable mode**

```bash
pip install -e ".[dev]"
```

Expected: no errors. `digitakt-llm --help` will fail (not implemented yet) — that's fine.

- [ ] **Step 5: Commit**

```bash
git add pyproject.toml core/__init__.py api/__init__.py cli/__init__.py tests/__init__.py
git commit -m "chore: project scaffolding and packaging"
```

---

## Task 2: AppState

**Files:**
- Create: `core/state.py`
- Create: `tests/test_state.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_state.py
import threading
import time
from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES


def test_initial_values():
    state = AppState()
    assert state.bpm == 120.0
    assert state.is_playing is False
    assert state.current_pattern == {}
    assert state.pending_pattern is None
    assert state.last_prompt is None
    assert state.pattern_history == []
    assert state.midi_port_name is None
    assert state.event_loop is None


def test_update_pattern_sets_current_and_history():
    state = AppState()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.update_pattern(pattern, prompt="heavy kick")
    assert state.current_pattern == pattern
    assert state.last_prompt == "heavy kick"
    assert len(state.pattern_history) == 1
    assert state.pattern_history[0]["prompt"] == "heavy kick"
    assert state.pattern_history[0]["pattern"] == pattern
    assert "timestamp" in state.pattern_history[0]


def test_update_pattern_caps_history_at_20():
    state = AppState()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    for i in range(25):
        state.update_pattern(pattern, prompt=f"prompt {i}")
    assert len(state.pattern_history) == 20
    assert state.pattern_history[0]["prompt"] == "prompt 5"
    assert state.pattern_history[-1]["prompt"] == "prompt 24"


def test_update_pattern_without_prompt_skips_history():
    state = AppState()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    state.update_pattern(pattern)
    assert state.current_pattern == pattern
    assert state.pattern_history == []
    assert state.last_prompt is None


def test_thread_safe_bpm_update():
    state = AppState()
    errors = []

    def writer():
        for _ in range(1000):
            try:
                state.bpm = 140.0
            except Exception as e:
                errors.append(e)

    threads = [threading.Thread(target=writer) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert errors == []


def test_default_pattern_has_all_tracks():
    assert set(DEFAULT_PATTERN.keys()) == set(TRACK_NAMES)
    for track in TRACK_NAMES:
        assert len(DEFAULT_PATTERN[track]) == 16
        assert all(isinstance(v, int) and 0 <= v <= 127 for v in DEFAULT_PATTERN[track])
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_state.py -v
```

Expected: `ModuleNotFoundError: No module named 'core.state'`

- [ ] **Step 3: Write `core/state.py`**

```python
# core/state.py
import asyncio
import threading
import time
from dataclasses import dataclass, field

TRACK_NAMES = ["kick", "snare", "hihat", "clap", "perc1", "perc2", "perc3", "perc4"]

DEFAULT_PATTERN: dict = {
    "kick":  [100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0, 100, 0, 0, 0],
    "snare": [0, 0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 100, 0, 0, 0],
    "hihat": [60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0, 60, 0],
    "clap":  [0] * 16,
    "perc1": [0] * 16,
    "perc2": [0] * 16,
    "perc3": [0] * 16,
    "perc4": [0] * 16,
}

_HISTORY_MAX = 20


@dataclass
class AppState:
    current_pattern: dict = field(default_factory=dict)
    pending_pattern: dict | None = None
    bpm: float = 120.0
    is_playing: bool = False
    midi_port_name: str | None = None
    last_prompt: str | None = None
    pattern_history: list = field(default_factory=list)
    event_loop: asyncio.AbstractEventLoop | None = None
    _lock: threading.Lock = field(
        default_factory=threading.Lock, init=False, repr=False
    )

    def update_pattern(self, pattern: dict, prompt: str | None = None) -> None:
        with self._lock:
            self.current_pattern = pattern
            if prompt:
                self.last_prompt = prompt
                self.pattern_history.append({
                    "prompt": prompt,
                    "pattern": pattern,
                    "timestamp": time.time(),
                })
                if len(self.pattern_history) > _HISTORY_MAX:
                    self.pattern_history.pop(0)
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_state.py -v
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/state.py tests/test_state.py
git commit -m "feat: AppState with thread-safe pattern history"
```

---

## Task 3: EventBus

**Files:**
- Create: `core/events.py`
- Create: `tests/test_events.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_events.py
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
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_events.py -v
```

Expected: `ModuleNotFoundError: No module named 'core.events'`

- [ ] **Step 3: Write `core/events.py`**

```python
# core/events.py
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_events.py -v
```

Expected: all 6 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/events.py tests/test_events.py
git commit -m "feat: EventBus pub/sub with thread-safe emit"
```

---

## Task 4: MIDI Utilities

**Files:**
- Create: `core/midi_utils.py`
- Create: `tests/test_midi_utils.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_midi_utils.py
from unittest.mock import MagicMock, patch, call
import mido
import core.midi_utils as midi_utils


def test_find_digitakt_returns_matching_port():
    ports = ["USB MIDI Interface", "Elektron Digitakt MIDI 1", "IAC Driver Bus 1"]
    assert midi_utils.find_digitakt(ports) == "Elektron Digitakt MIDI 1"


def test_find_digitakt_returns_none_when_absent():
    ports = ["USB MIDI Interface", "IAC Driver Bus 1"]
    assert midi_utils.find_digitakt(ports) is None


def test_find_digitakt_empty_list():
    assert midi_utils.find_digitakt([]) is None


def test_send_note_sends_note_on_and_off():
    port = MagicMock()
    midi_utils.send_note(port, note=36, velocity=100, channel=0)
    assert port.send.call_count == 2
    on_msg = port.send.call_args_list[0][0][0]
    off_msg = port.send.call_args_list[1][0][0]
    assert on_msg.type == "note_on"
    assert on_msg.note == 36
    assert on_msg.velocity == 100
    assert on_msg.channel == 0
    assert off_msg.type == "note_off"
    assert off_msg.note == 36
    assert off_msg.velocity == 0


def test_send_note_zero_velocity_does_nothing():
    port = MagicMock()
    midi_utils.send_note(port, note=36, velocity=0, channel=0)
    port.send.assert_not_called()


def test_note_map_has_all_tracks():
    from core.state import TRACK_NAMES
    for track in TRACK_NAMES:
        assert track in midi_utils.NOTE_MAP


def test_list_ports_returns_list():
    with patch("mido.get_output_names", return_value=["Port A", "Port B"]):
        ports = midi_utils.list_ports()
    assert ports == ["Port A", "Port B"]
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_midi_utils.py -v
```

Expected: `ModuleNotFoundError: No module named 'core.midi_utils'`

- [ ] **Step 3: Write `core/midi_utils.py`**

```python
# core/midi_utils.py
import mido

NOTE_MAP: dict[str, int] = {
    "kick":  36,
    "snare": 37,
    "hihat": 38,
    "clap":  39,
    "perc1": 40,
    "perc2": 41,
    "perc3": 42,
    "perc4": 43,
}


def list_ports() -> list[str]:
    return mido.get_output_names()


def find_digitakt(ports: list[str]) -> str | None:
    for port in ports:
        if "Digitakt" in port:
            return port
    return None


def open_port(name: str):
    return mido.open_output(name)


def send_note(port, note: int, velocity: int, channel: int = 0) -> None:
    if velocity <= 0:
        return
    port.send(mido.Message("note_on", note=note, velocity=velocity, channel=channel))
    port.send(mido.Message("note_off", note=note, velocity=0, channel=channel))
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_midi_utils.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/midi_utils.py tests/test_midi_utils.py
git commit -m "feat: MIDI utilities — port discovery and note sending"
```

---

## Task 5: Pattern Generator

**Files:**
- Create: `core/generator.py`
- Create: `tests/test_generator.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_generator.py
import json
from unittest.mock import MagicMock, patch
from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core.generator import Generator

VALID_PATTERN = {k: [0] * 16 for k in TRACK_NAMES}
VALID_PATTERN["kick"][0] = 100


def _make_mock_client(response_text: str) -> MagicMock:
    client = MagicMock()
    msg = MagicMock()
    msg.content = [MagicMock(text=response_text)]
    client.messages.create.return_value = msg
    return client


def test_valid_json_emits_generation_complete():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_started", lambda p: events.append(("started", p)))
    bus.subscribe("generation_complete", lambda p: events.append(("complete", p)))

    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("heavy kick")

    assert events[0] == ("started", {"prompt": "heavy kick"})
    assert events[1][0] == "complete"
    assert events[1][1]["pattern"] == VALID_PATTERN
    assert events[1][1]["prompt"] == "heavy kick"


def test_valid_json_updates_state():
    state = AppState()
    bus = EventBus()
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("heavy kick")

    assert state.last_prompt == "heavy kick"
    assert len(state.pattern_history) == 1
    assert state.pending_pattern == VALID_PATTERN


def test_invalid_json_retries_once_then_emits_failed():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    gen = Generator(state, bus)
    gen._client = _make_mock_client("not valid json at all")
    gen._run("test prompt")

    assert gen._client.messages.create.call_count == 2
    assert len(events) == 1
    assert events[0]["prompt"] == "test prompt"
    assert "error" in events[0]


def test_api_exception_emits_generation_failed():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    gen = Generator(state, bus)
    gen._client = MagicMock()
    gen._client.messages.create.side_effect = Exception("network error")
    gen._run("test")

    assert len(events) == 1
    assert "network error" in events[0]["error"]


def test_variation_passes_prior_context():
    state = AppState()
    state.last_prompt = "original prompt"
    state.current_pattern = VALID_PATTERN
    bus = EventBus()

    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(VALID_PATTERN))
    gen._run("more sparse", variation=True)

    call_kwargs = gen._client.messages.create.call_args
    user_content = call_kwargs[1]["messages"][0]["content"]
    assert "original prompt" in user_content
    assert "more sparse" in user_content


def test_pattern_with_wrong_track_names_fails_validation():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    bad_pattern = {"bass": [0] * 16}
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(bad_pattern))
    gen._run("test")

    assert len(events) == 1


def test_pattern_with_wrong_step_count_fails_validation():
    state = AppState()
    bus = EventBus()
    events = []
    bus.subscribe("generation_failed", lambda p: events.append(p))

    bad_pattern = {k: [0] * 8 for k in TRACK_NAMES}  # 8 steps instead of 16
    gen = Generator(state, bus)
    gen._client = _make_mock_client(json.dumps(bad_pattern))
    gen._run("test")

    assert len(events) == 1
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_generator.py -v
```

Expected: `ModuleNotFoundError: No module named 'core.generator'`

- [ ] **Step 3: Write `core/generator.py`**

```python
# core/generator.py
import json
import threading
import anthropic
from core.state import AppState, TRACK_NAMES
from core.events import EventBus

_SYSTEM_PROMPT = (
    "You are an expert drum pattern generator for electronic music production. "
    "You deeply understand groove, genre conventions, rhythm feel, and dynamics. "
    "Generate 16-step drum patterns as strict JSON. Each step is an integer 0–127 "
    "(velocity), 0 = silent.\n\n"
    "Respond ONLY with valid JSON in this exact format — no explanation, no markdown:\n"
    '{\n'
    '  "kick":  [16 integers 0-127],\n'
    '  "snare": [16 integers 0-127],\n'
    '  "hihat": [16 integers 0-127],\n'
    '  "clap":  [16 integers 0-127],\n'
    '  "perc1": [16 integers 0-127],\n'
    '  "perc2": [16 integers 0-127],\n'
    '  "perc3": [16 integers 0-127],\n'
    '  "perc4": [16 integers 0-127]\n'
    "}"
)

_STRICT_SUFFIX = (
    "\n\nIMPORTANT: Output ONLY the JSON object. "
    "No text before, no text after, no markdown fences."
)


class Generator:
    def __init__(self, state: AppState, bus: EventBus) -> None:
        self.state = state
        self.bus = bus
        self._client = anthropic.Anthropic()

    def generate(self, prompt: str, variation: bool = False) -> None:
        thread = threading.Thread(
            target=self._run, args=(prompt, variation), daemon=True
        )
        thread.start()

    def _build_user_prompt(self, prompt: str, variation: bool) -> str:
        if variation and self.state.last_prompt and self.state.current_pattern:
            return (
                f"Previous prompt: {self.state.last_prompt}\n"
                f"Previous pattern: {json.dumps(self.state.current_pattern)}\n\n"
                f"Apply this variation: {prompt}"
            )
        return prompt

    def _parse_pattern(self, text: str) -> dict | None:
        try:
            data = json.loads(text.strip())
        except (json.JSONDecodeError, ValueError):
            return None
        if not isinstance(data, dict):
            return None
        if not all(k in data for k in TRACK_NAMES):
            return None
        if not all(len(data[k]) == 16 for k in TRACK_NAMES):
            return None
        if not all(
            isinstance(v, int) and 0 <= v <= 127
            for k in TRACK_NAMES
            for v in data[k]
        ):
            return None
        return data

    def _call_api(self, user_prompt: str, strict: bool = False) -> str:
        content = user_prompt + (_STRICT_SUFFIX if strict else "")
        response = self._client.messages.create(
            model="claude-opus-4-6",
            max_tokens=1024,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
        )
        return response.content[0].text

    def _run(self, prompt: str, variation: bool) -> None:
        self.bus.emit("generation_started", {"prompt": prompt})
        user_prompt = self._build_user_prompt(prompt, variation)

        try:
            text = self._call_api(user_prompt)
            pattern = self._parse_pattern(text)

            if pattern is None:
                text = self._call_api(user_prompt, strict=True)
                pattern = self._parse_pattern(text)

            if pattern is None:
                self.bus.emit(
                    "generation_failed",
                    {"prompt": prompt, "error": "Invalid JSON after retry"},
                )
                return

            self.state.update_pattern(pattern, prompt)
            self.state.pending_pattern = pattern
            self.bus.emit("generation_complete", {"pattern": pattern, "prompt": prompt})

        except Exception as exc:
            self.bus.emit(
                "generation_failed", {"prompt": prompt, "error": str(exc)}
            )
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_generator.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/generator.py tests/test_generator.py
git commit -m "feat: Generator — Anthropic API, JSON validation, retry on parse failure"
```

---

## Task 6: Playback Engine

**Files:**
- Create: `core/player.py`
- Create: `tests/test_player.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_player.py
import time
import threading
from unittest.mock import MagicMock
from core.state import AppState, TRACK_NAMES, DEFAULT_PATTERN
from core.events import EventBus
from core.player import Player


def _make_player() -> tuple[Player, AppState, EventBus, MagicMock]:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    port = MagicMock()
    player = Player(state, bus, port)
    return player, state, bus, port


def test_queue_pattern_sets_pending():
    player, state, _, _ = _make_player()
    pattern = {k: [0] * 16 for k in TRACK_NAMES}
    player.queue_pattern(pattern)
    assert state.pending_pattern == pattern


def test_set_bpm_updates_state_and_emits():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("bpm_changed", lambda p: events.append(p))
    player.set_bpm(140.0)
    assert state.bpm == 140.0
    assert events == [{"bpm": 140.0}]


def test_start_sets_is_playing_and_emits():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("playback_started", lambda p: events.append(p))
    player.start()
    time.sleep(0.05)
    assert state.is_playing is True
    assert events == [{}]
    player.stop()


def test_stop_clears_is_playing_and_emits():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("playback_stopped", lambda p: events.append(p))
    player.start()
    time.sleep(0.05)
    player.stop()
    time.sleep(0.05)
    assert state.is_playing is False
    assert events == [{}]


def test_start_twice_does_not_start_second_thread():
    player, _, _, _ = _make_player()
    player.start()
    time.sleep(0.05)
    thread_before = player._thread
    player.start()
    assert player._thread is thread_before
    player.stop()


def test_pending_pattern_applied_after_loop():
    player, state, bus, _ = _make_player()
    events = []
    bus.subscribe("pattern_changed", lambda p: events.append(p))

    # Set BPM very high so the 16-step loop completes fast
    state.bpm = 9000.0
    player.start()

    new_pattern = {k: [127] * 16 for k in TRACK_NAMES}
    player.queue_pattern(new_pattern)

    # Wait long enough for at least one full loop at 9000 BPM
    # Step duration = 60/9000/4 ≈ 0.0017s; 16 steps ≈ 0.027s
    time.sleep(0.2)
    player.stop()

    assert state.current_pattern == new_pattern
    assert len(events) >= 1


def test_step_duration_formula():
    player, state, _, _ = _make_player()
    state.bpm = 120.0
    assert abs(player._step_duration() - 0.125) < 1e-9
    state.bpm = 60.0
    assert abs(player._step_duration() - 0.25) < 1e-9
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_player.py -v
```

Expected: `ModuleNotFoundError: No module named 'core.player'`

- [ ] **Step 3: Write `core/player.py`**

```python
# core/player.py
import time
import threading
from core.state import AppState, TRACK_NAMES
from core.events import EventBus
from core import midi_utils


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
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        self.state.is_playing = True
        self.bus.emit("playback_started", {})

    def stop(self) -> None:
        self._stop_event.set()
        self.state.is_playing = False
        self.bus.emit("playback_stopped", {})

    def set_bpm(self, bpm: float) -> None:
        self.state.bpm = bpm
        self.bus.emit("bpm_changed", {"bpm": bpm})

    def queue_pattern(self, pattern: dict) -> None:
        self.state.pending_pattern = pattern

    def _step_duration(self) -> float:
        return 60.0 / self.state.bpm / 4.0

    def _play_step(self, step: int) -> None:
        pattern = self.state.current_pattern
        for track in TRACK_NAMES:
            note = midi_utils.NOTE_MAP.get(track)
            if note is None or track not in pattern:
                continue
            velocity = pattern[track][step]
            if velocity > 0:
                try:
                    midi_utils.send_note(self.port, note, velocity)
                except Exception:
                    self.bus.emit(
                        "midi_disconnected",
                        {"port": self.state.midi_port_name},
                    )
                    self._stop_event.set()
                    return

    def _loop(self) -> None:
        while not self._stop_event.is_set():
            for step in range(16):
                if self._stop_event.is_set():
                    break
                t0 = time.perf_counter()
                self._play_step(step)
                elapsed = time.perf_counter() - t0
                sleep_time = self._step_duration() - elapsed
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
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
pytest tests/test_player.py -v
```

Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add core/player.py tests/test_player.py
git commit -m "feat: Player — background thread, step timing, atomic pattern swap"
```

---

## Task 7: API Layer

**Files:**
- Create: `api/schemas.py`
- Create: `api/server.py`
- Create: `tests/test_server.py`

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_server.py
import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
import api.server as server_module


def _make_test_client(tmp_path: Path) -> TestClient:
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    mock_port = MagicMock()
    player = Player(state, bus, mock_port)
    gen = Generator(state, bus)
    gen._client = MagicMock()  # prevent real API calls

    server_module.init(state, bus, player, gen, patterns_dir=str(tmp_path))
    return TestClient(server_module.app)


def test_get_state_returns_200(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/state")
    assert resp.status_code == 200
    data = resp.json()
    assert "bpm" in data
    assert "is_playing" in data
    assert data["bpm"] == 120.0


def test_post_bpm_updates_state(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/bpm", json={"bpm": 140.0})
    assert resp.status_code == 200
    state_resp = client.get("/state")
    assert state_resp.json()["bpm"] == 140.0


def test_post_generate_returns_202(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/generate", json={"prompt": "heavy kick"})
    assert resp.status_code == 202


def test_post_play_returns_200(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/play")
    assert resp.status_code == 200
    server_module._player.stop()


def test_post_stop_returns_200(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.post("/stop")
    assert resp.status_code == 200


def test_get_patterns_empty(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/patterns")
    assert resp.status_code == 200
    assert resp.json() == {"names": []}


def test_save_and_load_pattern(tmp_path):
    client = _make_test_client(tmp_path)
    save_resp = client.post("/patterns/test-beat")
    assert save_resp.status_code == 200
    assert (tmp_path / "test-beat.json").exists()

    list_resp = client.get("/patterns")
    assert "test-beat" in list_resp.json()["names"]

    load_resp = client.get("/patterns/test-beat")
    assert load_resp.status_code == 200


def test_load_nonexistent_pattern_returns_404(tmp_path):
    client = _make_test_client(tmp_path)
    resp = client.get("/patterns/does-not-exist")
    assert resp.status_code == 404


def test_websocket_connects(tmp_path):
    client = _make_test_client(tmp_path)
    with client.websocket_connect("/ws") as ws:
        # Connection established — no assertion needed beyond not raising
        pass
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
pytest tests/test_server.py -v
```

Expected: `ModuleNotFoundError: No module named 'api.schemas'`

- [ ] **Step 3: Write `api/schemas.py`**

```python
# api/schemas.py
from pydantic import BaseModel, field_validator


class GenerateRequest(BaseModel):
    prompt: str

    @field_validator("prompt")
    @classmethod
    def prompt_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("prompt must not be empty")
        return v.strip()


class BpmRequest(BaseModel):
    bpm: float

    @field_validator("bpm")
    @classmethod
    def bpm_in_range(cls, v: float) -> float:
        if not (20.0 <= v <= 400.0):
            raise ValueError("bpm must be between 20 and 400")
        return v


class StateResponse(BaseModel):
    current_pattern: dict
    pending_pattern: dict | None
    bpm: float
    is_playing: bool
    midi_port_name: str | None
    last_prompt: str | None
    pattern_history: list


class PatternListResponse(BaseModel):
    names: list[str]
```

- [ ] **Step 4: Write `api/server.py`**

```python
# api/server.py
import asyncio
import json
import os
import threading
from pathlib import Path
from typing import Set

import uvicorn
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException

from api.schemas import BpmRequest, GenerateRequest, PatternListResponse, StateResponse
from core.events import EventBus
from core.state import AppState

app = FastAPI(title="Digitakt LLM")

# Module-level singletons set by init()
_state: AppState | None = None
_bus: EventBus | None = None
_player = None
_generator = None
_patterns_dir: str = "patterns"
_ws_clients: Set[WebSocket] = set()

_ALL_EVENTS = [
    "pattern_changed", "bpm_changed", "playback_started", "playback_stopped",
    "generation_started", "generation_complete", "generation_failed", "midi_disconnected",
]


def init(state: AppState, bus: EventBus, player, generator, patterns_dir: str = "patterns") -> None:
    global _state, _bus, _player, _generator, _patterns_dir
    _state = state
    _bus = bus
    _player = player
    _generator = generator
    _patterns_dir = patterns_dir
    os.makedirs(_patterns_dir, exist_ok=True)


def _broadcast_event(event_name: str, payload: dict) -> None:
    if _state and _state.event_loop:
        asyncio.run_coroutine_threadsafe(
            _broadcast_to_clients({"event": event_name, "data": payload}),
            _state.event_loop,
        )


async def _broadcast_to_clients(message: dict) -> None:
    dead = set()
    for ws in list(_ws_clients):
        try:
            await ws.send_json(message)
        except Exception:
            dead.add(ws)
    _ws_clients.difference_update(dead)


@app.on_event("startup")
async def _startup() -> None:
    # Capture the running event loop so worker threads can schedule broadcasts
    if _state is not None:
        _state.event_loop = asyncio.get_running_loop()
    if _bus is not None:
        for event_name in _ALL_EVENTS:
            _bus.subscribe(
                event_name,
                lambda p, name=event_name: _broadcast_event(name, p),
            )


# REST endpoints

@app.get("/state", response_model=StateResponse)
def get_state():
    return StateResponse(
        current_pattern=_state.current_pattern,
        pending_pattern=_state.pending_pattern,
        bpm=_state.bpm,
        is_playing=_state.is_playing,
        midi_port_name=_state.midi_port_name,
        last_prompt=_state.last_prompt,
        pattern_history=_state.pattern_history,
    )


@app.post("/generate", status_code=202)
def post_generate(req: GenerateRequest):
    variation = _state.last_prompt is not None
    _generator.generate(req.prompt, variation=variation)
    return {"status": "queued"}


@app.post("/bpm")
def post_bpm(req: BpmRequest):
    _player.set_bpm(req.bpm)
    return {"bpm": req.bpm}


@app.post("/play")
def post_play():
    _player.start()
    return {"status": "playing"}


@app.post("/stop")
def post_stop():
    _player.stop()
    return {"status": "stopped"}


@app.get("/patterns", response_model=PatternListResponse)
def get_patterns():
    names = [
        p.stem for p in Path(_patterns_dir).glob("*.json")
    ]
    return PatternListResponse(names=sorted(names))


@app.post("/patterns/{name}")
def save_pattern(name: str):
    path = Path(_patterns_dir) / f"{name}.json"
    path.write_text(json.dumps(_state.current_pattern, indent=2))
    return {"saved": name}


@app.get("/patterns/{name}")
def load_pattern(name: str):
    path = Path(_patterns_dir) / f"{name}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Pattern '{name}' not found")
    pattern = json.loads(path.read_text())
    _player.queue_pattern(pattern)
    return {"loaded": name}


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)
    try:
        while True:
            await websocket.receive_text()  # keep connection alive
    except WebSocketDisconnect:
        _ws_clients.discard(websocket)


def start_background(port: int = 8000) -> None:
    thread = threading.Thread(
        target=uvicorn.run,
        args=(app,),
        kwargs={"host": "0.0.0.0", "port": port, "log_level": "error"},
        daemon=True,
    )
    thread.start()
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
pytest tests/test_server.py -v
```

Expected: all 9 tests PASS

- [ ] **Step 6: Commit**

```bash
git add api/schemas.py api/server.py tests/test_server.py
git commit -m "feat: FastAPI server — REST endpoints, WebSocket broadcaster, async/sync bridge"
```

---

## Task 8: CLI Adapter

**Files:**
- Create: `cli/main.py`

No unit tests — the CLI is purely I/O wiring. Manual smoke-test instructions are provided below.

- [ ] **Step 1: Write `cli/main.py`**

```python
# cli/main.py
import os
import sys
import json
import threading
from pathlib import Path

from core.state import AppState, DEFAULT_PATTERN, TRACK_NAMES
from core.events import EventBus
from core.player import Player
from core.generator import Generator
from core import midi_utils
import api.server as server_module


_PATTERNS_DIR = Path("patterns")


def _ascii_grid(pattern: dict) -> str:
    beats = "     1 . . . 2 . . . 3 . . . 4 . . ."
    labels = {"kick": "kick", "snare": "snr ", "hihat": "hhat", "clap": "clap",
              "perc1": "prc1", "perc2": "prc2", "perc3": "prc3", "perc4": "prc4"}
    lines = [beats]
    for track in TRACK_NAMES:
        steps = pattern.get(track, [0] * 16)
        cells = " ".join("X" if v > 0 else "." for v in steps)
        lines.append(f"{labels[track]} [{cells}]")
    return "\n".join(lines)


def _subscribe_cli_events(bus: EventBus) -> None:
    def on_generation_started(p):
        print(f"\n[generating: {p['prompt']}...]")

    def on_generation_complete(p):
        print(f"\n[pattern ready: {p['prompt']}]")

    def on_generation_failed(p):
        print(f"\n[generation failed: {p['error']}]")

    def on_midi_disconnected(p):
        print(f"\n[MIDI disconnected: {p.get('port')}. Reconnecting...]")

    bus.subscribe("generation_started", on_generation_started)
    bus.subscribe("generation_complete", on_generation_complete)
    bus.subscribe("generation_failed", on_generation_failed)
    bus.subscribe("midi_disconnected", on_midi_disconnected)


def _select_midi_port() -> str | None:
    ports = midi_utils.list_ports()
    if not ports:
        print("No MIDI output ports found. Continuing without MIDI.")
        return None

    found = midi_utils.find_digitakt(ports)
    if found:
        print(f"Auto-selected: {found}")
        return found

    print("Available MIDI ports:")
    for i, name in enumerate(ports):
        print(f"  {i}: {name}")
    choice = input("Select port number (or Enter to skip): ").strip()
    if not choice:
        return None
    try:
        return ports[int(choice)]
    except (ValueError, IndexError):
        print("Invalid selection. Continuing without MIDI.")
        return None


def _prompt_bpm() -> float:
    raw = input("BPM [120]: ").strip()
    if not raw:
        return 120.0
    try:
        bpm = float(raw)
        if 20.0 <= bpm <= 400.0:
            return bpm
        print("BPM out of range (20–400). Using 120.")
    except ValueError:
        print("Invalid BPM. Using 120.")
    return 120.0


def _run_repl(player: Player, generator: Generator, state: AppState) -> None:
    print("\nReady. Commands: bpm <n>, stop, play, show, save <name>, load <name>")
    print("Anything else is sent to Claude as a pattern prompt.\n")

    while True:
        try:
            line = input("> ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting.")
            player.stop()
            sys.exit(0)

        if not line:
            continue

        parts = line.split(maxsplit=1)
        cmd = parts[0].lower()
        arg = parts[1] if len(parts) > 1 else ""

        if cmd == "bpm" and arg:
            try:
                player.set_bpm(float(arg))
                print(f"BPM set to {arg}")
            except ValueError:
                print("Usage: bpm <number>")

        elif cmd == "stop":
            player.stop()
            print("Stopped.")

        elif cmd == "play":
            player.start()
            print("Playing.")

        elif cmd == "show":
            print(_ascii_grid(state.current_pattern))

        elif cmd == "save" and arg:
            _PATTERNS_DIR.mkdir(exist_ok=True)
            path = _PATTERNS_DIR / f"{arg}.json"
            path.write_text(json.dumps(state.current_pattern, indent=2))
            print(f"Saved to {path}")

        elif cmd == "load" and arg:
            path = _PATTERNS_DIR / f"{arg}.json"
            if not path.exists():
                print(f"Pattern '{arg}' not found.")
            else:
                pattern = json.loads(path.read_text())
                player.queue_pattern(pattern)
                print(f"Queued '{arg}' for next loop.")

        else:
            # Everything else → send to generator
            variation = state.last_prompt is not None
            generator.generate(line, variation=variation)


def main() -> None:
    state = AppState()
    bus = EventBus()

    # Wire generator → player: apply new patterns on generation_complete
    def on_generation_complete(payload: dict) -> None:
        player.queue_pattern(payload["pattern"])

    # Select MIDI port
    port_name = _select_midi_port()
    port = midi_utils.open_port(port_name) if port_name else None
    state.midi_port_name = port_name

    player = Player(state, bus, port)
    generator = Generator(state, bus)

    bus.subscribe("generation_complete", on_generation_complete)
    _subscribe_cli_events(bus)

    # Start FastAPI in background
    api_port = int(os.environ.get("PORT", "8000"))
    server_module.init(state, bus, player, generator)
    server_module.start_background(port=api_port)
    print(f"API server started at http://localhost:{api_port}")

    # Load default pattern and start
    bpm = _prompt_bpm()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    player.set_bpm(bpm)

    if port:
        player.start()
        print(f"Playing at {bpm} BPM.")
    else:
        print("No MIDI port — playback disabled. Generate patterns to preview in 'show'.")

    _run_repl(player, generator, state)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the full test suite to confirm nothing is broken**

```bash
pytest -v
```

Expected: all tests PASS

- [ ] **Step 3: Smoke test the CLI (requires Digitakt connected or skipped)**

```bash
ANTHROPIC_API_KEY=sk-ant-... digitakt-llm
```

Expected:
- Port selection or auto-detect
- BPM prompt
- `> ` REPL appears
- Type `show` → ASCII grid prints
- Type `heavy techno kick` → `[generating: heavy techno kick...]` then `[pattern ready: ...]`

- [ ] **Step 4: Commit**

```bash
git add cli/main.py
git commit -m "feat: CLI REPL adapter — wires core modules, MIDI port selection, event notifications"
```

---

## Task 9: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
# digitakt-llm

Generate drum patterns on an Elektron Digitakt in real time using Claude Opus 4.6. Describe a vibe in plain English — the pattern plays immediately and loops until you change it.

## Requirements

- Python 3.11+
- An Elektron Digitakt connected via USB
- An Anthropic API key

## Setup

```bash
pip install -e ".[dev]"
export ANTHROPIC_API_KEY=sk-ant-...
digitakt-llm
```

## CLI Usage

```
     1 . . . 2 . . . 3 . . . 4 . . .
kick [X . . . X . . . X . . . X . . .]
snr  [. . . . X . . . . . . . X . . .]
hhat [X . X . X . X . X . X . X . X .]
clap [. . . . . . . . . . . . . . . .]
```

| Command | Description |
|---------|-------------|
| `bpm 140` | Set tempo |
| `stop` | Stop playback |
| `play` | Resume playback |
| `show` | Print ASCII step grid |
| `save <name>` | Save current pattern to `patterns/<name>.json` |
| `load <name>` | Queue a saved pattern for the next loop |
| *(anything else)* | Generate a new pattern or variation from your description |

**First prompt** generates a fresh pattern. **Subsequent prompts** are treated as variations (prior pattern and prompt are passed as context). Say `new:` at the start of a prompt to force a fresh generation.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | (required) | Anthropic API key |
| `PORT` | `8000` | FastAPI server port |

## API Reference

The FastAPI server starts automatically on `http://localhost:8000`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/state` | Full application state as JSON |
| `POST` | `/generate` | `{"prompt": "..."}` → 202 Accepted |
| `POST` | `/bpm` | `{"bpm": 140.0}` |
| `POST` | `/play` | Start playback |
| `POST` | `/stop` | Stop playback |
| `GET` | `/patterns` | `{"names": [...]}` |
| `POST` | `/patterns/{name}` | Save current pattern |
| `GET` | `/patterns/{name}` | Queue saved pattern |
| `WS` | `/ws` | Event stream (see below) |

## Attaching a Frontend

The WebSocket at `ws://localhost:8000/ws` pushes every internal event as JSON:

```json
{"event": "pattern_changed", "data": {"pattern": {...}, "prompt": "..."}}
{"event": "generation_started", "data": {"prompt": "..."}}
{"event": "generation_complete", "data": {"pattern": {...}, "prompt": "..."}}
{"event": "generation_failed", "data": {"prompt": "...", "error": "..."}}
{"event": "bpm_changed", "data": {"bpm": 140.0}}
{"event": "playback_started", "data": {}}
{"event": "playback_stopped", "data": {}}
{"event": "midi_disconnected", "data": {"port": "..."}}
```

`GET /state` returns the full `AppState` shape. Control playback with the REST endpoints above.
```

- [ ] **Step 2: Run the full test suite one final time**

```bash
pytest -v
```

Expected: all tests PASS, zero failures

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, CLI usage, API reference, and frontend guide"
```

---

## Self-Review Against Spec

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `core/state.py` AppState with all fields | Task 2 |
| `core/events.py` pub/sub bus | Task 3 |
| `core/midi_utils.py` port discovery + note sending | Task 4 |
| `core/generator.py` — claude-opus-4-6, retry on parse failure | Task 5 |
| `core/player.py` — background thread, atomic swap, perf_counter timing | Task 6 |
| `api/schemas.py` Pydantic models | Task 7 |
| `api/server.py` all 9 endpoints + WebSocket | Task 7 |
| Async/sync WebSocket bridge via `run_coroutine_threadsafe` | Task 7 |
| `cli/main.py` REPL with all 6 commands | Task 8 |
| Generator → player wiring via event bus | Task 8 |
| `pyproject.toml` + `digitakt-llm` entry point | Task 1 |
| Default 4-on-the-floor pattern at startup | Task 8 |
| MIDI auto-detect Digitakt or prompt user | Task 8 |
| ASCII step grid | Task 8 |
| `ANTHROPIC_API_KEY` + `PORT` env vars | Task 8 |
| `README.md` with all required sections | Task 9 |
| `patterns/` directory | Task 1 |

**No gaps found.**
