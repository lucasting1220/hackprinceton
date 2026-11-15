# Layer 1: join and connect

This is the bridge that runs on every laptop in a Debbie home. It serves the setup page, pairs laptops and phones, and starts Layer 2's programs. On the coordinator laptop it also connects the home to the relay. The design is in `docs/layer1-join-and-connect.md`, and the team rules are in `CLAUDE.md`. The iPhone app is developed in its own `debbie-ios` repository, and a copy of it is in `debbie-ios/` here (see "The iPhone app" below).

## Requirements

Node 24, the version in `.nvmrc`.

## Commands

Run each command from this folder (`layer1/`). These are the checks that `CLAUDE.md` section 5 refers to. Each must pass with zero errors and zero warnings.

| Check      | Command                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------- |
| Install    | `npm ci`                                                                                 |
| Format     | `npm run format:check`                                                                   |
| Lint       | `npm run lint`                                                                           |
| Type check | `npm run typecheck`                                                                      |
| Tests      | `npm test`                                                                               |
| Start      | `npm start`; it stops on Ctrl+C or when a `bridge.stop` file appears in its state folder |

`npm run format` rewrites files to the expected format.

`npm run stub:alert` stands in for Layer 2's coordinator until it carries Layer 4's alerts: it posts one STUB alert to the running bridge's `POST /v1/alerts` on `http://127.0.0.1:7470` (coordinator.json's `bridge_url`), which seals it with the home key and keeps it in `outbox.json` for paired caregiver phones to fetch over home Wi-Fi. Add `-- --kind help` (or `heart_rate`, `monitoring`) for another kind, and `-- --rewrite-after 3` to send its rewrite 3 seconds later, as Layer 4 does.

`npm run test:layer2` runs Add a laptop against Layer 2's real coordinator and worker on this laptop: it creates a home and a joining laptop in temporary folders, approves the join as a test caregiver phone, and prints PASS once the worker says connected and the coordinator's `/api/state` lists it. It needs uv and Python 3.12, and its first run builds Layer 2's environment. It is not part of `npm test`.

On a laptop with no home, the setup page's Join a home asks for the home laptop's address (shown on that laptop's page under Laptops) and this laptop's name, then shows a code for the Debbie app's Add a Laptop. Once a caregiver approves, the bridge writes `worker.json` and the token file, runs Layer 2's check and starts Layer 2's worker, and starts it again whenever the bridge starts.

`npm start` runs the bridge: it serves the setup page, opens it in the default browser and starts the home's coordinator. Pass `npm start -- --state-dir <absolute folder>` to use a state folder other than this system's default. To stop the bridge, press Ctrl+C, or create an empty file named `bridge.stop` in its state folder, which works on every system and from scripts. Once a home exists, the bridge also listens on port 7480 on every network interface, where phones pair and then reach the home over home Wi-Fi; the setup page's Pair a phone button shows the QR code. Either way it closes port 7480 and the setup page, stops the coordinator, removes `bridge.stop` and exits.

Remote access goes through the relay. On the coordinator laptop, before pairing phones, pipe the relay's `admin provision` output into `node bridge/src/relay-credential.ts import [--state-dir <folder>]`, which saves `relay-credential.json` owner-only in the state folder, then restart the bridge. With that file the bridge keeps a link to the relay open, sends it the phone list, the saved alerts and a heartbeat every 20 seconds, answers phones' commands that come through it, and gives newly paired phones the relay's address; the setup page's Remote access line shows the link's state. A phone paired before the file existed must pair again to reach home away from Wi-Fi.

## The iPhone app

`debbie-ios/` is a copy of the iPhone app, taken from its own repository at commit `6178e83` on 2026-11-15, so the whole team can read and build it. The app is still developed in its own repository, so this copy does not update by itself, and a change made here does not reach the app: tell the Layer 1 owner instead. To build and test it, follow `debbie-ios/README.md`. Without a `Config/Local.xcconfig`, which holds the bundle ID, team ID and Gemini key and is never committed, it builds for the Simulator with a placeholder bundle ID.

The copy leaves out the designer kit (`DesignerKit/`) and the review screenshots, renders and recordings (`Design/reviews/`), because the team rules keep recordings and screenshots out of this repository, and everything the app's own `.gitignore` keeps out, such as signing files, keys, build output and logs. The app's `CLAUDE.md` is kept as `debbie-ios/APP_CLAUDE.md` so that Claude Code sessions in this repository don't load it as instructions: its rules (commit only locally, never push, treat this repository as read-only) belong to the app's own repository. Biome skips `debbie-ios/` because it can't check Swift and Xcode writes the app's JSON files in its own style; the app's own checks are `tools/ci/fl test` and `tools/ci/fl build`.

To refresh the copy, run this from `layer1/` on a new `l1/` branch, then update the commit named above:

```sh
rm -rf debbie-ios && mkdir debbie-ios
git -C <the debbie-ios folder> archive HEAD -- . ':(exclude)DesignerKit' ':(exclude)Design/reviews' | tar -x -C debbie-ios
mv debbie-ios/CLAUDE.md debbie-ios/APP_CLAUDE.md
```

## What lint does not catch

Biome's promise rules, `noFloatingPromises` and `noMisusedPromises`, know the types of this project's own code but not Node's. So lint does not report an async callback passed to a Node API, such as a request handler for `http.createServer`, a listener for `.on(...)` or a `setInterval` callback, nor an unawaited promise from a Node API such as `writeFile`. If that promise rejects, nothing handles the error and the process exits. In those places, catch the error inside the callback, for example `setInterval(() => { saveState().catch(reportFailure); }, INTERVAL_MS)`, and check for this in review.

`noMisusedPromises` also reports a truthiness test on an optional promise, such as `if (this.#starting)` where `#starting` is `Promise<void> | undefined`. Write `if (this.#starting !== undefined)` or `this.#starting ??= connect();` instead.

Two ways of swallowing an error also pass lint: a `catch` block that holds only a comment passes `noEmptyBlockStatements`, and `.catch(() => undefined)` passes `noFloatingPromises`. `CLAUDE.md` section 10 forbids both, so handle or report the error, and check for this in review.
