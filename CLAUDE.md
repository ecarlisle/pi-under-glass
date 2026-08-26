# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pi Under Glass is a tiny, local-first TypeScript extension for [Pi](https://pi.dev). It is not a desktop app. Loaded into a Pi process, it starts one HTTP/WebSocket server on `127.0.0.1`, serves a static dependency-free viewer, and streams the current session's Pi lifecycle events (messages, tool calls, usage/cost) to that viewer over a small versioned protocol. No session data leaves the machine and nothing is persisted.

## Commands

```sh
pnpm check      # tsc --noEmit
pnpm test       # tsx --test test/*.test.ts (runs all test/*.test.ts)
pnpm pack:dry   # npm pack --dry-run — validate package contents/metadata
```

Run a single test file directly with tsx, e.g. `npx tsx --test test/server.test.ts`.

Fallow (dead-code/audit tooling, dev dependency only):

```sh
pnpm fallow:dead-code   # npx fallow dead-code --unused-files --unused-deps
pnpm fallow:audit       # npx fallow audit --changed-since main
pnpm fallow:fix-dry     # npx fallow fix --dry-run
```

There is no build step — `src/index.ts` is loaded directly by Pi (`pi --extension ./src/index.ts`) or installed via `pi install .`. Inside Pi, `/underglass` opens the viewer in the default browser and prints its session-specific URL; the server picks an available local port unless `PI_UNDER_GLASS_PORT` is set. `/underglass debug` opens it against deterministic sample data instead of live Pi traffic (see Debug mode below).

## Architecture

Three source files, each with one job:

- **`src/index.ts`** — the Pi extension entry point (default export `piUnderGlass(pi)`). Subscribes to Pi lifecycle events (`session_start`, `before_agent_start`, `message_start`/`message_update`/`message_end`, `turn_start`/`turn_end`, `agent_settled`, `tool_execution_start`/`tool_execution_end`, `session_shutdown`) and translates them into protocol events published to the viewer server. Registers the `/underglass` command. Owns all session-lifetime state: the run/turn/message sequence counters, the active-run and active-turn tracking, and the rolling session usage accumulator.
- **`src/protocol.ts`** — the versioned wire protocol (`PROTOCOL_VERSION`). Defines `EventDataMap` (the exhaustive set of event types and their payload shapes), the `GlassEvent` envelope, the `HelloMessage` sent on WebSocket connect, and `createEvent()`. This is the contract between the extension and the viewer; treat any change to it as a compatibility change (bump the version or preserve existing shapes).
- **`src/server.ts`** — `startViewerServer()`: a plain `node:http` + `ws` server bound to `127.0.0.1`. Serves the static viewer (`viewer/index.html`, `app.js`, `styles.css`) and an authenticated `/events` WebSocket endpoint. Every request (including the debug fixture endpoint) requires a `token` query param matching the extension-generated token; the WebSocket handshake is rejected at the HTTP `upgrade` step if the token doesn't match. Sends a `hello` message with current metrics on each new connection.
- **`src/usage.ts`** — pure usage-accumulation helpers (`createUsageAccumulator`, `addUsage`, `usageRollup`, `providerUsage`). A usage field only appears in a rollup if every accumulated request reported that field — this "completeness" tracking avoids silently under-reporting cost/tokens when a provider omits a field partway through a session.
- **`viewer/`** — dependency-free static HTML/CSS/JS (no bundler, no framework). `app.js` opens the WebSocket (or, in debug mode, replays `fixtures/sample-session.json` through the same event handler), renders the transcript, and drives the show/hide toggles for usage details, tool input/results, timestamps, thinking, and system prompt.

### Event flow

Pi lifecycle event → `src/index.ts` handler updates local state (run/turn/message tracking, usage accumulators) → `publish()` wraps the payload via `createEvent()` and sends it through every open WebSocket → `viewer/app.js` receives the JSON event and updates the DOM. The extension is the only writer of protocol events; the viewer is read-only over the wire.

### Terminology (see `docs/terms.md` for full definitions)

Session → Agent run → Turn → Message is the containment hierarchy. A Turn is one model invocation and is the authoritative unit for provider-reported usage; Agent-run and Session usage figures are sums over completed Turns only. In the viewer's presentation hierarchy, User and Agent (Pi's `assistant` role) are the only peer speaker lanes — System prompt, Tool calls, and Tool results render as typed content within an Agent run, not as separate lanes. Missing usage values are never estimated.

### Debug mode

`/underglass debug` serves `fixtures/sample-session.json` (a recorded `hello` + event sequence) through `/debug-fixture` and replays it through the exact same `viewer/app.js` handling path used for live events, so the viewer code path is identical between live and sample data. Edit that fixture to exercise specific message/tool/usage states; it requires the session token like everything else and 404s if no debug fixture was configured (i.e., never available outside the debug entry point).

## Guardrails (from AGENTS.md — keep these in mind for any change)

- Preserve the simple three-file architecture; keep runtime dependencies to the minimum necessary (`ws` is currently the only one).
- Keep all session data local, the server loopback-only (`127.0.0.1`), WebSocket access token-authenticated, and shutdown cleanup (`session_shutdown` → close server/sockets) reliable.
- Do not add persistence, replay buffers, elaborate dashboards, broad metrics, framework build systems, heavy installers, or Electron-style shells unless explicitly requested.
- Keep the viewer visually plain, readable, and easy to change. Favor transcript clarity over visual polish or additional panels.
- Treat `src/protocol.ts` changes as compatibility changes: bump `PROTOCOL_VERSION` or preserve existing event shapes.
- Run `pnpm check` and `pnpm test` for code changes; run `pnpm pack:dry` when package contents or metadata (`package.json` `files`) change. For Pi integration or viewer changes, smoke-test the local Pi loader and browser connection when feasible.
- Preserve unrelated work and do not commit changes unless explicitly asked.
