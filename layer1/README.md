# Layer 1: join and connect

This is the bridge that runs on every laptop in a Debbie home. It serves the setup page, pairs laptops and phones, and starts Layer 2's programs. On the coordinator laptop it also connects the home to the relay. The design is in `docs/layer1-join-and-connect.md`, and the team rules are in `CLAUDE.md`. The iPhone app lives in the separate `debbie-ios` project.

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

`npm start` runs the bridge: it serves the setup page, opens it in the default browser and starts the home's coordinator. Pass `npm start -- --state-dir <absolute folder>` to use a state folder other than this system's default. To stop the bridge, press Ctrl+C, or create an empty file named `bridge.stop` in its state folder, which works on every system and from scripts. Once a home exists, the bridge also listens on port 7480 on every network interface, where phones pair and then reach the home over home Wi-Fi; the setup page's Pair a phone button shows the QR code. Either way it closes port 7480 and the setup page, stops the coordinator, removes `bridge.stop` and exits.

## What lint does not catch

Biome's promise rules, `noFloatingPromises` and `noMisusedPromises`, know the types of this project's own code but not Node's. So lint does not report an async callback passed to a Node API, such as a request handler for `http.createServer`, a listener for `.on(...)` or a `setInterval` callback, nor an unawaited promise from a Node API such as `writeFile`. If that promise rejects, nothing handles the error and the process exits. In those places, catch the error inside the callback, for example `setInterval(() => { saveState().catch(reportFailure); }, INTERVAL_MS)`, and check for this in review.

`noMisusedPromises` also reports a truthiness test on an optional promise, such as `if (this.#starting)` where `#starting` is `Promise<void> | undefined`. Write `if (this.#starting !== undefined)` or `this.#starting ??= connect();` instead.

Two ways of swallowing an error also pass lint: a `catch` block that holds only a comment passes `noEmptyBlockStatements`, and `.catch(() => undefined)` passes `noFloatingPromises`. `CLAUDE.md` section 10 forbids both, so handle or report the error, and check for this in review.
