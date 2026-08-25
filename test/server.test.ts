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
