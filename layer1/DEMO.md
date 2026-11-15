# Demo day: Layer 1 runbook

This runbook sets up a Debbie home for the demo, step by step, and sends one stub alert to the caregiver's iPhone at home and away. The design is in `docs/layer1-join-and-connect.md`. Deploying the relay itself is in `relay/deploy/RUNBOOK.md`; this runbook assumes the relay is already running.

Steps marked **(not yet tested on real hardware)** have passed only in tests on one laptop. Record each check as PASS, FAIL, BLOCKED or NOT RUN, with the laptop or phone it ran on.

Live view (the doc's build step 7) isn't built, so this runbook has no step for it yet.

## 1. Prerequisites

1. Node 24 on every laptop, the version in `layer1/.nvmrc`. Check: `node --version` prints `v24.` and more. On a Mac where Homebrew's default `node` is newer, install `node@24` with `brew install node@24` and put it first on PATH in every Terminal window before `npm` or `node`; on Apple silicon: `export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`. On Windows, install Node 24.
2. uv on every laptop, for Layer 2's programs and Python 3.12. Check: `uv --version` prints a version.
3. The repository on every laptop, at the latest `main`. Then install Layer 1's packages:

   ```sh
   cd <repo>/layer1
   git pull
   npm ci
   ```

4. The team's hotspot is on, and every laptop and the iPhone (or both iPhones, if the team has two) are connected to it. The whole demo runs on the hotspot. Check: each laptop can reach the coordinator laptop's address once you know it (step 2.3).
5. On the coordinator laptop: an SSH key that the relay server accepts for the `debbie` user, from a network that the relay's firewall allows (`relay/deploy/RUNBOOK.md`, step 0).
6. On the iPhones: the Debbie app installed, notifications allowed, Focus and Do Not Disturb off.
7. On the camera laptop: the webcam plugged in, and Continuity Camera off on any iPhone signed in to the same Apple ID.
8. Every laptop stays plugged in to power with its lid open for the whole demo. The bridge's keep-awake (`bridge/src/keep-awake.ts`) can't stop sleep when a lid closes, and on macOS its hold on system sleep works only on AC power. On Windows, also set what closing the lid does to **Do nothing** (Control Panel → Power Options → Choose what closing the lid does).
9. Start every bridge from Terminal.app (PowerShell on Windows), not from VS Code's or another app's terminal. From macOS 15, programs started by other apps can't reach the local network until that app is allowed under System Settings → Privacy & Security → Local Network (the doc's "Network permissions").

Run every laptop command below from `<repo>/layer1` unless it says otherwise.

## 2. On the coordinator laptop: start the bridge and create a home

1. Open Terminal.app and start the bridge:

   ```sh
   npm start
   ```

   The setup page opens in the browser. If macOS asks whether `node` may accept incoming connections, choose **Allow**.
2. Choose **Create a home**. Check: the page shows "Home created", a Home ID, `Remote access: not set up` and `Coordinator: running`.
3. Note the coordinator's address. It is shown under **Laptops** on the same page, for example `192.168.1.20`. The camera laptop needs it in step 5.
4. Copy the Home ID. The relay needs it in step 3.
5. Run the network test, the doc's [demo] network test, on the demo hotspot. On each other laptop, from `<repo>/layer1`, run this with the coordinator's address from step 2.3:

   ```sh
   npm run net:test -- --coordinator <address> --relay https://relay.144-202-5-15.sslip.io
   ```

   It prints PASS, FAIL or SKIP for each check (the coordinator's `hello` on port 7480, the coordinator's port 7443 and the relay's `/healthz`) and exits 0 when all pass. On each iPhone, open `http://<address>:7480/v1/hello` in Safari: a short JSON page means the phone reaches the coordinator. Check: every line is PASS, and every iPhone shows the JSON page. **(not yet tested on real hardware)**

## 3. On the relay: provision the home and import its hub credential

1. In a second Terminal window on the coordinator laptop, set the relay target:

   ```sh
   RELAY=debbie@144.202.5.15
   ```

2. Provision the home and import its hub credential in one command. Replace `<home ID>` with the Home ID from step 2.4. The credential goes from the relay's output straight into the bridge's state folder; nothing prints it.

   ```sh
   ssh "$RELAY" 'sudo -u debbie-relay /opt/node/bin/node /opt/debbie/layer1/relay/src/admin.ts provision --config /etc/debbie-relay/relay.json --home-id <home ID>' | node bridge/src/relay-credential.ts import
   ```

   If the bridge runs with `--state-dir <folder>`, add the same `--state-dir <folder>` after `import`. A home that already has a credential is refused (exit 2); to issue a new one, add `--replace` after `<home ID>`, which cuts the old credential off.

   If the coordinator laptop can't SSH to the relay (the relay's firewall allows port 22 only from the team's listed addresses, `relay/deploy/RUNBOOK.md` step 0), provision from a laptop that can, into a file only you can read in its home folder. This is the one time the credential sits on another laptop, so delete every copy as soon as it is imported. On that laptop:

   ```sh
   RELAY=debbie@144.202.5.15
   ( umask 077; ssh "$RELAY" 'sudo -u debbie-relay /opt/node/bin/node /opt/debbie/layer1/relay/src/admin.ts provision --config /etc/debbie-relay/relay.json --home-id <home ID>' > "$HOME/debbie-relay-credential.json" )
   ```

   Move the file to the coordinator laptop by AirDrop or a USB drive, never by chat or email. On the coordinator laptop, from `<repo>/layer1`, import it, with `--state-dir <folder>` after `import` if the bridge uses one (`<file>` is where the file landed, for example `"$HOME/Downloads/debbie-relay-credential.json"` after AirDrop):

   ```sh
   node bridge/src/relay-credential.ts import < <file>
   ```

   On a Windows coordinator, in PowerShell:

   ```powershell
   Get-Content -Raw <file> | node bridge/src/relay-credential.ts import
   ```

   Check: it prints `Saved. Restart the bridge to connect to the relay.` Then delete every copy: the received file on the coordinator, `$HOME/debbie-relay-credential.json` on the other laptop, any copy on the USB drive, and empty the Trash (the Recycle Bin on Windows) on both. Never `cat` the file, or open it in an editor.
3. Check: `ls -l "$HOME/Library/Application Support/Debbie/relay-credential.json"` shows `-rw-------`. Never `cat` this file. On a Windows coordinator, in PowerShell, `Test-Path "$env:LOCALAPPDATA\Debbie\relay-credential.json"` prints `True`.
4. Restart the bridge so it reads the credential. In the bridge's state folder, create the stop file, wait for the bridge to print `L1 bridge: stopped`, then start it again:

   ```sh
   touch "$HOME/Library/Application Support/Debbie/bridge.stop"
   npm start
   ```

   On a Windows coordinator, in PowerShell:

   ```powershell
   New-Item -ItemType File "$env:LOCALAPPDATA\Debbie\bridge.stop"
   npm start
   ```

   Ctrl+C in the bridge's window also stops it.
5. Check: the setup page shows `Remote access: connected to the relay since <time>`. On the relay, `ssh "$RELAY" 'sudo -u debbie-relay /opt/node/bin/node /opt/debbie/layer1/relay/src/admin.ts status --config /etc/debbie-relay/relay.json'` lists the home with `hub_connected` true.

## 4. Pair the iPhones

Pair after step 3, so the pairing carries the relay's address. A phone paired before then reaches home only on home Wi-Fi and must pair again.

1. On the coordinator's setup page, press **Pair a phone**. A QR code shows, valid for 10 minutes.
2. On the caregiver iPhone, open the Debbie app, allow Local Network access, scan the code and choose **Caregiver**. Give it a name of up to 64 characters.
3. The laptop and the phone show the same 4-digit code. Check that they match, then press **Confirm** on the laptop. Check: the page says the phone "is paired as" a caregiver, and the phone appears under Phones.
4. Pair the resident iPhone the same way, choosing **Resident**. With one iPhone, pair it as a caregiver and turn on resident mode in the app instead. **(not yet tested on real hardware)**

## 5. On the camera laptop: join the home and set the camera and mic

1. Open Terminal.app directly on the camera laptop (not over SSH, and not inside tmux or screen, because macOS gives the camera and mic permission to the app that started the bridge) and start the bridge:

   ```sh
   npm start
   ```

2. On its setup page, choose **Join a home**. Type the coordinator's address from step 2.3 and this laptop's name, for example `Camera laptop`.
3. The page shows a QR code and a Home code. Check that the coordinator's setup page shows the same Home code under Laptops.
4. On the caregiver iPhone, tap **Add a Laptop**, scan the code and approve. **(not yet tested on real hardware with the app; `npm run test:layer2` approves as a test caregiver phone)**
5. The page shows "Writing this laptop's files", then "Checking this laptop" (the first check can take a few minutes while uv builds Layer 2's environment), then "Starting the worker". Check: it shows **Joined**, and the coordinator's dashboard lists the laptop.
6. Click **Change the camera and mic**. Type each name exactly as the operating system shows it: on the demo camera laptop, `j5 WebCam JVCU100` for the camera and `Audio Streaming` for the mic. Leave a field empty for none.
7. Tick **The resident agrees to this camera and mic** only once the resident has agreed. Without it nothing is saved. Save. Saving restarts the worker. Check: the Joined page shows the camera and mic names. **(not yet tested on real hardware with Layer 3's capture job)**

## 6. Send a stub alert and see it on the phone

`npm run stub:alert` stands in for Layer 2's coordinator carrying a Layer 4 alert. Its body starts with `STUB:`, so it can never pass for a real alert.

1. At home: keep the caregiver iPhone on the hotspot's Wi-Fi with the app open. On the coordinator laptop, run:

   ```sh
   npm run stub:alert
   ```

   Check: it prints the alert ID and `202`, and the alert shows in the app.
2. For the rewrite that Layer 4 sends after its template alert, run `npm run stub:alert -- --rewrite-after 3`. Check: the app replaces the first text with one starting `STUB rewrite:`. For another kind, add `-- --kind help` (or `heart_rate`, `monitoring`).
3. Away: on the caregiver iPhone, turn Wi-Fi off so it uses cellular, and lock it. Run `npm run stub:alert` again. Check: a push arrives on the locked phone and names what happened. **(not yet tested on real hardware)** The push needs the app to register its push token with the relay (`POST /v1/push-tokens`), which TestFlight build 7 doesn't do yet. Until it does, check only the in-app fetch over cellular: with the app open and Wi-Fi off, run `npm run stub:alert`. Check: the STUB alert arrives in the app through the relay.

## 7. A real alert: a staged fall

No model sits on the alert path: Layer 4's fixed rules raise the alert, so it must arrive with Ollama stopped. Layer 2's planner uses `qwen2.5:7b` through Ollama and falls back to its rule-based plan when Ollama doesn't answer. **(not yet tested on real hardware)**

1. Before the demo, while the camera laptop has internet, let Layer 4's `fall_model` job start once on it, so it downloads its pose model (`layer4/src/layer4/settings.py`, `POSE_MODEL_URL`). Steps 5.6 and 5.7 start it, since it needs the camera. Check: on the camera laptop, `ls <repo>/layer4/jobs/fall_model/pose_landmarker_full.task` finds the file.
2. Stop Ollama on every laptop. On macOS, choose **Quit Ollama** from its menu bar icon, or run `brew services stop ollama` if Homebrew started it. Check: `curl -s --max-time 2 http://127.0.0.1:11434` prints nothing and exits with an error (a running Ollama prints `Ollama is running`).
3. The camera laptop has joined with its camera and mic set (step 5). On the coordinator laptop, open the dashboard from the setup page's link (Layer 2's, port 7450), or read its JSON with `curl -s http://127.0.0.1:7450/api/state`. Check: `jobs` lists Layer 3's `capture` and Layer 4's `fall_model`, each with the camera laptop's `node_id` and `"state": "running"`.
4. Keep the caregiver iPhone on cellular with the app open, then stage a fall in front of the camera. Check: within 10 seconds the iPhone shows an alert naming the fall (Layer 4's title is `Possible fall`). A push on a locked phone arrives only once the app registers for push (step 6.3).

## 8. Resident watch data

The app must send watch data as the `watch_data` command (`contracts/watch-data.json`). TestFlight build 7 still posts the old `heart_rate` path, `/v1/lan/heart-rate`, which gets `404`. **(not yet tested on real hardware)**

1. With one iPhone, turn on resident mode in the app on the caregiver iPhone (step 4.4). With two, use the resident iPhone.
2. Join the iPhone to the hotspot's Wi-Fi (watch data goes to the coordinator's bridge on the local network only, never through the relay) and tap **Sync now**.
3. Check: the coordinator's bridge Terminal prints `L1 handoff: the coordinator took watch data from <device_id>`. `L1 handoff: no job takes watch data from <device_id> right now (503)` means no worker runs Layer 3's `watch_data` job yet.
4. Check: on the coordinator's dashboard, `jobs` lists Layer 3's `watch_data` and Layer 4's `health_check`, each `running` on a worker. Layer 3's job passes the readings on to Layer 4's `health_check` job.

## 9. Hub offline and back online

The relay's watchdog pushes "hub offline" (`Can't Reach Home`) when the hub has been silent for `hub_silent_limit_s`, and "back online" (`Home Is Back Online`) when it returns. Both are pushes, so this needs the app's push registration (step 6.3). **(not yet tested on real hardware)**

1. Once before the demo, set the relay's `hub_silent_limit_s` to 60, the shortest it accepts, as `relay/deploy/RUNBOOK.md` step 4 says for the demo. From a laptop that can SSH to the relay, with `RELAY` set as in step 3.1:

   ```sh
   ssh "$RELAY" "sudo sed -i 's/\"hub_silent_limit_s\": [0-9]*/\"hub_silent_limit_s\": 60/' /etc/debbie-relay/relay.json && sudo systemctl restart debbie-relay"
   ```

   Check: `ssh "$RELAY" 'sudo grep -o "\"hub_silent_limit_s\": [0-9]*" /etc/debbie-relay/relay.json; systemctl is-active debbie-relay'` prints `"hub_silent_limit_s": 60` and `active`. The restart drops the hub's link for a moment; the bridge reconnects by itself.
2. Lock the caregiver iPhone with Wi-Fi off, so it is on cellular.
3. Cut the coordinator laptop's internet, for example by turning its Wi-Fi off. Wait about 2 minutes: the 60-second limit plus the watchdog's 60-second tick. Check: "hub offline" arrives on the locked phone.
4. While the coordinator is still offline, run `npm run stub:alert` on it. The alert waits in the hub's outbox.
5. Turn the coordinator's Wi-Fi back on. Check: "back online" and the queued STUB alert arrive on the phone.

## 10. What each status on the setup pages means

On the coordinator's page, **Remote access**:

| Status                                                         | Meaning                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `not set up`                                                   | There is no `relay-credential.json`. Do step 3                                       |
| `connecting to the relay`                                      | The bridge is opening its link to the relay                                          |
| `connected to the relay since <time>`                          | The link is up; phones away from home reach the home                                 |
| `can't reach the relay (<reason>); retrying in <n> s`          | The relay or the internet can't be reached. The bridge retries by itself             |
| `the relay rejected this home's credential`                    | The credential was replaced or the home is unknown. Do step 3 again with `--replace` |
| `the credential file ... can't be used (...); import it again` | The file is damaged or doesn't match this home. Do step 3 again                      |
| `stopped`                                                      | The bridge is stopping                                                               |

On the coordinator's page, **Coordinator**:

| Status                                                  | Meaning                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `running`                                               | Layer 2's coordinator is running                                        |
| `STUB (Layer 2's coordinator isn't built yet), running` | A labelled stub runs instead of Layer 2's coordinator                   |
| `restarting after a crash`                              | It exited with an error; the bridge restarts it. The last error follows |
| `bad config`                                            | It refused `coordinator.json`. The last error says why                  |
| `not started; restart the bridge to start it`           | Restart the bridge                                                      |

On the camera laptop's page:

| Status                                               | Meaning                                                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Contacting the home laptop at <address>…`           | It is reaching the coordinator's bridge on port 7480                                                                                             |
| The QR code and Home code                            | Waiting for a caregiver to approve in the app                                                                                                    |
| `This laptop is missing something the worker needs.` | Layer 2's check found something missing; it is listed. Fix it and press **Check again**                                                          |
| `Joined`                                             | The coordinator accepted the worker                                                                                                              |
| `Connecting to the home at <address>…`               | The worker isn't connected yet. After a while the page says to check that the coordinator's bridge runs and both laptops are on the same network |
| `Restarting the worker after a crash: <error>`       | The worker exited with an error; the bridge restarts it                                                                                          |
| `The worker isn't running: <error>`                  | The worker stopped. Restart the bridge                                                                                                           |
| `The home rejected this laptop's token.`             | The coordinator doesn't know this laptop. Press **Join again**                                                                                   |
| `Link to the home laptop: not connected: <reason>`   | The camera laptop's bridge can't reach the coordinator's bridge                                                                                  |

## 11. Stopping everything

Every Layer 1 program stops on Ctrl+C or when its stop file appears. The stop file works on every system and from scripts.

1. Each laptop's bridge: create `bridge.stop` in its state folder (macOS: `~/Library/Application Support/Debbie`; Windows: `%LOCALAPPDATA%\Debbie`). On macOS:

   ```sh
   touch "$HOME/Library/Application Support/Debbie/bridge.stop"
   ```

   On Windows, in PowerShell:

   ```powershell
   New-Item -ItemType File "$env:LOCALAPPDATA\Debbie\bridge.stop"
   ```

   The bridge stops the coordinator or worker it started, closes port 7480 and the setup page, removes `bridge.stop` and prints `L1 bridge: stopped`. Stop the camera laptop first, then the coordinator laptop.
2. The relay keeps running between demos. To stop it: `ssh "$RELAY" 'sudo systemctl stop debbie-relay'`.

## 12. Troubleshooting

- **The firewall prompt for `node`.** macOS asks whether `node` may accept incoming connections the first time the bridge listens on port 7480. Choose **Allow**. If it was denied, phones and other laptops can't reach the coordinator: in System Settings → Network → Firewall → Options, set `node` to allow incoming connections, then restart the bridge. On Windows, allow Node through the firewall and set the network to Private.
- **Port 7480 in use.** The page says `port 7480 is in use by another program`. Usually another bridge is still running. Stop it with its stop file, or find it with `lsof -nP -iTCP:7480 -sTCP:LISTEN` on macOS, then press **Pair a phone** again. If the setup page's own port 7470 is in use, the bridge doesn't start and says so.
- **The phone shows "removed".** The phone was removed on the setup page or unpaired itself, and a removed phone is never let back in. On the coordinator's page, press **Pair a phone** and pair it again.
- **The relay shows the hub offline.** `admin.ts status` shows `hub_connected` false, or the phone shows "Can't Reach Home". Check the coordinator's Remote access line (step 10). Check that the coordinator laptop has internet: `curl -s https://relay.144-202-5-15.sslip.io/healthz` prints `{"v":1,"ok":true}`. If the bridge was restarted, wait 20 seconds for its first heartbeat. "Home Is Back Online" arrives once the hub reconnects. **(the hub-offline push is not yet tested on real hardware)**
