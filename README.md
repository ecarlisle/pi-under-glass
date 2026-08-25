# Pi Under Glass

Pi Under Glass is a tiny, local-first browser view for [Pi](https://pi.dev). It shows the current session's user and assistant messages as they happen, with basic totals for elapsed time, token usage, provider-reported cost, and tool activity.

It is a TypeScript Pi extension, not a desktop app. The extension starts one HTTP/WebSocket server on `127.0.0.1`, serves the included static viewer, and streams Pi lifecycle events through a small versioned protocol. No session data leaves your machine.

## Install

From this repository:

```sh
pnpm install
pi install .
```

Or load it directly while developing:

```sh
pi --extension ./src/index.ts
```

Inside Pi, run:

```text
/underglass
```

The command opens the viewer in your default browser and also displays its session-specific URL. The server chooses an available local port. Set `PI_UNDER_GLASS_PORT` if you need a fixed one.

## What it observes

- User and assistant messages, including live assistant text
- Input/output tokens and provider-reported cost
- Tool starts, completions, duration, and error state
- Session elapsed time

The viewer is intentionally ephemeral: it does not persist conversations or replay earlier events to a newly opened tab. Open it before sending a prompt when you want the full live trace.

## Local security

The server binds only to IPv4 loopback (`127.0.0.1`). Each Pi process creates a random token, and both the viewer entry page and WebSocket require it. Static CSS and JavaScript contain no session data.

## Development

```sh
pnpm check
pnpm test
pnpm pack:dry
```

The wire format lives in `src/protocol.ts` and currently uses protocol version `2`.
