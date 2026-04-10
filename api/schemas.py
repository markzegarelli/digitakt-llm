# api/schemas.py
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


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


class CCRequest(BaseModel):
    track: str
    param: str
    value: int = Field(..., ge=0, le=127)


class CCResponse(BaseModel):
    track: str
    param: str
    value: int


class StateResponse(BaseModel):
    current_pattern: dict
    pending_pattern: dict | None
    bpm: float
    is_playing: bool
    midi_port_name: str | None
    last_prompt: str | None
    pattern_history: list
    track_cc: dict
    track_muted: dict
    track_velocity: dict
    swing: int = 0


class PatternListResponse(BaseModel):
    names: list[str]


class MuteRequest(BaseModel):
    track: str
    muted: bool


class MuteResponse(BaseModel):
    track: str
    muted: bool


class VelocityRequest(BaseModel):
    track: str
    value: int = Field(..., ge=0, le=127)


class VelocityResponse(BaseModel):
    track: str
    value: int


class ProbRequest(BaseModel):
    track: str
    step: int = Field(..., ge=1, le=16)
    value: int = Field(..., ge=0, le=100)


class SwingRequest(BaseModel):
    amount: int = Field(..., ge=0, le=100)


class VelRequest(BaseModel):
    track: str
    step: int = Field(..., ge=1, le=16)
    value: int = Field(..., ge=0, le=127)


class RandomRequest(BaseModel):
    track: str
    param: str
    lo: int = 0
    hi: int = 127
