# tests/test_chain.py
from core.state import AppState, TRACK_NAMES


def test_set_chain_stores_names():
    state = AppState()
    state.set_chain(["intro", "drop", "break"])
    assert state.chain == ["intro", "drop", "break"]
    assert state.chain_index == -1
    assert state.chain_auto is False


def test_set_chain_auto_flag():
    state = AppState()
    state.set_chain(["intro", "drop"], auto=True)
    assert state.chain_auto is True


def test_set_chain_empty_list():
    state = AppState()
    state.set_chain([])
    assert state.chain == []
    assert state.chain_index == -1


def test_chain_next_from_unstarted():
    state = AppState()
    state.set_chain(["intro", "drop", "break"])
    result = state.chain_next()
    assert result == "intro"
    assert state.chain_index == 0


def test_chain_next_advances():
    state = AppState()
    state.set_chain(["intro", "drop", "break"])
    state.chain_next()          # intro (index 0)
    result = state.chain_next() # drop  (index 1)
    assert result == "drop"
    assert state.chain_index == 1


def test_chain_next_returns_none_at_end_non_auto():
    state = AppState()
    state.set_chain(["intro", "drop"])
    state.chain_next()  # intro
    state.chain_next()  # drop
    result = state.chain_next()  # end, non-auto
    assert result is None
    assert state.chain_index == 1  # stays at last


def test_chain_next_loops_when_auto():
    state = AppState()
    state.set_chain(["intro", "drop"], auto=True)
    state.chain_next()          # intro (0)
    state.chain_next()          # drop (1)
    result = state.chain_next() # intro again (0)
    assert result == "intro"
    assert state.chain_index == 0


def test_chain_next_empty_returns_none():
    state = AppState()
    result = state.chain_next()
    assert result is None


def test_chain_clear_resets_all():
    state = AppState()
    state.set_chain(["intro", "drop"], auto=True)
    state.chain_next()
    state.chain_clear()
    assert state.chain == []
    assert state.chain_index == -1
    assert state.chain_auto is False


def test_chain_current_before_start():
    state = AppState()
    state.set_chain(["intro", "drop"])
    assert state.chain_current() is None


def test_chain_current_after_next():
    state = AppState()
    state.set_chain(["intro", "drop"])
    state.chain_next()
    assert state.chain_current() == "intro"


def test_chain_current_empty():
    state = AppState()
    assert state.chain_current() is None


def test_reset_clears_chain():
    state = AppState()
    state.set_chain(["intro", "drop"], auto=True)
    state.chain_next()
    pattern = {track: [0] * 16 for track in TRACK_NAMES}
    state.reset(pattern, 120.0, None)
    assert state.chain == []
    assert state.chain_index == -1
    assert state.chain_auto is False


import threading


def test_chain_next_thread_safety():
    state = AppState()
    state.set_chain([str(i) for i in range(10)], auto=True)
    errors = []

    def advance():
        try:
            for _ in range(50):
                state.chain_next()
        except Exception as e:
            errors.append(e)

    def reset_chain():
        try:
            for _ in range(10):
                state.set_chain(["a", "b", "c"], auto=True)
        except Exception as e:
            errors.append(e)

    threads = [threading.Thread(target=advance) for _ in range(5)]
    threads += [threading.Thread(target=reset_chain) for _ in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert errors == [], f"Thread safety errors: {errors}"
    # After concurrent access, chain_index must be a valid index
    with state._lock:
        assert -1 <= state.chain_index < len(state.chain) or state.chain == []
