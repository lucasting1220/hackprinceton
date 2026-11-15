"""Pydantic models for the contract files in contracts/. The files are the truth."""

from datetime import UTC, date, datetime
from typing import Annotated, Literal, Self

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
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
    bridge_url: str
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
    id: Annotated[str, Field(max_length=64)]
    reason: Annotated[str, Field(max_length=2000)]
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


JobName = Annotated[str, Field(pattern=r"^[a-z][a-z0-9_]{0,63}$")]
"""A job's name, which is also its folder's name."""


class JobStatus(Strict):
    job: JobName
    state: Literal["starting", "running", "restarting"]


class StatusMessage(Strict):
    """Worker to coordinator, every STATUS_INTERVAL_S. Internal to Layer 2: no contract file."""

    type: Literal["status"]
    schema_version: Literal[1]
    missing: Annotated[list[MissingItem], Field(max_length=100)]
    memory_free_gb: Annotated[float, Field(ge=0, strict=True, allow_inf_nan=False)]
    cpu_percent: Annotated[float, Field(ge=0, le=100, strict=True, allow_inf_nan=False)]
    jobs: list[JobStatus] = Field(default_factory=list, max_length=100)


class StartMessage(Strict):
    """Coordinator to worker: run this job. Internal to Layer 2: no contract file. It names the
    job only; the worker finds the command in its own job folder, so a message can never make
    a worker run an arbitrary program."""

    type: Literal["start"]
    schema_version: Literal[1]
    job: JobName


class StopMessage(Strict):
    """Coordinator to worker: stop this job if it is running. Internal to Layer 2."""

    type: Literal["stop"]
    schema_version: Literal[1]
    job: JobName


RequestId = Annotated[str, Field(pattern=r"^[A-Za-z0-9_-]{1,64}$")]
"""Chosen by the worker; the coordinator's reply carries it back."""


class LoggedEvent(Strict):
    """One stored event: Layer 4's opaque event and the coordinator's own time."""

    logged_at: UtcDatetime
    event: dict[str, JsonValue]


class LogAppend(Strict):
    """Worker to coordinator, for a job: store this event. Internal to Layer 2."""

    type: Literal["log_append"]
    schema_version: Literal[1]
    id: RequestId
    event: dict[str, JsonValue]


class LogRead(Strict):
    """Worker to coordinator, for a job: events since a time, or of one UTC day (exactly one
    of the two). Internal to Layer 2."""

    type: Literal["log_read"]
    schema_version: Literal[1]
    id: RequestId
    since: UtcDatetime | None = None
    day: date | None = None

    @model_validator(mode="after")
    def _exactly_one(self) -> Self:
        if (self.since is None) == (self.day is None):
            raise ValueError("give exactly one of since and day")
        return self


class PhoneSend(Strict):
    """Worker to coordinator, for a job's to_phone() call: hand `body` to Layer 1's bridge at
    /v1/<kind>. Internal to Layer 2; the body's fields belong to Layers 1 and 4."""

    type: Literal["phone_send"]
    schema_version: Literal[1]
    id: RequestId
    kind: Literal["alerts", "replies", "status", "reports"]
    body: dict[str, JsonValue]


InboundKind = Literal["requests", "watch-data"]
"""What Layer 1's bridge posts to the coordinator: requests from phones (for Layer 4) and watch
readings (for Layer 3)."""


class Subscribe(Strict):
    """Worker to coordinator: a job on this worker takes `kind` from the bridge. The latest
    subscriber of a kind gets it. Internal to Layer 2."""

    type: Literal["subscribe"]
    schema_version: Literal[1]
    kind: InboundKind


class Deliver(Strict):
    """Coordinator to worker: one message from the bridge, for the job that subscribed to
    `kind`. Internal to Layer 2; the body's fields belong to Layers 1, 3 and 4."""

    type: Literal["deliver"]
    schema_version: Literal[1]
    kind: InboundKind
    body: dict[str, JsonValue]


class StateRead(Strict):
    """Worker to coordinator, for a job's status() call: the same data as /api/state.
    Internal to Layer 2."""

    type: Literal["state_read"]
    schema_version: Literal[1]
    id: RequestId


class Reply(Strict):
    """Coordinator to worker: the answer to a request with the same id. `truncated` means the
    oldest events were left out to fit one message. Internal to Layer 2."""

    type: Literal["reply"]
    schema_version: Literal[1]
    id: RequestId
    ok: StrictBool
    error: str | None = None
    events: list[LoggedEvent] | None = None
    truncated: StrictBool = False
    state: ApiState | None = None


class JobDescription(Strict):
    """contracts/job.json: written by Layers 3 and 4, one per job folder."""

    schema_version: Literal[1]
    name: JobName
    start_command: Annotated[list[Annotated[str, Field(min_length=1)]], Field(min_length=1)]
    kind: Literal["always-on", "per-item"]
    memory_gb: Annotated[float, Field(ge=0, allow_inf_nan=False)]
    sensor: Literal["camera", "mic"] | None


class LaptopHardware(Strict):
    """One laptop on the dashboard's hardware table. Internal to Layer 2: no contract file."""

    node_id: str
    display_name: str
    last_status_at: UtcDatetime
    specs: Specs
    tools: Tools
    memory_free_gb: float | None
    cpu_percent: float | None


class HardwareState(Strict):
    """GET /api/hardware on the dashboard port. Internal to Layer 2: Layer 1 reads only
    /api/state."""

    schema_version: Literal[1]
    updated_at: UtcDatetime
    laptops: list[LaptopHardware]
