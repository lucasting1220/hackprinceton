# Contracts between layers

Each file here is an example of something two layers both depend on. The file is the truth; code follows it. Change a file only through a pull request that every affected layer's owner approves (see `CLAUDE.md`, section 9). Every file carries `schema_version`; a change that existing code cannot read raises it.

## Layer 1 and Layer 2

Agreed Nov 14 from Layer 1's asks L1 to L5, L7 and L8. Layer 1 writes the config files; Layer 2's coordinator and worker read them.

| File | Written by | Read by | What it is |
|---|---|---|---|
| `coordinator.json` | Layer 1 | Layer 2 coordinator | The coordinator's configuration |
| `worker.json` | Layer 1 | Layer 2 worker, Layer 3 capture | A worker's configuration |
| `accepted-workers.json` | Layer 1 | Layer 2 coordinator | Hashes of the join tokens the coordinator accepts |
| `worker-status.json` | Layer 2 worker | Layer 1 bridge | Whether the worker is connected, rejected or disconnected |
| `check-output.json` | Layer 2 `check` command | Layer 1 bridge | What a laptop is missing, printed by `check --config <file> --json` |
| `api-state.json` | Layer 2 coordinator, at `GET /api/state` on `dashboard_port` | Layer 1 hub connector | Connected laptops, running jobs, dropped work |
| `hello.json` | Layer 2 worker | Layer 2 coordinator | First message on a worker's connection. Layer 1 depends only on the token being its credential |
| `welcome-accepted.json`, `welcome-rejected.json` | Layer 2 coordinator | Layer 2 worker | The reply to `hello`. Its outcome reaches Layer 1 through the worker status file |

### Rules that go with these files

- **Paths** in config files are absolute.
- **Token:** 64 lowercase hex characters, in `token_file` with no newline, readable only by the user running the bridge. `token_sha256` is the SHA-256 of those 64 characters, in lowercase hex. The example token in `hello.json` hashes to the example in `accepted-workers.json`. Tokens never appear in logs or on command lines, and neither program logs a whole `hello`.
- **Token check:** the coordinator re-reads `accepted-workers.json` on every `hello` and finds the laptop's `node_id` from the token's hash. On an unknown token it sends `welcome-rejected` and closes the connection.
- **Reconnecting:** a `hello` from a laptop the coordinator already knows replaces that laptop's old connection. A disconnected worker keeps running, writes `disconnected` to its status file, and retries every few seconds, re-reading `coordinator_url` from `worker.json` before each try.
- **Status file `state`:** `connected` (only after an accepting `welcome`), `rejected` or `disconnected`.
- **Sensors:** `camera` and `mic` in `worker.json` name the only devices that may be used, or are `null` when there is none or the resident declined it. Built-in cameras and mics are not used unless named.
- **`check`:** installs nothing. `ok` is false only when a required item is missing, and then `check` exits with code 4. Ollama and llama.cpp are never required.
- **Exit codes** for the coordinator and worker: 0 stopped normally, 2 bad config, 3 token rejected, 1 anything else. A missing item never makes a program exit.
- **Stop file:** when the file named by `stop_file` appears, the program stops its jobs and exits within 10 seconds.
- **Ollama:** programs use the Ollama server already running at `ollama_url`; they never start their own.
- **Transport:** plain WebSocket between workers and the coordinator on the demo network (the phone hotspot).
- **Writing files:** every JSON file is written whole, to a temporary file in the same folder and then renamed over the old one, retried if Windows reports the file busy.
- **Times** are ISO 8601 in UTC and field names for times end in `_at`.
