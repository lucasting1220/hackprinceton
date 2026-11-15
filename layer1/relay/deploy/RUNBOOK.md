# Deploying the Debbie relay

This deploys one commit of `layer1/` to the relay server on Vultr and connects a home to it. The server is `relay.144-202-5-15.sslip.io` (144.202.5.15, Ubuntu 24.04, New Jersey). It already has Caddy with a Let's Encrypt certificate, coturn on 3478, Node 24.22.3 in `/opt/node`, the APNs key in `/etc/debbie/apns-key.p8` with its Key ID in `/etc/debbie/apns-key-id`, and the TURN secret in `/etc/debbie/turn-secret`.

Each step has a command and a check. Run the commands from the repository root on a teammate's laptop. Record each check as PASS, FAIL, BLOCKED or NOT RUN.

## What stays secret

- The hub credential, the APNs key, the TURN secret and device credentials never go into the repository, a log, a chat, a command-line argument or a file on a laptop other than the coordinator's `relay-credential.json`.
- Never `cat` the key, the TURN secret or the credential file to the terminal.
- The deploy files in this folder hold placeholders only: the team ID, the app's bundle ID and the Key ID are filled in on the server (step 4).

## Files in this folder

| File                       | Installed as                                                     | What it is                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `relay.example.json`       | `/etc/debbie-relay/relay.json`                                   | The relay's config: port 7490 on 127.0.0.1, the database and stop file in `/var/lib/debbie-relay`, the APNs key that systemd hands the relay |
| `debbie-relay.service`     | `/etc/systemd/system/debbie-relay.service`                       | The systemd unit: user `debbie-relay`, sandboxed, the APNs key passed with `LoadCredential`                                                  |
| `Caddyfile`                | `/etc/caddy/Caddyfile`                                           | TLS on 443 through the TLS-ALPN challenge (port 80 stays closed), everything passed to 127.0.0.1:7490, WebSocket upgrades on `/v1/hub`       |
| `turnserver.conf.template` | `/etc/turnserver.conf`, with the secret line added on the server | coturn's settings, without the secret                                                                                                        |

## 0. Before you start

You need an SSH key that the server accepts for the `debbie` user, and your network's address in the Vultr firewall group's port 22 rule (it allows only the team's addresses). Set the target once in your shell:

```sh
RELAY=debbie@144.202.5.15
```

Check: `ssh "$RELAY" 'node --version; timedatectl show -p NTPSynchronized --value; systemctl is-active caddy coturn; sudo test -s /etc/debbie/apns-key.p8 && echo apns key present'` prints `v24.22.3`, `yes`, `active` twice and `apns key present`. APNs refuses a provider token from a server whose clock is off, so `NTPSynchronized` must be `yes`.

## 1. The relay's user and folders (first deploy only)

```sh
ssh "$RELAY" 'sudo useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin debbie-relay && sudo install -d -m 0755 -o root -g root /opt/debbie && sudo install -d -m 0750 -o root -g debbie-relay /etc/debbie-relay'
```

Check: `ssh "$RELAY" 'id debbie-relay; sudo stat -c "%a %U %G %n" /opt/debbie /etc/debbie-relay'` shows the user, `755 root root /opt/debbie` and `750 root debbie-relay /etc/debbie-relay`. systemd creates `/var/lib/debbie-relay` (mode 0700, owned by `debbie-relay`) when the service first starts.

## 2. Run the tests on Linux (first deploy, and after a change to the relay)

The relay runs only on Linux, so its tests must pass there once. This uses a scratch copy in the `debbie` user's home with the development dependencies, then deletes it.

```sh
COMMIT=$(git rev-parse --verify HEAD)
git archive --format=tar.gz "$COMMIT" .gitignore layer1 | ssh "$RELAY" 'rm -rf ~/relay-test && mkdir ~/relay-test && tar -xz -C ~/relay-test && cd ~/relay-test && git init -q && cd layer1 && npm ci --ignore-scripts && npm test; status=$?; rm -rf ~/relay-test; exit $status'
```

Check: the last lines show `fail 0`, and the command exits 0.

## 3. Copy the code

Pick the commit to deploy (normally the latest `main`), then copy `layer1/` from it to `/opt/debbie/layer1.next` and install the runtime dependencies there. The server holds no GitHub credential and runs no package scripts.

```sh
git fetch origin && COMMIT=$(git rev-parse --verify origin/main)
git archive --format=tar.gz "$COMMIT" layer1 | ssh "$RELAY" 'sudo rm -rf /opt/debbie/layer1.next && sudo mkdir /opt/debbie/layer1.next && sudo tar -xz -C /opt/debbie/layer1.next --strip-components=1 && cd /opt/debbie/layer1.next && sudo npm ci --omit dev --ignore-scripts'
```

Then swap it in. On the first deploy the service doesn't exist yet, and `systemctl stop` says so; that is expected.

```sh
ssh "$RELAY" "sudo systemctl stop debbie-relay; sudo rm -rf /opt/debbie/layer1.prev; if [ -d /opt/debbie/layer1 ]; then sudo mv /opt/debbie/layer1 /opt/debbie/layer1.prev; fi; sudo mv /opt/debbie/layer1.next /opt/debbie/layer1 && echo $COMMIT | sudo tee /opt/debbie/DEPLOYED_COMMIT"
```

Check: `ssh "$RELAY" 'cat /opt/debbie/DEPLOYED_COMMIT; ls /opt/debbie/layer1/relay/src/main.ts'` prints the commit and the path.

## 4. relay.json (first deploy, or when `relay.example.json` gains a field)

The example becomes `/etc/debbie-relay/relay.json`, readable by the relay's group only. The Key ID comes from the file on the server. Replace `<bundle ID>` and `<team ID>` with the app's bundle ID and Apple team ID from the debbie-ios project's signing settings.

```sh
ssh "$RELAY" 'sudo install -m 0640 -o root -g debbie-relay /opt/debbie/layer1/relay/deploy/relay.example.json /etc/debbie-relay/relay.json && sudo sed -i "s/KEYID00000/$(sudo cat /etc/debbie/apns-key-id)/g; s/com\.example\.debbie/<bundle ID>/; s/TEAMID0000/<team ID>/" /etc/debbie-relay/relay.json'
```

The one Apple key is Team Scoped, so it signs both Sandbox (builds from Xcode) and Production (TestFlight) pushes: both `apns.keys` entries name it. The key file path `/run/credentials/debbie-relay.service/apns-key.p8` is where systemd hands the relay a copy of `/etc/debbie/apns-key.p8`, which stays readable by root only.

`hub_silent_limit_s` is 180 seconds, the doc's value. For the demo, 60 is the shortest the relay accepts (three of the hub's 20-second heartbeats).

Check: `ssh "$RELAY" 'sudo grep -c -e KEYID00000 -e TEAMID0000 -e com.example.debbie /etc/debbie-relay/relay.json'` prints `0`.

## 5. The service

```sh
ssh "$RELAY" 'sudo install -m 0644 /opt/debbie/layer1/relay/deploy/debbie-relay.service /etc/systemd/system/debbie-relay.service && sudo systemctl daemon-reload && sudo systemctl enable debbie-relay && sudo systemctl restart debbie-relay'
```

Check, all on the server:

- `systemctl is-active debbie-relay` prints `active`;
- `journalctl -u debbie-relay -n 20 --no-pager` shows `L1 relay: listening on http://127.0.0.1:7490`, and no `pushes to ... phones are off` line once step 4 is done;
- `curl -s http://127.0.0.1:7490/healthz` prints `{"v":1,"ok":true}`.

## 6. Caddy

```sh
ssh "$RELAY" 'sudo install -m 0644 /opt/debbie/layer1/relay/deploy/Caddyfile /etc/caddy/Caddyfile && sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && sudo systemctl reload caddy'
```

Check, from the laptop:

- `curl -s https://relay.144-202-5-15.sslip.io/healthz` prints `{"v":1,"ok":true}` (the relay's answer; before this step Caddy answered `ok` itself);
- `curl -s -o /dev/null -w '%{http_code}\n' https://relay.144-202-5-15.sslip.io/v1/home` prints `401`;
- `curl -s -o /dev/null -w '%{http_code}\n' http://relay.144-202-5-15.sslip.io/healthz --max-time 5` fails to connect: port 80 stays closed.

## 7. coturn (only when `turnserver.conf.template` changes)

The template goes to `/etc/turnserver.conf` with the secret line added on the server. The secret is read inside the server's shell and never appears on a command line or in this repository.

```sh
ssh "$RELAY" 'sudo bash -s' <<'SH'
set -euo pipefail
umask 027
{
  cat /opt/debbie/layer1/relay/deploy/turnserver.conf.template
  printf 'static-auth-secret=%s\n' "$(cat /etc/debbie/turn-secret)"
} > /etc/turnserver.conf.next
chown root:turnserver /etc/turnserver.conf.next
chmod 640 /etc/turnserver.conf.next
mv /etc/turnserver.conf.next /etc/turnserver.conf
systemctl restart coturn
SH
```

Check: `ssh "$RELAY" 'systemctl is-active coturn; sudo ss -lnup | grep -c ":3478 "'` prints `active` and a count of at least 1.

## 8. Connect a home

On the coordinator laptop, find the home's ID in its state folder (macOS: `~/Library/Application Support/Debbie`; Windows: `%LOCALAPPDATA%\Debbie`):

```sh
STATE="$HOME/Library/Application Support/Debbie"
grep -o '"home_id": *"[^"]*"' "$STATE/home.json"
```

Then provision the home on the relay and copy its hub credential file straight into the state folder. The credential travels only over SSH, from the relay's stdout into a file only you can read; nothing prints it. Replace `<home ID>` with the ID above.

```sh
( umask 077; ssh "$RELAY" 'sudo -u debbie-relay /opt/node/bin/node /opt/debbie/layer1/relay/src/admin.ts provision --config /etc/debbie-relay/relay.json --home-id <home ID>' > "$STATE/relay-credential.json.next" && mv "$STATE/relay-credential.json.next" "$STATE/relay-credential.json" ) || rm -f "$STATE/relay-credential.json.next"
```

A home that already has a credential is refused (exit 2). To issue a new one, which cuts the old one off at the hub's next frame, add `--replace`.

Until the bridge's `relay-credential.ts import` and its relay link are on `main` (step 5's pull requests 13 and 14), nothing on the laptop reads this file yet; from then on, pipe the same `ssh` command into `node layer1/bridge/src/relay-credential.ts import` instead, which checks the file before it writes it.

Check:

- `ls -l "$STATE/relay-credential.json"` shows `-rw-------`;
- `ssh "$RELAY" 'sudo -u debbie-relay /opt/node/bin/node /opt/debbie/layer1/relay/src/admin.ts status --config /etc/debbie-relay/relay.json'` lists the home, with `hub_connected` true once the bridge's relay link connects.

## 9. Phones

Pair the caregivers' phones after step 8: the pairing bundle carries `relay_url`, so a phone paired earlier has no relay address until it pairs again.

## 10. Live checks (NOT RUN until the app and the relay link exist)

- An alert pushed to a locked phone on cellular.
- The hub-offline drill: unplug the coordinator's network; after `hub_silent_limit_s`, "Can't Reach Home"; plug it back, "Home Is Back Online", then the queued alerts.
- No alert text, credential, key or push token in `/var/lib/debbie-relay/relay.db`, its `-wal` file, or `journalctl -u debbie-relay`.

## Stopping, rolling back and shutting down

- Stop: `sudo systemctl stop debbie-relay`. The relay also stops when its stop file appears: `sudo -u debbie-relay touch /var/lib/debbie-relay/relay.stop`. It closes the hubs' connections, then the phones' requests, then the database, and removes the stop file. A stop through the file is a clean exit, so systemd doesn't restart it; `sudo systemctl start debbie-relay` does.
- Roll back: stop the service, move `/opt/debbie/layer1.prev` back to `/opt/debbie/layer1`, write its commit to `DEPLOYED_COMMIT`, and start the service.
- After the hackathon: destroy the server in Vultr and revoke the APNs key in the Apple Developer account.
