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
  liveView: "live-view.json",
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

/**
 * The team's name for this laptop's own pages: its DNS record points at 127.0.0.1, so
 * http://home.debbie.health:<port>/ opens the setup page and Layer 2's dashboard on this laptop.
 */
export const HOME_HOST_NAME = "home.debbie.health";

/** The setup page's only Host names (against DNS rebinding), body limit, time limit, token bytes. */
export const SETUP_HOST_NAMES = [LOCAL_HOST, "localhost", HOME_HOST_NAME] as const;
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

/** Layer 1 bridge, network side: pairing and the LAN gateway, on every IPv4 interface. */
export const BRIDGE_NETWORK_PORT = 7480;
export const BRIDGE_NETWORK_HOST = "0.0.0.0";

/**
 * The JSON request limits, on the network side and in step 4's alert intake: the largest body,
 * and the times within which the headers and then the whole request must arrive, or it gets 408.
 */
export const JSON_REQUEST_MAX_BYTES = 16 * 1024;
export const JSON_REQUEST_HEADERS_TIMEOUT_MS = 5_000;
export const JSON_REQUEST_TIMEOUT_MS = 10_000;

/** How often the server checks those two times; Node's default, 30 s, would let a request run 40 s. */
export const JSON_REQUEST_TIMEOUT_CHECK_MS = 1_000;

/** The pairing QR code lists at most this many of the laptop's addresses (phone-hub.md §2.1). */
export const LAN_ADDRESSES_MAX = 4;

/** GET /v1/hello's hub tag: this many first characters of the hub's public key (phone-hub.md §4.1). */
export const HUB_TAG_CHARS = 8;
/** How long a pairing code works before a phone is confirmed (phone-hub.md §2.1): 10 minutes. */
export const PAIRING_CODE_LIFETIME_MS = 10 * 60_000;

/** How long a confirmed phone may collect its bundle after Confirm, even past the code's expiry. */
export const BUNDLE_COLLECTION_MS = 60_000;

/** The pairing QR code's secret, in bytes (§2.1). */
export const PAIRING_SECRET_BYTES = 16;

/** A phone's device credential, in bytes (§4.3). */
export const DEVICE_CREDENTIAL_BYTES = 32;

/** The bundle's home_name, until the setup page asks for a name (§4.3). */
export const HOME_NAME = "Home";

/** A paired phone's plaintext sent_at may be this far from the hub's clock, either way (§2.5). */
export const PHONE_CLOCK_SKEW_MS = 30_000;

/** How long the LAN gateway remembers a phone's msg_id, and at most how many per phone (§2.5). */
export const PHONE_SEEN_IDS_MS = 60_000;
export const PHONE_SEEN_IDS_MAX = 1_000;

/** The LAN gateway logs a phone's wrong clock at most once in this long (R7). */
export const STALE_LOG_INTERVAL_MS = 60_000;

/**
 * The most messages one page holds, on the LAN route (phone-hub.md §4.5) and the relay's (§5); a
 * fetch's limit above this counts as this.
 */
export const MESSAGES_PAGE_MAX = 50;

/** How often the Pair a phone page reloads while it waits for the phone, in seconds. */
export const PAIRING_PAGE_RELOAD_SECONDS = 2;

/** How long a message is kept for phones to fetch: 7 days, in the hub's outbox and at the relay. */
export const MESSAGE_RETENTION_MS = 7 * 24 * 60 * 60_000;

/** Types of which only the newest message per home is kept (phone-hub.md §3): live status. */
export const LATEST_ONLY_TYPES: readonly string[] = ["heartbeat", "care_status"];

/** How often the hub sends the relay a heartbeat: 20 seconds, the doc's demo value. */
export const RELAY_HEARTBEAT_INTERVAL_MS = 20_000;

/** The relay's relay.json and the hub's relay-credential.json are at this schema_version. */
export const RELAY_CONFIG_SCHEMA_VERSION = 1;
export const RELAY_CREDENTIAL_SCHEMA_VERSION = 1;

/** The relay database's schema version, kept in SQLite's user_version. */
export const RELAY_DB_SCHEMA_VERSION = 1;

/** How long a relay database statement waits for a lock before it fails. */
export const RELAY_DB_BUSY_TIMEOUT_MS = 5_000;

/** How often the relay deletes messages past MESSAGE_RETENTION_MS, and how many per statement. */
export const RELAY_SWEEP_INTERVAL_MS = 60 * 60_000;
export const RELAY_SWEEP_BATCH = 500;

/** The hub credential the relay issues, in bytes (43 base64url characters). */
export const HUB_CREDENTIAL_BYTES = 32;

/** The relay's phone API: body and wrapper limit, and header and whole-request time limits. */
export const RELAY_MAX_BODY_BYTES = 64 * 1024;
export const RELAY_HEADERS_TIMEOUT_MS = 10_000;
export const RELAY_REQUEST_TIMEOUT_MS = 15_000;

/** Failed sign-ins from one address within the window that block it, and for how long. */
export const RELAY_SIGNIN_FAILURES_MAX = 20;
export const RELAY_SIGNIN_WINDOW_MS = 60_000;
export const RELAY_SIGNIN_BLOCK_MS = 60_000;

/** The most addresses the sign-in limiter remembers; the least recently seen go first. */
export const RELAY_LIMITER_ADDRESSES_MAX = 10_000;
/** Step 4's outbox of sealed hub → phone messages, in the state folder; only outbox.ts uses it. */
export const OUTBOX_FILE_NAME = "outbox.json";

/** The outbox keeps at most this many messages, each for MESSAGE_RETENTION_MS. */
export const OUTBOX_MESSAGES_MAX = 500;

/** The bytes of an outbox's epoch, the name in its cursors: 12 base64url characters. */
export const OUTBOX_EPOCH_BYTES = 9;

/** An alert's title and body, in Unicode code points (step 4's alert intake). */
export const ALERT_TITLE_MAX_CHARS = 200;
export const ALERT_BODY_MAX_CHARS = 2_000;

/** The alert intake saves an alert identical to one of this many it saved since start only once. */
export const ALERTS_REMEMBERED = 500;

/** The setup page lists at most this many unlisted field names that Layer 2 sent in alerts. */
export const ALERT_UNKNOWN_FIELDS_SHOWN = 10;

/** The largest WebSocket frame the relay takes from a hub: room for one wrapper and its frame. */
export const RELAY_HUB_MAX_FRAME_BYTES = 128 * 1024;

/** How often the relay pings a connected hub, and how long a silent hub keeps its connection. */
export const RELAY_HUB_PING_INTERVAL_MS = 20_000;
export const RELAY_HUB_SILENT_CLOSE_MS = 40_000;

/** How long a phone's command waits at the relay for the hub's answer before 504 hub_timeout. */
export const RELAY_COMMAND_TIMEOUT_MS = 5_000;

/** Live view (phone-hub.md §7): the paths at the relay. */
export const LIVE_VIEW_PATH = "/v1/live-view";
/** How long one live view session lasts, and its TURN login with it: a setting, not a limit. */
export const LIVE_VIEW_SESSION_MS = 5 * 60_000;
/** How long a session may take to become ready: the hub's answer and the sender's sign-in. */
export const LIVE_VIEW_START_WAIT_MS = 30_000;
/** How long an ended session still answers its status, so the phone can read why it ended. */
export const LIVE_VIEW_ENDED_KEPT_MS = 10 * 60_000;
/** The sender's token for the session's signaling: random bytes. */
export const LIVE_VIEW_SENDER_TOKEN_BYTES = 32;
/** The sender's first signaling message, with its token, must arrive within this time. */
export const LIVE_VIEW_HELLO_TIMEOUT_MS = 5_000;
/** The largest signaling message: an SDP offer with its candidates fits several times over. */
export const LIVE_VIEW_SIGNAL_MAX_BYTES = 16 * 1024;
/** Messages one signaling socket may send in a session; a runaway peer is cut off after them. */
export const LIVE_VIEW_SIGNAL_MESSAGES_MAX = 1_000;
/** The signaling socket's close codes: the session ended, a newer socket replaced it, or refused. */
export const LIVE_VIEW_CLOSE = { ended: 4000, replaced: 4001, refused: 4003 } as const;

/** Apple's push service for each APNs environment (phone-hub.md §8). */
export const APNS_ORIGINS = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
} as const;

/** How long one APNs request may take, connection included, before it counts as failed. */
export const APNS_REQUEST_TIMEOUT_MS = 10_000;

/** An APNs connection idle this long is closed, and opened again on the next push. */
export const APNS_SESSION_IDLE_MS = 30 * 60_000;

/** A provider token is renewed after 40 minutes: Apple refuses one older than 60, or a renewal within 20. */
export const APNS_TOKEN_RENEW_MS = 40 * 60_000;

/** The waits before each retry of a push Apple answered 429 or 5xx, or never answered; then it gives up. */
export const APNS_RETRY_DELAYS_MS: readonly number[] = [1_000, 5_000, 15_000];

/** The most bytes of an APNs answer's body the relay reads; Apple's are a few dozen. */
export const APNS_ANSWER_MAX_BYTES = 4_096;

/** Apple's limit on a push payload; a larger alert is pushed in its truncated form (phone-hub.md §8.1). */
export const APNS_PAYLOAD_MAX_BYTES = 4_096;

/** How long Apple keeps trying to deliver an alert push, and a hub offline or back online push. */
export const PUSH_ALERT_EXPIRY_MS = 24 * 60 * 60_000;
export const PUSH_HUB_STATUS_EXPIRY_MS = 60 * 60_000;

/** At start, the relay pushes alerts it stored this recently but never pushed (R13). */
export const RELAY_REPUSH_WINDOW_MS = 10 * 60_000;

/** Build step 3, Add a laptop: the join (phone-hub.md §6) and the worker laptop's files. */
/** How long a laptop's join code works before a caregiver approves it: 10 minutes. */
export const JOIN_CODE_LIFETIME_MS = 10 * 60_000;

/** The most joins the hub keeps waiting for approval at once. */
export const JOINS_PENDING_MAX = 8;

/** How long the new laptop waits for each answer from the home laptop's bridge. */
export const JOIN_REQUEST_TIMEOUT_MS = 3_000;

/** How often the new laptop asks whether its join was approved, and its page reloads. */
export const JOIN_POLL_MS = 2_000;

/** The join token: this many random bytes, written as twice as many lowercase hex characters. */
export const JOIN_TOKEN_BYTES = 32;

/** Names in a worker laptop's state folder; Layer 2 writes the status file and the worker folder. */
export const WORKER_STATE_NAMES = {
  laptop: "laptop.json",
  workerConfig: "worker.json",
  workerToken: "worker-token",
  workerStatus: "worker-status.json",
  workerStop: "worker.stop",
  workerPid: "worker.pid",
  workerStateDir: "worker",
} as const;

/** worker.json's frame_feed_port: Layer 3's frame feed on this laptop (CLAUDE.md section 9). */
export const FRAME_FEED_PORT = 7460;

/** The labelled stand-in for Layer 2's worker, relative to the repository root. */
export const WORKER_STUB_PATH = ["layer1", "stubs", "fake-layer2-worker.ts"] as const;

/** The Python version worker.json's python names, and how long finding it may take. */
export const WORKER_PYTHON_VERSION = "3.12";
export const PYTHON_FIND_TIMEOUT_MS = 10_000;

/** How long Layer 2's check may run; its first run builds Layer 2's environment. */
export const WORKER_CHECK_TIMEOUT_MS = 180_000;

/** How often the bridge reads the worker's status file. */
export const WORKER_STATUS_POLL_MS = 500;

/** After this long still disconnected, the page says what to check. */
export const WORKER_CONNECT_HINT_MS = 30_000;

/** How often a worker laptop's bridge reports to the home laptop's bridge over the link. */
export const LINK_REPORT_MS = 5_000;

/** The longest camera or mic name the joined laptop's page saves into worker.json, in characters. */
export const SENSOR_NAME_MAX_CHARS = 128;
/** How often the relay looks for its stop file (relay.json's stop_file), and its stop deadline. */
export const RELAY_STOP_POLL_MS = 1_000;
export const RELAY_STOP_DEADLINE_MS = 10_000;

/** How long the relay may take to start listening, and to finish pushes in flight when it stops. */
export const RELAY_LISTEN_TIMEOUT_MS = 5_000;
export const RELAY_PUSH_DRAIN_MS = 5_000;

/** How long the bridge waits for Layer 2's coordinator to take a phone's request or watch data. */
export const COORDINATOR_REQUEST_TIMEOUT_MS = 2_000;

/** A caregiver's `ask` request: its text, in Unicode code points. */
export const REQUEST_TEXT_MAX_CHARS = 1_000;

/** The bridge remembers which phone sent each request for this long, and at most this many. */
export const REQUEST_REPLY_WINDOW_MS = 60 * 60_000;
export const REQUESTS_REMEMBERED = 1_000;

/** A reply's and a daily report's title and body, in Unicode code points. */
export const HANDOFF_TITLE_MAX_CHARS = 200;
export const REPLY_BODY_MAX_CHARS = 4_000;
export const REPORT_BODY_MAX_CHARS = 8_000;

/** The hub credential file in the state folder (relay-credential.ts reads and writes it). */
export const RELAY_CREDENTIAL_FILE_NAME = "relay-credential.json";

/** `relay-credential.ts import` reads at most this much from stdin, within this time. */
export const RELAY_CREDENTIAL_IMPORT_MAX_BYTES = 4_096;
export const RELAY_CREDENTIAL_IMPORT_TIMEOUT_MS = 30_000;

/** How long the relay link waits for the relay to open its connection, or to answer a check. */
export const RELAY_LINK_CONNECT_TIMEOUT_MS = 10_000;

/** The relay link's waits before each reconnection; the last repeats. */
export const RELAY_LINK_BACKOFF_MS: readonly number[] = [1_000, 2_000, 5_000, 10_000, 15_000];

/** A connection that lasted this long starts the waits from the first again. */
export const RELAY_LINK_BACKOFF_RESET_MS = 60_000;

/** After the relay refuses the hub credential, the link tries again this often. */
export const RELAY_LINK_REJECTED_RETRY_MS = 5 * 60_000;

/** A heartbeat with no acknowledgment within this long means the connection is dead. */
export const RELAY_LINK_ACK_TIMEOUT_MS = 10_000;

/** The most outbox messages sent to the relay and not yet acknowledged. */
export const RELAY_LINK_IN_FLIGHT_MAX = 20;

/** Keep-awake on macOS: caffeinate, which holds off idle sleep until the bridge's process ends. */
export const KEEP_AWAKE_MACOS_FILE = "/usr/bin/caffeinate";

/** Keep-awake on Windows: Windows PowerShell, which ships with every supported version. */
export const KEEP_AWAKE_WINDOWS_FILE = "powershell.exe";

/** How long the keep-awake helper may take to start, and to end once the bridge stops it. */
export const KEEP_AWAKE_START_TIMEOUT_MS = 5_000;
export const KEEP_AWAKE_STOP_TIMEOUT_MS = 5_000;

/** The pairing and join QR codes' size on the page, in CSS pixels, small enough to fit a phone camera. */
export const QR_DISPLAY_PX = 320;

/** The `schema_version` of the watch data the bridge posts (contracts/watch-data.json). */
export const WATCH_DATA_SCHEMA_VERSION = 1;

/** The range every watch reading's time must fall in (contracts/README.md, what Layer 4 accepts). */
export const WATCH_READING_EARLIEST_AT = "1970-01-02T00:00:00Z";
export const WATCH_READING_LATEST_AT = "2999-12-31T00:00:00Z";

/** The network test (npm run net:test): how long it waits for the bridge's GET /v1/hello. */
export const NETWORK_TEST_HELLO_TIMEOUT_MS = 3_000;

/** The network test: how long it waits for a TCP connection to the coordinator's worker port. */
export const NETWORK_TEST_COORDINATOR_TIMEOUT_MS = 3_000;

/** The network test: how long it waits for the relay's GET /healthz, over the internet. */
export const NETWORK_TEST_RELAY_TIMEOUT_MS = 10_000;
