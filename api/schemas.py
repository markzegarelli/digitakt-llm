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


class CCFocusedTrackRequest(BaseModel):
    track: str


class CCRequest(BaseModel):
    track: str
    param: str
    value: int = Field(..., ge=0, le=127)


class CCResponse(BaseModel):
    track: str
    param: str
    value: int


class LengthRequest(BaseModel):
    steps: int

    @field_validator("steps")
    @classmethod
    def steps_must_be_valid(cls, v: int) -> int:
        if v not in (8, 16, 32):
            raise ValueError("steps must be 8, 16, or 32")
        return v


class LengthResponse(BaseModel):
    steps: int


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
    track_pitch: dict
    swing: int = 0
    pattern_length: int = 16
    chain: list[str] = []
    chain_index: int = -1
    chain_auto: bool = False
    chain_queued_index: int | None = None
    chain_armed: bool = False


class SavePatternRequest(BaseModel):
    tags: list[str] = []


class PatternEntry(BaseModel):
    name: str
    tags: list[str]


class PatternListResponse(BaseModel):
    patterns: list[PatternEntry]


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
    step: int = Field(..., ge=1, le=32)
    value: int = Field(..., ge=0, le=100)


class ProbTrackRequest(BaseModel):
    track: str
    value: int = Field(..., ge=0, le=100)


class SwingRequest(BaseModel):
    amount: int = Field(..., ge=0, le=100)


class VelRequest(BaseModel):
    track: str
    step: int = Field(..., ge=1, le=32)
    value: int = Field(..., ge=0, le=127)


class VelTrackRequest(BaseModel):
    track: str
    value: int = Field(..., ge=0, le=127)


class RandomRequest(BaseModel):
    track: str
    param: str
    lo: int = 0
    hi: int = 127


class CCStepRequest(BaseModel):
    track: str
    param: str
    step: int = Field(..., ge=1, le=32)   # 1-indexed
    value: int = Field(..., ge=-1, le=127)  # -1 = clear override


class GateRequest(BaseModel):
    track: str
    step: int = Field(..., ge=1, le=32)
    value: int = Field(..., ge=0, le=100)


class GateTrackRequest(BaseModel):
    track: str
    value: int = Field(..., ge=0, le=100)


class GateResponse(BaseModel):
    track: str
    step: int
    value: int


class PitchRequest(BaseModel):
    track: str
    value: int = Field(..., ge=0, le=127)


class PitchResponse(BaseModel):
    track: str
    value: int


class CondRequest(BaseModel):
    track: str
    step: int = Field(..., ge=1, le=32)
    value: str | None = None


class CondResponse(BaseModel):
    track: str
    step: int
    value: str | None


class CCParamEntry(BaseModel):
    name: str
    cc: int
    default: int


class CCParamsResponse(BaseModel):
    params: list[CCParamEntry]


class AskRequest(BaseModel):
    question: str

    @field_validator("question")
    @classmethod
    def question_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("question must not be empty")
        return v.strip()


class AskResponse(BaseModel):
    answer: str
    is_implementable: bool = False


class ChainRequest(BaseModel):
    names: list[str] = Field(min_length=1)
    auto: bool = False
