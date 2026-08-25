import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";

import { createEvent, PROTOCOL_VERSION } from "../src/protocol.js";
import { startViewerServer } from "../src/server.js";

const hello = () => ({
	v: PROTOCOL_VERSION,
	type: "hello" as const,
	sessionId: "session-1",
	startedAt: 1,
	cwd: "/tmp/project",
	metrics: { modelRequests: 0, usage: {}, tools: 0 },
});

test("serves the viewer and authenticates WebSocket clients", async (context) => {
	const token = "test-token";
	const server = await startViewerServer({ token, hello });
	context.after(() => server.close());

	const authorized = await fetch(server.url);
	assert.equal(authorized.status, 200);
	assert.match(await authorized.text(), /Pi Under Glass/);

	const unauthorized = await fetch(`http://${server.host}:${server.port}/`);
	assert.equal(unauthorized.status, 401);

	const socket = new WebSocket(`ws://${server.host}:${server.port}/events?token=${token}`);
	context.after(() => socket.close());
	const [payload] = await once(socket, "message");
	assert.equal(JSON.parse(String(payload)).type, "hello");

	const nextMessage = once(socket, "message");
	server.publish(createEvent("session-1", 1, "message.delta", { id: "message-1", text: "live" }));
	const [livePayload] = await nextMessage;
	assert.equal(JSON.parse(String(livePayload)).data.text, "live");
});

test("rejects a WebSocket client with the wrong token", async (context) => {
	const server = await startViewerServer({ token: "right", hello });
	context.after(() => server.close());

	const socket = new WebSocket(`ws://${server.host}:${server.port}/events?token=wrong`);
	context.after(() => socket.close());
	const [error] = await once(socket, "error");
	assert.match(String(error), /401/);
});

test("forwards tool args and results to viewers", async (context) => {
	const token = "test-token";
	const server = await startViewerServer({ token, hello });
	context.after(() => server.close());

	const socket = new WebSocket(`ws://${server.host}:${server.port}/events?token=${token}`);
	context.after(() => socket.close());
	await once(socket, "message"); // hello

	const started = once(socket, "message");
	server.publish(createEvent("session-1", 2, "tool.started", { id: "tool-1", name: "bash", args: { command: "ls" } }));
	const [startedMessage] = await started;
	assert.deepEqual(JSON.parse(String(startedMessage)).data.args, { command: "ls" });

	const completed = once(socket, "message");
	server.publish(
		createEvent("session-1", 3, "tool.completed", {
			id: "tool-1",
			name: "bash",
			isError: false,
			durationMs: 12,
			result: "src\nviewer",
		}),
	);
	const [completedMessage] = await completed;
	assert.equal(JSON.parse(String(completedMessage)).data.result, "src\nviewer");
});

test("forwards thinking deltas and completed thinking to viewers", async (context) => {
	const token = "test-token";
	const server = await startViewerServer({ token, hello });
	context.after(() => server.close());

	const socket = new WebSocket(`ws://${server.host}:${server.port}/events?token=${token}`);
	context.after(() => socket.close());
	await once(socket, "message"); // hello

	const delta = once(socket, "message");
	server.publish(
		createEvent("session-1", 2, "message.thinking.delta", { id: "message-1", text: "hmm, let me think" }),
	);
	const [deltaMessage] = await delta;
	assert.equal(JSON.parse(String(deltaMessage)).data.text, "hmm, let me think");

	const completed = once(socket, "message");
	server.publish(
		createEvent("session-1", 3, "message.completed", {
			id: "message-1",
			role: "assistant",
			text: "Here is the answer.",
			thinking: "Reasoned step by step.",
		}),
	);
	const [completedMessage] = await completed;
	assert.equal(JSON.parse(String(completedMessage)).data.thinking, "Reasoned step by step.");
});
