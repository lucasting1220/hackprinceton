"""Pydantic models for the contract files in contracts/. The files are the truth."""

from datetime import UTC, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    model_validator,
)

Port = Annotated[StrictInt, Field(ge=1, le=65535)]


def _to_utc(value: datetime) -> datetime:
    return value.astimezone(UTC)


UtcDatetime = Annotated[AwareDatetime, AfterValidator(_to_utc)]
"""Any time with an offset is accepted and converted, so files are always written in UTC."""
TokenHash = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]


class Strict(BaseModel):
    """Base for every contract model: unknown fields are an error."""

    model_config = ConfigDict(extra="forbid", frozen=True)


class CoordinatorConfig(Strict):
    schema_version: Literal[1]
    home_id: str
    listen_port: Port
    dashboard_port: Port
    client_port: Port
    ollama_url: str
    accepted_workers_file: str
    state_dir: str
    stop_file: str

    @model_validator(mode="after")
    def _ports_differ(self) -> Self:
        if len({self.listen_port, self.dashboard_port, self.client_port}) != 3:
            raise ValueError("listen_port, dashboard_port and client_port must all differ")
        return self


class WorkerConfig(Strict):
    schema_version: Literal[1]
    home_id: str
    node_id: str
    display_name: str
    coordinator_url: str
    token_file: str
    camera: str | None
    mic: str | None
    frame_feed_port: Port
    ollama_url: str
    python: str
    status_file: str
    stop_file: str
    state_dir: str


class AcceptedWorker(Strict):
    node_id: str
    display_name: str
    token_sha256: TokenHash


class AcceptedWorkers(Strict):
    schema_version: Literal[1]
    workers: list[AcceptedWorker]

    @model_validator(mode="after")
    def _no_duplicates(self) -> Self:
        for key in ("node_id", "token_sha256"):
            values = [getattr(worker, key) for worker in self.workers]
            if len(values) != len(set(values)):
                raise ValueError(f"two workers share the same {key}")
        return self


class MissingItem(Strict):
    id: str
    reason: str
    required: StrictBool


class WorkerStatus(Strict):
    schema_version: Literal[1]
    node_id: str
    state: Literal["connected", "rejected", "disconnected"]
    missing: list[MissingItem]
    updated_at: UtcDatetime


class CheckOutput(Strict):
    schema_version: Literal[1]
    ok: StrictBool
    missing: list[MissingItem]


class Specs(Strict):
    os: Literal["macos", "windows"]
    os_version: str
    cpu: str
    cores: int
    memory_gb: int
    gpu: Literal["apple-silicon", "nvidia", "none"]


class Sensors(Strict):
    camera: str | None
    mic: str | None


class Tools(Strict):
    python: str
    ollama: StrictBool
    llama_cpp: StrictBool


class Hello(Strict):
    """Errors never echo their input, so a nearly valid token cannot reach a log."""

    model_config = ConfigDict(extra="forbid", frozen=True, hide_input_in_errors=True)

    type: Literal["hello"]
    schema_version: Literal[1]
    token: Annotated[str, Field(pattern=r"^[0-9a-f]{64}$", repr=False)]
    display_name: str
    specs: Specs
    sensors: Sensors
    tools: Tools


class WelcomeAccepted(Strict):
    type: Literal["welcome"]
    schema_version: Literal[1]
    accepted: Literal[True]
    node_id: str


class WelcomeRejected(Strict):
    type: Literal["welcome"]
    schema_version: Literal[1]
    accepted: Literal[False]
    reason: Literal["unknown_token"]


class Laptop(Strict):
    node_id: str
    display_name: str
    last_status_at: UtcDatetime
    sensors: list[Literal["camera", "mic"]]
    missing: list[MissingItem]


class JobEntry(Strict):
    job: str
    node_id: str
    state: str


class DroppedWork(Strict):
    work: str
    reason: str


class ApiState(Strict):
    schema_version: Literal[1]
    updated_at: UtcDatetime
    laptops: list[Laptop]
    jobs: list[JobEntry]
    dropped: list[DroppedWork]


class StatusMessage(Strict):
    """Worker to coordinator, every STATUS_INTERVAL_S. Internal to Layer 2: no contract file."""

    type: Literal["status"]
    schema_version: Literal[1]
    missing: Annotated[list[MissingItem], Field(max_length=100)]
    memory_free_gb: Annotated[float, Field(ge=0, strict=True, allow_inf_nan=False)]
    cpu_percent: Annotated[float, Field(ge=0, le=100, strict=True, allow_inf_nan=False)]
