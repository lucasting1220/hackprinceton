/**
 * Layer 1 named constants: the ports and addresses the bridge uses (CLAUDE.md section 10).
 * Layer 2's programs receive their ports through coordinator.json, which the bridge writes from these.
 */

/** Layer 2 coordinator: worker control and media, reachable on the local network. */
export const COORDINATOR_LISTEN_PORT = 7443;

/** Layer 2 dashboard, with its JSON at /api/state. */
export const DASHBOARD_PORT = 7450;

/** Layer 2 coordinator: local calls from Layer 1's bridge, 127.0.0.1 only. */
export const COORDINATOR_CLIENT_PORT = 7451;

/** The Ollama server that Ollama's own app runs on each laptop. */
export const OLLAMA_URL = "http://127.0.0.1:11434";

/** How long a file operation is retried while Windows reports the file busy (Layer 2: 1 s). */
export const FILE_BUSY_RETRY_MS = 1000;

/** The pause between those retries (Layer 2: 50 ms). */
export const FILE_BUSY_STEP_MS = 50;

/** The owner-only mode for files the bridge creates; on Windows the profile's permissions apply. */
export const PRIVATE_FILE_MODE = 0o600;
