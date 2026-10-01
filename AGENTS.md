# AGENTS.md

Pi Under Glass is a minimal, local-first Pi extension. It exposes the current Pi session in a plain browser transcript with basic totals; it is not a desktop app, installer, or general observability platform.

## Working principles

- Make the smallest change that directly satisfies the request.
- Do not refactor, reformat, or clean up adjacent code unless requested; remove only artifacts your change made unused.
- Match the existing style.
- Surface material assumptions or competing interpretations before implementing.
- For nontrivial work, define observable success criteria and verify them.
- Preserve unrelated work. Do not commit unless explicitly asked.

## Task-specific guidance

Read each guide whose trigger matches the task. Load other documentation only as needed.

| Trigger | Guide |
| --- | --- |
| Writing or editing any doc here | [Writing docs and agent context](docs/documentation.md) |
| Modifying AGENTS.md's task table | [Task table](docs/task-table.md) |
| Agent/harness support, or adding a skill | [Deduplication policy](docs/deduplication.md) |
| Changing `src/`, `viewer/`, the wire protocol, or debug mode | [Architecture](docs/architecture.md) |
| Adding dependencies, features, or UI, or changing the server, protocol, or security behavior | [Guardrails](docs/guardrails.md) |
| Running, testing, smoke-testing, or packaging the extension | [Development and validation](docs/development.md) |
| Naming or describing sessions, turns, messages, usage, or latency in code, UI, or docs | [Terminology](docs/terms.md) |
| Changing viewer visuals, layout, colors, typography, or components | [Design system](.stitch/DESIGN.md) |
