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

/**
 * Names inside the state folder. phones.ts owns phones.json and home.ts owns the rest; the two key
 * files are in `keysDir`.
 */
export const STATE_NAMES = {
  home: "home.json",
  keysDir: "keys",
  homeKey: "home-key",
  hubPrivateKey: "hub-private-key",
  coordinatorConfig: "coordinator.json",
  acceptedWorkers: "accepted-workers.json",
  coordinatorStop: "coordinator.stop",
  coordinatorStateDir: "coordinator",
  bridgeStop: "bridge.stop",
  phones: "phones.json",
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
/** The labelled stand-in for Layer 2's coordinator, relative to the repository root. */
export const COORDINATOR_STUB_PATH = ["layer1", "stubs", "fake-layer2-coordinator.ts"] as const;

/** Layer 2's folder, relative to the repository root, and the file that declares its scripts. */
export const LAYER2_PROJECT_DIR = "layer2";
export const LAYER2_PYPROJECT_FILE = "pyproject.toml";

/** How long ending the coordinator's processes may take after the stop deadline. */
export const COORDINATOR_TREE_STOP_TIMEOUT_MS = 5_000;

/** The waits before each restart after a crash; the last one repeats. */
export const COORDINATOR_RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

/** How long the coordinator has to exit once its stop file appears (contracts/README.md). */
export const COORDINATOR_STOP_DEADLINE_MS = 10_000;

/** A coordinator that ran this long before it crashed restarts after the first wait again. */
export const COORDINATOR_BACKOFF_RESET_MS = 60_000;

/** The loopback address that Layer 2's dashboard and the bridge's local side listen on. */
export const LOCAL_HOST = "127.0.0.1";

/** How long the launcher waits to connect when it checks whether the dashboard port is in use. */
export const COORDINATOR_PROBE_TIMEOUT_MS = 500;

/** How often the launcher checks whether a coordinator left running has taken its stop file. */
export const COORDINATOR_STOP_POLL_MS = 100;

/** The setup page's only Host names (against DNS rebinding), body limit, time limit, token bytes. */
export const SETUP_HOST_NAMES = [LOCAL_HOST, "localhost"] as const;
export const SETUP_MAX_BODY_BYTES = 1_024;
export const SETUP_REQUEST_TIMEOUT_MS = 10_000;
export const SETUP_TOKEN_BYTES = 32;

/** How long the command that opens the setup page in the default browser may run. */
export const BROWSER_OPEN_TIMEOUT_MS = 10_000;

/** How often the bridge checks for its stop file, which ends it as a stop signal does. */
export const BRIDGE_STOP_POLL_MS = 250;

/** The length in bytes of each phone's own key, which pairing derives and phones.json keeps. */
export const PHONE_KEY_BYTES = 32;

/** The error correction level of every QR code the bridge draws (contracts/phone-hub.md §2.1). */
export const QR_ERROR_CORRECTION = "M";

/** The light border around every QR code the bridge draws, in modules (phone-hub.md §2.1). */
export const QR_BORDER_MODULES = 4;
