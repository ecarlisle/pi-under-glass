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

test("represents a system prompt as Agent-run configuration", () => {
	const event = createEvent("session-1", 8, "run.systemPrompt", { runId: "run-1", text: "Be concise." }, 1235);
	assert.deepEqual(event.data, { runId: "run-1", text: "Be concise." });
});
