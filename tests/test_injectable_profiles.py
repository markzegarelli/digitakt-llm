# tests/test_injectable_profiles.py
import pytest

from core.injectable_profiles import (
    InjectableProfile,
    PROFILES_BY_ID,
    build_injectable_context_prefix,
    validate_injectable_profile_registry,
)


def test_validate_rejects_dict_key_id_mismatch():
    p = InjectableProfile(
        id="wrong",
        category="drum_machine",
        aliases=("x",),
        body="y",
    )
    with pytest.raises(ValueError, match="dict key"):
        validate_injectable_profile_registry({"right": p})


def test_validate_rejects_duplicate_alias():
    a = InjectableProfile(
        id="a",
        category="genre",
        aliases=("shared phrase",),
        body="a",
    )
    b = InjectableProfile(
        id="b",
        category="drum_machine",
        aliases=("shared phrase",),
        body="b",
    )
    with pytest.raises(ValueError, match="Duplicate injectable alias"):
        validate_injectable_profile_registry({"a": a, "b": b})


def test_validate_rejects_empty_aliases():
    p = InjectableProfile(
        id="empty",
        category="genre",
        aliases=(),
        body="x",
    )
    with pytest.raises(ValueError, match="no aliases"):
        validate_injectable_profile_registry({"empty": p})


def test_build_prefix_genre_then_machine():
    s = build_injectable_context_prefix("ambient bed with cr-78 swing")
    assert s.startswith("AMBIENT MODE CONTEXT")
    assert "ROLAND CR-78 MACHINE CONTEXT" in s
    assert s.index("AMBIENT MODE CONTEXT") < s.index("ROLAND CR-78 MACHINE CONTEXT")


def test_profiles_by_id_contains_expected_ids():
    assert set(PROFILES_BY_ID.keys()) == {"ambient", "linndrum", "cr78"}
