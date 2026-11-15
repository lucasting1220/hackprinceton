# Layer 1: join and connect

This is the bridge that runs on every laptop in a Debbie home. It serves the setup page, pairs laptops and phones, and starts Layer 2's programs. On the coordinator laptop it also connects the home to the relay. The design is in `docs/layer1-join-and-connect.md`, and the team rules are in `CLAUDE.md`. The iPhone app lives in the separate `debbie-ios` project.

## Requirements

Node 24, the version in `.nvmrc`.

## Commands

Run each command from this folder (`layer1/`). These are the checks that `CLAUDE.md` section 5 refers to. Each must pass with zero errors and zero warnings.

| Check      | Command                |
| ---------- | ---------------------- |
| Install    | `npm ci`               |
| Format     | `npm run format:check` |
| Lint       | `npm run lint`         |
| Type check | `npm run typecheck`    |
| Tests      | `npm test`             |

`npm run format` rewrites files to the expected format.

## What lint does not catch

Biome's promise rules, `noFloatingPromises` and `noMisusedPromises`, know the types of this project's own code but not Node's. So lint does not report an async callback passed to a Node API, such as a request handler for `http.createServer`, a listener for `.on(...)` or a `setInterval` callback, nor an unawaited promise from a Node API such as `writeFile`. If that promise rejects, nothing handles the error and the process exits. In those places, catch the error inside the callback, for example `setInterval(() => { saveState().catch(reportFailure); }, INTERVAL_MS)`, and check for this in review.

`noMisusedPromises` also reports a truthiness test on an optional promise, such as `if (this.#starting)` where `#starting` is `Promise<void> | undefined`. Write `if (this.#starting !== undefined)` or `this.#starting ??= connect();` instead.

Two ways of swallowing an error also pass lint: a `catch` block that holds only a comment passes `noEmptyBlockStatements`, and `.catch(() => undefined)` passes `noFloatingPromises`. `CLAUDE.md` section 10 forbids both, so handle or report the error, and check for this in review.
