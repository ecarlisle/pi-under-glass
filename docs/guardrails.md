# Guardrails

**Use when:** Adding dependencies, features, or UI, or changing the server, protocol, or security behavior

- Preserve the simple architecture in [Architecture](architecture.md). Keep runtime dependencies minimal; `ws` is the only one.
- Keep all session data local, the server loopback-only (`127.0.0.1`), WebSocket access token-authenticated, and `session_shutdown` cleanup (close server and sockets) reliable.
- Never estimate missing usage values. Use the definitions in [Terminology](terms.md).
- Do not add persistence, replay buffers, elaborate dashboards, broad metrics, framework build systems, heavy installers, or Electron-style shells unless explicitly requested.
- Keep the viewer visually plain, readable, and easy to change. Favor transcript clarity over visual polish or extra panels.
- Treat protocol changes as compatibility changes (see [Architecture](architecture.md)).
