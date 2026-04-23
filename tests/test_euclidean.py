import pytest

from core.euclidean import (
    SEQ_MODE_EUCLIDEAN,
    SEQ_MODE_STANDARD,
    bjorklund,
    clamp_euclid_triplet,
    default_euclid_block,
    normalize_euclid_in_pattern,
    normalize_seq_mode,
    rhythm_hit,
    track_euclidean_hit,
)


def test_bjorklund_3_8():
    assert bjorklund(3, 8) == [False, False, True, False, False, True, False, True]


def test_bjorklund_5_8():
    assert bjorklund(5, 8) == [False, True, False, True, True, False, True, True]


def test_bjorklund_edges():
    assert bjorklund(0, 8) == [False] * 8
    assert bjorklund(8, 8) == [True] * 8
    assert bjorklund(1, 1) == [True]
    assert bjorklund(0, 1) == [False]


def test_bjorklund_n1_k0():
    assert bjorklund(0, 1) == [False]


def test_bjorklund_invalid():
    with pytest.raises(ValueError):
        bjorklund(3, 0)
    with pytest.raises(ValueError):
        bjorklund(9, 8)
    with pytest.raises(ValueError):
        bjorklund(-1, 8)


def test_rhythm_hit_rotation():
    ring = bjorklund(3, 8)
    for s in range(8):
        assert rhythm_hit(3, 8, 0, s) == ring[s]
    # r=1 shifts which master step reads which ring index
    assert rhythm_hit(3, 8, 1, 0) == ring[1]


def test_normalize_seq_mode():
    assert normalize_seq_mode(None) == SEQ_MODE_STANDARD
    assert normalize_seq_mode("euclidean") == SEQ_MODE_EUCLIDEAN
    assert normalize_seq_mode("grid") == SEQ_MODE_STANDARD


def test_clamp_euclid_triplet():
    assert clamp_euclid_triplet(10, 5, 0) == (5, 5, 0)
    assert clamp_euclid_triplet(-1, 8, 99) == (0, 8, 3)


def test_normalize_euclid_in_pattern():
    tracks = ("kick", "snare")
    p: dict = {"kick": [0, 0], "snare": [0, 0]}
    normalize_euclid_in_pattern(p, 2, tracks)
    assert p["seq_mode"] == SEQ_MODE_STANDARD
    assert set(p["euclid"].keys()) == {"kick", "snare"}
    assert p["euclid"]["kick"] == {"k": 2, "n": 2, "r": 0}


def test_track_euclidean_hit_respects_row():
    tracks = ("kick", "snare")
    p = {
        "seq_mode": SEQ_MODE_EUCLIDEAN,
        "euclid": {"kick": {"k": 1, "n": 4, "r": 0}, "snare": {"k": 4, "n": 4, "r": 0}},
    }
    normalize_euclid_in_pattern(p, 16, tracks)
    # k=1,n=4 → single hit (Bresenham ring places the lone pulse at index 3)
    assert track_euclidean_hit(p, "kick", 3) is True
    assert track_euclidean_hit(p, "kick", 0) is False


def test_default_euclid_block():
    b = default_euclid_block(16, ("a", "b"))
    assert b["a"] == {"k": 16, "n": 16, "r": 0}
