# Contributor guide

Pi Under Glass is a minimal, local-first Pi extension. It exposes the current Pi session in a plain browser transcript with basic totals; it is not a desktop app, installer, or general observability platform.

## Architecture

- `src/index.ts` subscribes to Pi lifecycle events and provides `/underglass`.
- `src/protocol.ts` defines the small, versioned event protocol.
- `src/server.ts` serves static files and authenticated WebSocket events on `127.0.0.1`.
- `viewer/` is dependency-free HTML, CSS, and JavaScript.
- `test/` covers protocol and local server behavior.

## Guardrails

- Preserve this simple architecture and keep runtime dependencies to the minimum necessary.
- Keep all session data local, the server loopback-only, WebSocket access authenticated, and shutdown cleanup reliable.
- Do not add persistence, replay buffers, elaborate dashboards, broad metrics, framework build systems, heavy installers, or Electron-style shells unless explicitly requested.
- Keep the viewer visually plain, readable, and easy to change. Favor transcript clarity over visual polish or additional panels.
- Treat protocol changes as compatibility changes: update the version or preserve existing behavior as appropriate.

## Validation and workflow

Run `pnpm check` and `pnpm test` for code changes. Run `pnpm pack:dry` when package contents or metadata change. For Pi integration or viewer changes, also smoke-test the local Pi loader and browser connection when feasible.

Preserve unrelated work and do not commit changes unless explicitly asked.
