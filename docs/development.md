# Development and validation

**Use when:** Running, testing, smoke-testing, or packaging the extension

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm check` | `tsc --noEmit` |
| `pnpm test` | All `test/*.test.ts` via tsx |
| `npx tsx --test test/server.test.ts` | One test file |
| `pnpm pack:dry` | Validate package contents and metadata |
| `pnpm fallow:dead-code` / `fallow:audit` / `fallow:fix-dry` | Dead-code and audit tooling (dev only) |

There is no build step. Pi loads `src/index.ts` directly.

## Validation

- Code changes: run `pnpm check` and `pnpm test`.
- Package contents or `package.json` `files` changes: also run `pnpm pack:dry`.
- Pi integration or viewer changes: smoke-test the Pi loader and browser connection when feasible.

## Running

- `pi --extension ./src/index.ts` loads it for development; `pi install .` installs it.
- `/underglass` opens the viewer and prints the session URL. Set `PI_UNDER_GLASS_PORT` for a fixed port.
- `/underglass debug` replays sample data (see [Architecture](architecture.md)).
