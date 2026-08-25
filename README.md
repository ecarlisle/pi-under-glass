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
- Model thinking/reasoning traces (collapsed by default)
- Input/output tokens and provider-reported cost
- Tool calls with expandable args and results, duration, and error state
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

Inside Pi, run the viewer with deterministic sample activity:

```text
/underglass debug
```

This opens an explicitly labeled sample-data view and plays `fixtures/sample-session.json` through the same browser event handler used for live Pi traffic. Edit that JSON file to exercise different message, tool, and usage states. Debug mode does not connect to Pi or retain session data. Refresh the page to restart the sample from the beginning.

The wire format lives in `src/protocol.ts` and currently uses protocol version `2`.
