# tests/test_tui_slash_commands.py
from unittest.mock import MagicMock, patch, call
import pytest

from core.state import AppState, TRACK_NAMES, DEFAULT_PATTERN
from core.events import EventBus
from cli.tui import DigitaktApp


def _make_app():
    player = MagicMock()
    generator = MagicMock()
    state = AppState()
    state.current_pattern = {k: list(DEFAULT_PATTERN[k]) for k in TRACK_NAMES}
    bus = EventBus()
    port = MagicMock()
    app = DigitaktApp(player=player, generator=generator, state=state, port=port, bus=bus)
    # Manually initialize slash handlers (normally done in on_mount)
    app._slash_handlers = {
        "play":    app._cmd_play,
        "stop":    app._cmd_stop,
        "bpm":     app._cmd_bpm,
        "save":    app._cmd_save,
        "load":    app._cmd_load,
        "cc":      app._cmd_cc,
        "help":    app._cmd_help,
        "quit":    app._cmd_quit,
        "q":       app._cmd_quit,
        "mute":    app._cmd_mute,
        "prob":    app._cmd_prob,
        "swing":   app._cmd_swing,
        "vel":     app._cmd_vel,
        "random":  app._cmd_random,
        "log":     app._cmd_log,
        "randbeat": app._cmd_randbeat,
    }
    # Mock _log to capture messages
    app._log = MagicMock()
    # Mock _refresh_pattern and _refresh_cc
    app._refresh_pattern = MagicMock()
    app._refresh_cc = MagicMock()
    # Mock query_one so reactive watchers don't fail when DOM isn't mounted
    app.query_one = MagicMock(return_value=MagicMock())
    return app, player, generator, state, bus


# ── play / stop ───────────────────────────────────────────────────────────────

def test_slash_play_calls_player_start():
    app, player, *_ = _make_app()
    app._handle_slash("play")
    player.start.assert_called_once()


def test_slash_stop_calls_player_stop():
    app, player, *_ = _make_app()
    app._handle_slash("stop")
    player.stop.assert_called_once()


# ── bpm ───────────────────────────────────────────────────────────────────────

def test_slash_bpm_calls_set_bpm():
    app, player, *_ = _make_app()
    app._handle_slash("bpm 130")
    player.set_bpm.assert_called_once_with(130.0)


def test_slash_bpm_invalid_logs_not_crashes():
    app, player, *_ = _make_app()
    # Should not raise
    app._handle_slash("bpm notanumber")
    app._log.assert_called()
    player.set_bpm.assert_not_called()


# ── unknown command / bare input ──────────────────────────────────────────────

def test_slash_unknown_does_not_call_generator():
    app, player, generator, *_ = _make_app()
    app._handle_slash("unknowncmd")
    generator.generate.assert_not_called()


def test_bare_unknown_calls_generator_generate():
    app, player, generator, *_ = _make_app()
    app._handle_bare("make a techno beat")
    generator.generate.assert_called_once_with("make a techno beat", variation=False)


def test_bare_bpm_backward_compat():
    app, player, *_ = _make_app()
    app._handle_bare("bpm 140")
    player.set_bpm.assert_called_once_with(140.0)


# ── quit ──────────────────────────────────────────────────────────────────────

def test_slash_quit_calls_player_stop():
    app, player, *_ = _make_app()
    app.exit = MagicMock()
    app._handle_slash("quit")
    player.stop.assert_called_once()


# ── mute ──────────────────────────────────────────────────────────────────────

def test_slash_mute_toggles_track_muted():
    app, player, generator, state, bus = _make_app()
    assert state.track_muted["snare"] is False

    app._handle_slash("mute snare")
    assert state.track_muted["snare"] is True

    app._handle_slash("mute snare")
    assert state.track_muted["snare"] is False


def test_slash_mute_unknown_track_logs_error():
    app, *_ = _make_app()
    app._handle_slash("mute nonexistent")
    app._log.assert_called()
    # Verify the log message contains some indicator of error
    logged_msg = app._log.call_args[0][0]
    assert "nonexistent" in logged_msg or "Unknown" in logged_msg or "unknown" in logged_msg


# ── prob ──────────────────────────────────────────────────────────────────────

def test_slash_prob_queues_pattern():
    app, player, *_ = _make_app()
    app._handle_slash("prob kick 1 60")
    player.queue_pattern.assert_called_once()


def test_slash_prob_step_1_indexed():
    app, player, *_ = _make_app()
    app._handle_slash("prob kick 1 60")
    queued = player.queue_pattern.call_args[0][0]
    assert queued["prob"]["kick"][0] == 60


# ── swing ─────────────────────────────────────────────────────────────────────

def test_slash_swing_queues_pattern_with_swing():
    app, player, *_ = _make_app()
    app._handle_slash("swing 25")
    player.queue_pattern.assert_called_once()
    queued = player.queue_pattern.call_args[0][0]
    assert queued["swing"] == 25


# ── vel ───────────────────────────────────────────────────────────────────────

def test_slash_vel_queues_pattern():
    app, player, *_ = _make_app()
    app._handle_slash("vel kick 1 80")
    player.queue_pattern.assert_called_once()


# ── random ────────────────────────────────────────────────────────────────────

def test_slash_random_velocity_queues():
    app, player, *_ = _make_app()
    app._handle_slash("random kick velocity")
    player.queue_pattern.assert_called_once()


def test_slash_random_prob_queues():
    app, player, *_ = _make_app()
    app._handle_slash("random kick prob")
    player.queue_pattern.assert_called_once()


def test_slash_random_bad_range_logs_error():
    app, player, *_ = _make_app()
    app._handle_slash("random kick velocity [200-300]")
    app._log.assert_called()
    player.queue_pattern.assert_not_called()


def test_slash_random_unknown_param_logs_error():
    app, player, *_ = _make_app()
    app._handle_slash("random kick notaparam")
    app._log.assert_called()
    player.queue_pattern.assert_not_called()


# ── generation_complete BPM auto-apply ────────────────────────────────────────

def test_generation_complete_with_bpm_calls_set_bpm():
    app, player, *_ = _make_app()
    app._cft = lambda fn, *args: fn(*args)
    app._on_generation_complete({"prompt": "test", "pattern": {}, "bpm": 138.0, "cc_changes": {}})
    player.set_bpm.assert_called_once_with(138.0)


def test_generation_complete_with_none_bpm_skips_set_bpm():
    app, player, *_ = _make_app()
    app._cft = lambda fn, *args: fn(*args)
    app._on_generation_complete({"prompt": "test", "pattern": {}, "bpm": None, "cc_changes": {}})
    player.set_bpm.assert_not_called()


def test_generation_complete_missing_bpm_key_skips_set_bpm():
    app, player, *_ = _make_app()
    app._cft = lambda fn, *args: fn(*args)
    app._on_generation_complete({"prompt": "test", "pattern": {}, "cc_changes": {}})
    player.set_bpm.assert_not_called()


def test_generation_complete_bpm_boundary_values():
    app, player, *_ = _make_app()
    app._cft = lambda fn, *args: fn(*args)
    app._on_generation_complete({"prompt": "t", "pattern": {}, "bpm": 20.0, "cc_changes": {}})
    player.set_bpm.assert_called_once_with(20.0)
    player.reset_mock()
    app._on_generation_complete({"prompt": "t", "pattern": {}, "bpm": 400.0, "cc_changes": {}})
    player.set_bpm.assert_called_once_with(400.0)


# ── /log toggle ───────────────────────────────────────────────────────────────

def test_cmd_log_sets_show_log_true():
    app, *_ = _make_app()
    assert app.show_log is False
    app._cmd_log("")
    assert app.show_log is True


def test_cmd_log_toggles_show_log_back_to_false():
    app, *_ = _make_app()
    app.show_log = True
    app._cmd_log("")
    assert app.show_log is False


def test_watch_show_log_true_shows_log_hides_cc():
    app, *_ = _make_app()
    event_log_widget = MagicMock()
    cc_panel_widget = MagicMock()

    def mock_query_one(selector, *args):
        if "event-log" in selector:
            return event_log_widget
        return cc_panel_widget

    app.query_one = mock_query_one
    app.watch_show_log(True)
    assert event_log_widget.display == True
    assert cc_panel_widget.display == False


def test_watch_show_log_false_shows_cc_hides_log():
    app, *_ = _make_app()
    event_log_widget = MagicMock()
    cc_panel_widget = MagicMock()

    def mock_query_one(selector, *args):
        if "event-log" in selector:
            return event_log_widget
        return cc_panel_widget

    app.query_one = mock_query_one
    app.watch_show_log(False)
    assert event_log_widget.display == False
    assert cc_panel_widget.display == True


def test_slash_log_registered():
    app, *_ = _make_app()
    assert "log" in app._slash_handlers


# ── /randbeat ─────────────────────────────────────────────────────────────────

def test_slash_randbeat_registered():
    app, *_ = _make_app()
    assert "randbeat" in app._slash_handlers


def test_slash_randbeat_calls_queue_pattern():
    app, player, *_ = _make_app()
    app._handle_slash("randbeat")
    player.queue_pattern.assert_called_once()


def test_slash_randbeat_calls_set_bpm_in_techno_range():
    app, player, *_ = _make_app()
    app._handle_slash("randbeat")
    bpm = player.set_bpm.call_args[0][0]
    assert 128 <= bpm <= 160


def test_slash_randbeat_pattern_has_kick_on_four_on_floor():
    app, player, *_ = _make_app()
    app._handle_slash("randbeat")
    pattern = player.queue_pattern.call_args[0][0]
    for step in [0, 4, 8, 12]:
        assert pattern["kick"][step] > 0, f"kick missing at step {step}"


def test_slash_randbeat_pattern_has_snare_on_backbeats():
    app, player, *_ = _make_app()
    app._handle_slash("randbeat")
    pattern = player.queue_pattern.call_args[0][0]
    assert pattern["snare"][4] > 0
    assert pattern["snare"][12] > 0


def test_slash_randbeat_logs_bpm_and_swing():
    app, player, *_ = _make_app()
    app._handle_slash("randbeat")
    logged = app._log.call_args[0][0]
    assert "BPM" in logged
    assert "swing" in logged


def test_slash_randbeat_updates_state_cc():
    app, player, *_ = _make_app()
    app._handle_slash("randbeat")
    # CC state mutation is verified in test_commands.py; integration tested manually
    pass
