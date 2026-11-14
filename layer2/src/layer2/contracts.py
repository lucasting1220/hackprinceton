"""Pydantic models for the contract files in contracts/. The files are the truth."""

from typing import Annotated, Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Port = Annotated[int, Field(ge=1, le=65535)]
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
    required: bool


class WorkerStatus(Strict):
    schema_version: Literal[1]
    node_id: str
    state: Literal["connected", "rejected", "disconnected"]
    missing: list[MissingItem]
    updated_at: AwareDatetime


class CheckOutput(Strict):
    schema_version: Literal[1]
    ok: bool
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
    ollama: bool
    llama_cpp: bool


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
    last_status_at: AwareDatetime
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
    updated_at: AwareDatetime
    laptops: list[Laptop]
    jobs: list[JobEntry]
    dropped: list[DroppedWork]
