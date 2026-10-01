# Pi Under Glass

Pi Under Glass is a tiny, local-first, read-only companion for [Pi](https://pi.dev). It presents each user-goal Turn as a factual event ribbon and lets you inspect the selected Turn's prompt, assistant output, tool evidence, timing, usage, and session markers. Actions still happen in Pi.

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
- The effective system prompt for a Turn (hidden and collapsed by default)
- Model thinking/reasoning traces (collapsed by default)
- Compact session markers when the model or thinking level changes, and when Pi compacts context; retained compaction summaries stay collapsed unless opened
- Input/output tokens and provider-reported cost
- Tool calls with expandable args and results, duration, and error state
- Session elapsed time
- A Session overview with one structural event ribbon per user-goal Turn
- A selected-Turn evidence panel with factual status, wall time, tool/error counts, and expandable source evidence
- Process-local orientation snapshots for viewers opened or reconnected after activity began

The viewer is intentionally ephemeral and never persists conversation data. A newly opened or reconnected tab receives a compact process-local orientation snapshot with trustworthy Turn facts and bounded evidence metadata, but not a replay of the full transcript. Open it before sending a prompt when you want complete expandable evidence.

## Local security

The server binds only to loopback (`127.0.0.1`), and the viewer page and WebSocket require a random per-process token. Details: [Architecture](docs/architecture.md) and [Guardrails](docs/guardrails.md).

## Development

Commands, validation, and `/underglass debug` sample-data mode: [Development and validation](docs/development.md). Wire protocol and compatibility rules: [Architecture](docs/architecture.md). Edit `fixtures/sample-session.json` to exercise different message, tool, and usage states.
