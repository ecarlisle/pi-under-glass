import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The browser state module is intentionally plain JavaScript so the dependency-free viewer can
// import it directly. Its behavior is covered here through the same public reducer API.
// @ts-expect-error The standalone browser module does not ship TypeScript declarations.
import { buildRibbonSegments, createSessionState, deriveSignals, reduceIncoming, turnEvidence } from "../viewer/state.js";

const hello = {
	v: 2,
	type: "hello",
	sessionId: "session-1",
	startedAt: 100,
	cwd: "/tmp/project",
	metrics: { modelRequests: 0, usage: {}, tools: 0 },
};

function event(seq: number, type: string, data: Record<string, unknown>, at = 100 + seq) {
	return { v: 2, seq, at, sessionId: "session-1", type, data };
}

test("reduces events without mutating the previous state", () => {
	const initial = reduceIncoming(createSessionState(), hello);
	const next = reduceIncoming(initial, event(1, "turn.started", { id: "turn-1", prompt: "Inspect this" }));
	assert.equal(initial.turnOrder.length, 0);
	assert.deepEqual(next.turnOrder, ["turn-1"]);
	assert.equal(next.turns["turn-1"].prompt, "Inspect this");
});

test("orders adjacent events, ignores duplicates, and records flushed gaps", () => {
	let state = reduceIncoming(createSessionState(), hello);
	state = reduceIncoming(state, event(2, "message.completed", { id: "user-1", role: "user", text: "Hello", sessionTurnId: "turn-1" }));
	assert.equal(state.lastSeq, 0);
	state = reduceIncoming(state, event(1, "turn.started", { id: "turn-1", prompt: "Hello" }));
	assert.equal(state.lastSeq, 2);
	assert.equal(state.turns["turn-1"].prompt, "Hello");
	state = reduceIncoming(state, event(2, "message.completed", { id: "user-1", role: "user", text: "Duplicate", sessionTurnId: "turn-1" }));
	assert.equal(state.duplicates, 1);

	state = reduceIncoming(state, event(5, "session.thinking.changed", { level: "high", previousLevel: "medium" }));
	state = reduceIncoming(state, { type: "transport.flush" });
	assert.equal(state.lastSeq, 5);
	assert.deepEqual(state.gaps[0], { from: 3, to: 4, observedAt: state.gaps[0].observedAt });
});

test("hydrates trustworthy late-join orientation from hello snapshot", () => {
	const state = reduceIncoming(createSessionState(), {
		...hello,
		metrics: { modelRequests: 1, usage: { inputTokens: 20, outputTokens: 0 }, tools: 1 },
		snapshot: {
			sequence: 8,
			model: { provider: "openai", id: "gpt-5", name: "GPT-5" },
			thinkingLevel: "high",
			currentTurn: { id: "turn-2", status: "active", startedAt: 200, prompt: "Continue", modelRequests: 0, usage: {}, toolCount: 1, errorCount: 0, tools: [{ id: "tool-1", name: "read", startedAt: 210 }] },
			completedTurns: [{ id: "turn-1", status: "completed", startedAt: 100, endedAt: 190, durationMs: 90, prompt: "Inspect", modelRequests: 1, usage: { outputTokens: 0 }, toolCount: 0, errorCount: 0, tools: [], invocations: [{ id: "invocation-1", startedAt: 105, endedAt: 180, durationMs: 75, firstOutputMs: 20, firstTextMs: 30 }] }],
			contextPoints: [{ at: 190, turnId: "turn-1", snapshot: { inputTokens: 20 } }],
			markers: [{ type: "compaction", at: 195, turnId: "turn-2", detail: "manual · 20 tokens before", summary: "Retained facts" }],
			evidence: [{ id: "prior-tool", type: "tool.started", at: 210, turnId: "turn-2", label: "read" }],
		},
	});
	assert.equal(state.lastSeq, 8);
	assert.equal(state.session.model.id, "gpt-5");
	assert.equal(state.currentTurnId, "turn-2");
	assert.deepEqual(state.turnOrder, ["turn-1", "turn-2"]);
	assert.equal(state.turns["turn-1"].invocations[0].firstOutputMs, 20);
	assert.ok(turnEvidence(state, "turn-2").some((item: { kind: string }) => item.kind === "metadata"));
});

test("records per-invocation latency even when provider usage is unavailable", () => {
	let state = reduceIncoming(createSessionState(), hello);
	state = reduceIncoming(state, event(1, "turn.started", { id: "turn-1", prompt: "Measure it" }, 100));
	state = reduceIncoming(state, event(2, "turn.usage", { id: "invocation-1", runId: "turn-1", usage: {}, startedAt: 110, endedAt: 180, durationMs: 70, firstOutputMs: 15, firstTextMs: 25 }, 180));
	assert.equal(state.turns["turn-1"].modelRequests, 1);
	assert.deepEqual(state.turns["turn-1"].invocations[0], { id: "invocation-1", startedAt: 110, endedAt: 180, durationMs: 70, firstOutputMs: 15, firstTextMs: 25 });
	assert.equal(turnEvidence(state, "turn-1").find((item: { kind: string }) => item.kind === "usage")?.data.firstTextMs, 25);
});

test("keeps zero usage, interrupted tools, errors, and session markers factual", () => {
	let state = reduceIncoming(createSessionState(), hello);
	state = reduceIncoming(state, event(1, "turn.started", { id: "turn-1", prompt: "Run it" }, 100));
	state = reduceIncoming(state, event(2, "tool.started", { id: "tool-1", name: "check", sessionTurnId: "turn-1" }, 110));
	state = reduceIncoming(state, event(3, "session.compacted", { reason: "manual", tokensBefore: 50, summary: "Kept", fromExtension: false, willRetry: false }, 115));
	state = reduceIncoming(state, event(4, "session.model.changed", { model: { provider: "openai", id: "gpt-5", name: "GPT-5" }, source: "set" }, 116));
	state = reduceIncoming(state, event(5, "tool.completed", { id: "tool-1", name: "check", isError: true, durationMs: 20, sessionTurnId: "turn-1", result: "failed" }, 130));
	state = reduceIncoming(state, event(6, "turn.completed", { id: "turn-1", status: "interrupted", startedAt: 100, endedAt: 140, durationMs: 40, prompt: "Run it", modelRequests: 1, usage: { inputTokens: 0, outputTokens: 0, cost: 0 }, toolCount: 1, errorCount: 1, tools: [{ id: "tool-1", name: "check", startedAt: 110, endedAt: 130, durationMs: 20, isError: true }] }, 140));
	assert.deepEqual(state.turns["turn-1"].usage, { inputTokens: 0, outputTokens: 0, cost: 0 });
	assert.equal(state.turns["turn-1"].status, "interrupted");
	assert.equal(state.turns["turn-1"].errorCount, 1);
	assert.equal(turnEvidence(state, "turn-1").filter((item: { kind: string }) => item.kind === "marker").length, 2);
});

test("does not present a tool duration when its start was not observed", () => {
	let state = reduceIncoming(createSessionState(), hello);
	state = reduceIncoming(state, event(1, "turn.started", { id: "turn-1", prompt: "Observe" }, 100));
	state = reduceIncoming(state, event(2, "tool.completed", { id: "tool-1", name: "shell", isError: false, durationMs: 0, durationKnown: false, sessionTurnId: "turn-1" }, 110));
	assert.equal(state.turns["turn-1"].tools["tool-1"].durationMs, undefined);
});

test("ribbons union overlapping tool activity and keep neutral outside-tool time", () => {
	const turn = {
		startedAt: 0,
		endedAt: 100,
		tools: {
			a: { startedAt: 20, endedAt: 60 },
			b: { startedAt: 40, endedAt: 80 },
		},
		responseStartedAt: 80,
		responseEndedAt: 100,
	};
	const segments = buildRibbonSegments(turn, 100);
	assert.deepEqual(segments.map((segment: { type: string; start: number; end: number }) => [segment.type, segment.start, segment.end]), [
		["outside", 0, 20],
		["tool", 20, 80],
		["response", 80, 100],
	]);
});

test("derives only structural tool signals", () => {
	const signals = deriveSignals({
		startedAt: 0,
		endedAt: 30_000,
		durationMs: 30_000,
		status: "completed",
		tools: {
			a: { name: "shell", startedAt: 100, endedAt: 12_100, durationMs: 12_000, isError: true },
			b: { name: "shell", startedAt: 13_000, endedAt: 14_000, durationMs: 1000, isError: true },
		},
	});
	assert.ok(signals.includes("shell repeated 2 times"));
	assert.ok(signals.includes("Consecutive tool errors observed"));
	assert.ok(signals.includes("Turn completed after the latest tool ended in error"));
	assert.ok(signals.every((signal: string) => !signal.toLowerCase().includes("validation")));
});

test("normalizes the legacy sample fixture into one turn per user prompt", async () => {
	const fixture = JSON.parse(await readFile(new URL("../fixtures/sample-session.json", import.meta.url), "utf8"));
	let state = reduceIncoming(createSessionState(), fixture.hello);
	for (const item of fixture.events) state = reduceIncoming(state, item.event);
	assert.equal(state.turnOrder.length, 3);
	assert.deepEqual(state.turnOrder.map((id: string) => state.turns[id].prompt), [
		"Summarize the project and its current validation status.",
		"Inspect the package scripts, run validation, and explain what you find.",
		"Run the missing-suite check and recover cleanly if it fails.",
	]);
	assert.equal(state.selectedTurnId, state.turnOrder[2]);
});
