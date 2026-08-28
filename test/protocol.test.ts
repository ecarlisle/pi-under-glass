import assert from "node:assert/strict";
import test from "node:test";

import { createEvent, PROTOCOL_VERSION } from "../src/protocol.js";

test("creates a versioned event envelope", () => {
	const event = createEvent("session-1", 7, "message.delta", { id: "message-1", text: "hello" }, 1234);
	assert.deepEqual(event, {
		v: PROTOCOL_VERSION,
		seq: 7,
		at: 1234,
		sessionId: "session-1",
		type: "message.delta",
		data: { id: "message-1", text: "hello" },
	});
});

test("represents a system prompt as Turn configuration", () => {
	const event = createEvent("session-1", 8, "run.systemPrompt", { runId: "run-1", text: "Be concise." }, 1235);
	assert.deepEqual(event.data, { runId: "run-1", text: "Be concise." });
});

test("represents concise session-state changes", () => {
	const model = createEvent("session-1", 9, "session.model.changed", {
		model: { provider: "anthropic", id: "claude-sonnet-4", name: "Claude Sonnet 4" },
		previousModel: { provider: "openai", id: "gpt-5", name: "GPT-5" },
		source: "set",
		thinkingLevel: "high",
	});
	assert.equal(model.data.model.id, "claude-sonnet-4");
	assert.equal(model.data.thinkingLevel, "high");

	const thinking = createEvent("session-1", 10, "session.thinking.changed", {
		level: "medium",
		previousLevel: "high",
	});
	assert.deepEqual(thinking.data, { level: "medium", previousLevel: "high" });

	const compacted = createEvent("session-1", 11, "session.compacted", {
		reason: "threshold",
		tokensBefore: 92_000,
		summary: "The project is local-first and validation is green.",
		fromExtension: false,
		willRetry: false,
	});
	assert.deepEqual(compacted.data, {
		reason: "threshold",
		tokensBefore: 92_000,
		summary: "The project is local-first and validation is green.",
		fromExtension: false,
		willRetry: false,
	});
});

test("represents user-goal Turn lifecycle facts without changing legacy request usage", () => {
	const started = createEvent("session-1", 12, "turn.started", {
		id: "turn-1",
		prompt: "Inspect the project",
		model: { provider: "openai", id: "gpt-5", name: "GPT-5" },
		thinkingLevel: "high",
	}, 2000);
	assert.equal(started.data.prompt, "Inspect the project");

	const completed = createEvent("session-1", 13, "turn.completed", {
		id: "turn-1",
		status: "completed",
		startedAt: 2000,
		endedAt: 2400,
		durationMs: 400,
		prompt: "Inspect the project",
		modelRequests: 0,
		usage: {},
		toolCount: 1,
		errorCount: 0,
		tools: [{ id: "tool-1", name: "read", startedAt: 2050, endedAt: 2100, durationMs: 50, isError: false }],
	}, 2400);
	assert.equal(completed.data.durationMs, 400);
	assert.equal(completed.data.modelRequests, 0);
});
