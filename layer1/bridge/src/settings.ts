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

/** The owner-only mode for the folders the bridge creates, such as the keys folder. */
export const PRIVATE_DIR_MODE = 0o700;

/** Names inside the state folder, which home.ts owns. The two key files are in `keysDir`. */
export const STATE_NAMES = {
  home: "home.json",
  keysDir: "keys",
  homeKey: "home-key",
  hubPrivateKey: "hub-private-key",
  coordinatorConfig: "coordinator.json",
  acceptedWorkers: "accepted-workers.json",
  coordinatorStop: "coordinator.stop",
  coordinatorStateDir: "coordinator",
} as const;

/** The home key's length in bytes. */
export const HOME_KEY_BYTES = 32;

/** Layer 1 bridge, local side: the setup page, 127.0.0.1 only. */
export const BRIDGE_LOCAL_PORT = 7470;

/** coordinator.json's bridge_url: where the coordinator sends Layer 1's messages for phones. */
export const BRIDGE_URL = `http://127.0.0.1:${BRIDGE_LOCAL_PORT}`;

/** The default state folder: ~/Library/Application Support/Debbie, or %LOCALAPPDATA%\Debbie. */
export const MACOS_APP_DATA_DIRS = ["Library", "Application Support"] as const;
export const WINDOWS_APP_DATA_ENV = "LOCALAPPDATA";
export const STATE_DIR_NAME = "Debbie";
