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
