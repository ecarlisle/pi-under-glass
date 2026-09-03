import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";

import piUnderGlass from "../src/index.js";

test("publishes user-goal Turn facts and hydrates a late viewer", async () => {
	const handlers = new Map<string, (event: any, context: any) => void | Promise<void>>();
	let command: { handler(args: string, context: any): Promise<void> } | undefined;
	const notices: string[] = [];
	const pi = {
		on(name: string, handler: (event: any, context: any) => void | Promise<void>) { handlers.set(name, handler); },
		registerCommand(_name: string, registered: { handler(args: string, context: any): Promise<void> }) { command = registered; },
		async exec() { return { code: 0, stderr: "" }; },
	};
	const context = {
		cwd: "/tmp/project",
		mode: "json",
		ui: { notify(message: string) { notices.push(message); } },
		model: { provider: "openai", id: "gpt-5", name: "GPT-5", contextWindow: 128_000 },
		thinkingLevel: "high",
	};
	piUnderGlass(pi);
	await handlers.get("session_start")?.({}, context);
	await command?.handler("", context);
	const url = notices.at(-1)?.match(/https?:\/\/\S+/)?.[0];
	assert.ok(url);
	const parsed = new URL(url);
	const socket = new WebSocket(`ws://${parsed.host}/events?token=${parsed.searchParams.get("token")}`);
	const [helloPayload] = await once(socket, "message");
	const hello = JSON.parse(String(helloPayload));
	assert.equal(hello.snapshot.model.id, "gpt-5");

	await handlers.get("before_agent_start")?.({ prompt: "Inspect the project", systemPrompt: "Be precise." }, context);
	await handlers.get("turn_start")?.({}, context);
	await handlers.get("message_start")?.({ message: { role: "user", content: "Inspect the project" } }, context);
	await handlers.get("tool_execution_start")?.({ toolCallId: "tool-1", toolName: "read", args: { path: "README.md" } }, context);
	await handlers.get("tool_execution_end")?.({ toolCallId: "tool-1", toolName: "read", isError: false, result: "Project docs" }, context);

	const late = new WebSocket(`ws://${parsed.host}/events?token=${parsed.searchParams.get("token")}`);
	const [latePayload] = await once(late, "message");
	const lateHello = JSON.parse(String(latePayload));
	assert.equal(lateHello.snapshot.currentTurn.prompt, "Inspect the project");
	assert.equal(lateHello.snapshot.currentTurn.toolCount, 1);
	assert.equal(lateHello.snapshot.currentTurn.tools[0].name, "read");
	late.close();

	await handlers.get("message_start")?.({ message: { role: "assistant", content: [] } }, context);
	await handlers.get("message_update")?.({ assistantMessageEvent: { type: "thinking_delta", delta: "Considering" } }, context);
	await handlers.get("message_update")?.({ assistantMessageEvent: { type: "text_delta", delta: "Done." } }, context);
	await handlers.get("message_end")?.({ message: { role: "assistant", content: "Done." } }, context);
	const invocationCompleted = waitForEvent(socket, "turn.usage");
	await handlers.get("turn_end")?.({ message: { role: "assistant", content: "Done.", usage: { input: 0, output: 0, cost: { total: 0 } } } }, context);
	const invocationEvent = await invocationCompleted;
	assert.equal(invocationEvent.data.id, "invocation-1");
	assert.equal(typeof invocationEvent.data.firstOutputMs, "number");
	assert.equal(typeof invocationEvent.data.firstTextMs, "number");
	assert.ok(invocationEvent.data.firstOutputMs <= invocationEvent.data.firstTextMs);
	assert.ok(invocationEvent.data.firstTextMs <= invocationEvent.data.durationMs);
	const completed = waitForEvent(socket, "turn.completed");
	await handlers.get("agent_settled")?.({}, context);
	const completedEvent = await completed;
	assert.equal(completedEvent.data.status, "completed");
	assert.equal(completedEvent.data.id, "turn-1");
	assert.equal(completedEvent.data.prompt, "Inspect the project");
	assert.equal(completedEvent.data.toolCount, 1);
	assert.equal(completedEvent.data.usage.inputTokens, 0);
	assert.equal(completedEvent.data.agentReportedExcerpt, "Done.");
	assert.equal(completedEvent.data.invocations.length, 1);
	assert.equal(completedEvent.data.invocations[0].firstTextMs, invocationEvent.data.firstTextMs);

	const ended = waitForEvent(socket, "session.ended");
	await handlers.get("session_shutdown")?.({}, context);
	assert.equal((await ended).type, "session.ended");
});

function waitForEvent(socket: WebSocket, type: string): Promise<any> {
	return new Promise((resolve) => {
		const onMessage = (payload: Buffer) => {
			const event = JSON.parse(String(payload));
			if (event.type !== type) return;
			socket.off("message", onMessage);
			resolve(event);
		};
		socket.on("message", onMessage);
	});
}
