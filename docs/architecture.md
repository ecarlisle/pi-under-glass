# Architecture

**Use when:** Changing `src/`, `viewer/`, the wire protocol, or debug mode

## Files

| Path | Job |
| --- | --- |
| `src/index.ts` | Pi extension entry (`piUnderGlass(pi)`). Subscribes to Pi lifecycle events, owns run/turn/message counters and usage state, registers `/underglass`. |
| `src/protocol.ts` | Versioned wire protocol (`PROTOCOL_VERSION`): `EventDataMap`, `GlassEvent`, `HelloMessage`, `createEvent()`. |
| `src/server.ts` | `startViewerServer()`: `node:http` + `ws` on `127.0.0.1`. Serves `viewer/` and the `/events` WebSocket. |
| `src/usage.ts` | Pure usage accumulation. A field appears in a rollup only if every request reported it. |
| `viewer/state.js` | Session state, reducer for incoming events, ribbon segments, derived signals. |
| `viewer/transcript.js` | Selected-Turn evidence renderer. |
| `viewer/app.js` | WebSocket (or debug replay) wiring and DOM. |

`test/` covers each `src/` module plus viewer state and table logic. `viewer/app.js` has no direct tests.

## Event flow

Pi lifecycle event → handler in `src/index.ts` updates state → `publish()` wraps it with `createEvent()` → every open WebSocket → `viewer/app.js` → `viewer/state.js` reducer → DOM. The extension is the only writer; the viewer is read-only.

## Auth

The entry page `/`, `/debug-fixture`, and the `/events` WebSocket need the extension-generated `token` query param; the upgrade is rejected at the HTTP `upgrade` step on mismatch. Static CSS and JS are served without it and contain no session data. Each new connection receives a `hello` with current metrics.

## Debug mode

`/underglass debug` serves `fixtures/sample-session.json` at `/debug-fixture` and replays it through the same handler as live events. The endpoint 404s unless debug was configured. Edit the fixture to exercise specific states.

## Protocol changes

Changing `src/protocol.ts` is a compatibility change: bump `PROTOCOL_VERSION` or preserve existing shapes. Additive event types are safe because viewers ignore unknown types.
