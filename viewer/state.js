export function createSessionState() {
	return {
		connection: "connecting",
		session: { id: undefined, startedAt: undefined, cwd: "", metrics: emptyMetrics(), model: undefined, thinkingLevel: undefined, endedAt: undefined, contextPoints: [], markers: [] },
		turns: {},
		turnOrder: [],
		currentTurnId: undefined,
		selectedTurnId: undefined,
		messageTurns: {},
		toolTurns: {},
		runTurns: {},
		orphanRunEvidence: {},
		evidence: {},
		evidenceByTurn: {},
		lastSeq: 0,
		pending: {},
		duplicates: 0,
		gaps: [],
	};
}

export function reduceIncoming(state, message) {
	const next = clone(state);
	if (message?.type === "hello") return applyHello(next, message);
	if (message?.type === "transport.flush") return flushPending(next);
	if (message?.v !== 2 || !Number.isInteger(message.seq)) return next;
	if (next.session.id && message.sessionId !== next.session.id) return next;
	if (message.seq <= next.lastSeq || next.pending[message.seq]) {
		next.duplicates += 1;
		return next;
	}
	next.pending[message.seq] = message;
	drainContiguous(next);
	return next;
}

export function selectTurn(state, turnId) {
	if (!state.turns[turnId]) return state;
	return { ...state, selectedTurnId: turnId };
}

export function selectedTurn(state) {
	return state.selectedTurnId ? state.turns[state.selectedTurnId] : undefined;
}

export function turnEvidence(state, turnId) {
	return (state.evidenceByTurn[turnId] ?? []).map((id) => state.evidence[id]).filter(Boolean);
}

export function buildRibbonSegments(turn, now = Date.now()) {
	const start = turn.startedAt;
	const end = turn.endedAt ?? Math.max(start + 1, now);
	const duration = Math.max(1, end - start);
	const tools = Object.values(turn.tools ?? {})
		.filter((tool) => Number.isFinite(tool.startedAt))
		.map((tool) => ({ start: clamp(tool.startedAt, start, end), end: clamp(tool.endedAt ?? now, start, end) }))
		.filter((interval) => interval.end >= interval.start);
	const response = turn.responseStartedAt
		? { start: clamp(turn.responseStartedAt, start, end), end: clamp(turn.responseEndedAt ?? now, start, end) }
		: undefined;
	const boundaries = new Set([start, end]);
	for (const interval of tools) {
		boundaries.add(interval.start);
		boundaries.add(interval.end);
	}
	if (response) {
		boundaries.add(response.start);
		boundaries.add(response.end);
	}
	const ordered = [...boundaries].sort((a, b) => a - b);
	const segments = [];
	for (let index = 0; index < ordered.length - 1; index += 1) {
		const intervalStart = ordered[index];
		const intervalEnd = ordered[index + 1];
		const middle = intervalStart + (intervalEnd - intervalStart) / 2;
		const type = tools.some((interval) => middle >= interval.start && middle <= interval.end)
			? "tool"
			: response && middle >= response.start && middle <= response.end
				? "response"
				: "outside";
		const previous = segments.at(-1);
		if (previous?.type === type) previous.end = intervalEnd;
		else segments.push({ type, start: intervalStart, end: intervalEnd });
	}
	return segments.map((segment) => ({
		...segment,
		left: ((segment.start - start) / duration) * 100,
		width: Math.max(0.8, ((segment.end - segment.start) / duration) * 100),
	}));
}

export function deriveSignals(turn) {
	const tools = Object.values(turn.tools ?? {}).sort((a, b) => a.startedAt - b.startedAt);
	const signals = [];
	const counts = new Map();
	for (const tool of tools) counts.set(tool.name, (counts.get(tool.name) ?? 0) + 1);
	for (const [name, count] of counts) {
		if (count > 1) signals.push(`${name} repeated ${count} times`);
	}
	if (tools.some((tool, index) => index > 0 && tool.isError && tools[index - 1]?.isError)) {
		signals.push("Consecutive tool errors observed");
	}
	const wall = turn.durationMs ?? Math.max(0, Date.now() - turn.startedAt);
	const longTool = tools.find((tool) => tool.durationMs !== undefined && tool.durationMs >= Math.max(10_000, wall * 0.5));
	if (longTool) signals.push(`${longTool.name} occupied ${formatDuration(longTool.durationMs)} of the turn`);
	const activeTools = tools.filter((tool) => tool.endedAt === undefined);
	if (activeTools.length > 0 && !turn.responseStartedAt) {
		signals.push(`${activeTools.length} tool${activeTools.length === 1 ? " is" : "s are"} active; no assistant response yet`);
	}
	if (turn.status === "completed" && tools.at(-1)?.isError) signals.push("Turn completed after the latest tool ended in error");
	return signals;
}

function applyHello(state, hello) {
	state.connection = "live";
	state.session.id = hello.sessionId;
	state.session.startedAt = hello.startedAt;
	state.session.cwd = hello.cwd;
	state.session.metrics = hello.metrics ?? emptyMetrics();
	const snapshot = hello.snapshot;
	if (!snapshot) return state;
	state.lastSeq = Math.max(state.lastSeq, snapshot.sequence ?? 0);
	state.session.model = snapshot.model;
	state.session.thinkingLevel = snapshot.thinkingLevel;
	state.session.contextPoints = (snapshot.contextPoints ?? []).map((point) => ({ ...point, snapshot: { ...point.snapshot } }));
	state.session.markers = (snapshot.markers ?? []).map((marker) => ({ ...marker }));
	for (const facts of snapshot.completedTurns ?? []) hydrateTurn(state, facts);
	if (snapshot.currentTurn) {
		hydrateTurn(state, snapshot.currentTurn);
		state.currentTurnId = snapshot.currentTurn.id;
	}
	for (const marker of snapshot.markers ?? []) {
		const turnId = marker.turnId ?? state.currentTurnId;
		if (turnId) addEvidence(state, turnId, `snapshot-marker:${marker.at}:${marker.type}`, { kind: "marker", at: marker.at, data: marker, fromSnapshot: true });
	}
	for (const item of snapshot.evidence ?? []) {
		if (!item.turnId) continue;
		addEvidence(state, item.turnId, `snapshot:${item.id}`, { kind: "metadata", at: item.at, data: item, fromSnapshot: true });
	}
	state.selectedTurnId = state.currentTurnId ?? state.turnOrder.at(-1) ?? state.selectedTurnId;
	for (const seq of Object.keys(state.pending)) if (Number(seq) <= state.lastSeq) delete state.pending[seq];
	drainContiguous(state);
	return state;
}

function drainContiguous(state) {
	while (state.pending[state.lastSeq + 1]) {
		const event = state.pending[state.lastSeq + 1];
		delete state.pending[state.lastSeq + 1];
		applyEvent(state, event);
		state.lastSeq = event.seq;
	}
}

function flushPending(state) {
	for (const seq of Object.keys(state.pending).map(Number).sort((a, b) => a - b)) {
		if (seq <= state.lastSeq) continue;
		if (seq > state.lastSeq + 1) state.gaps.push({ from: state.lastSeq + 1, to: seq - 1, observedAt: Date.now() });
		const event = state.pending[seq];
		delete state.pending[seq];
		applyEvent(state, event);
		state.lastSeq = seq;
	}
	return state;
}

function applyEvent(state, event) {
	const data = event.data ?? {};
	switch (event.type) {
		case "session.ended":
			state.connection = "ended";
			state.session.endedAt = data.endedAt;
			return;
		case "metrics":
			state.session.metrics = data;
			return;
		case "session.model.changed":
			state.session.model = data.model;
			state.session.thinkingLevel = data.thinkingLevel ?? state.session.thinkingLevel;
			if (state.currentTurnId) addEvidence(state, state.currentTurnId, `marker:${event.seq}`, { kind: "marker", at: event.at, data: { type: event.type, ...data } });
			state.session.markers.push({ type: "model", at: event.at, turnId: state.currentTurnId, detail: "Model changed" });
			break;
		case "session.thinking.changed":
			state.session.thinkingLevel = data.level;
			if (state.currentTurnId) addEvidence(state, state.currentTurnId, `marker:${event.seq}`, { kind: "marker", at: event.at, data: { type: event.type, ...data } });
			state.session.markers.push({ type: "thinking", at: event.at, turnId: state.currentTurnId, detail: `${data.previousLevel} → ${data.level}` });
			break;
		case "turn.started": {
			const turn = ensureTurn(state, data.id, { ...data, startedAt: event.at, status: "active" });
			state.currentTurnId = turn.id;
			state.selectedTurnId = turn.id;
			break;
		}
		case "turn.completed": {
			const turn = ensureTurn(state, data.id, data);
			Object.assign(turn, normalizeFacts(data));
			if (state.currentTurnId === turn.id) state.currentTurnId = undefined;
			break;
		}
		case "run.completed": {
			const turnId = state.runTurns[data.id] ?? (state.turns[data.id] ? data.id : state.currentTurnId);
			if (!turnId) break;
			const turn = ensureTurn(state, turnId);
			turn.status = "completed";
			turn.endedAt ??= event.at;
			turn.durationMs ??= Math.max(0, event.at - turn.startedAt);
			turn.modelRequests = data.modelRequests;
			turn.usage = data.usage;
			if (state.currentTurnId === turnId) state.currentTurnId = undefined;
			break;
		}
		case "message.completed": {
			let turnId = data.sessionTurnId ?? state.messageTurns[data.id] ?? state.currentTurnId;
			if (!turnId && data.role === "user") {
				turnId = `observed-${data.id}`;
				ensureTurn(state, turnId, { startedAt: event.at, status: "active", prompt: data.text });
				state.currentTurnId = turnId;
				state.selectedTurnId = turnId;
			}
			if (!turnId) break;
			state.messageTurns[data.id] = turnId;
			const turn = ensureTurn(state, turnId);
			if (data.role === "user") turn.prompt = data.text;
			else {
				turn.assistantText = data.text;
				if (data.text) turn.responseStartedAt ??= event.at;
				turn.responseEndedAt = event.at;
			}
			addEvidence(state, turnId, `message:${data.id}`, { kind: data.role === "user" ? "prompt" : "assistant", at: event.at, data: { ...data } });
			break;
		}
		case "message.started": {
			const turnId = data.sessionTurnId ?? state.runTurns[data.runId] ?? state.currentTurnId ?? data.runId;
			if (!turnId) break;
			if (data.runId) {
				state.runTurns[data.runId] = turnId;
				for (const pending of state.orphanRunEvidence[data.runId] ?? []) addEvidence(state, turnId, pending.id, pending.item);
				delete state.orphanRunEvidence[data.runId];
			}
			state.messageTurns[data.id] = turnId;
			const turn = ensureTurn(state, turnId, { startedAt: event.at, status: "active" });
			turn.assistantStartedAt ??= event.at;
			addEvidence(state, turnId, `message:${data.id}`, { kind: "assistant", at: event.at, data: { ...data, text: "", thinking: "" } });
			break;
		}
		case "message.delta":
		case "message.thinking.delta": {
			const turnId = state.messageTurns[data.id] ?? state.currentTurnId;
			const item = turnId ? state.evidence[`message:${data.id}`] : undefined;
			if (!turnId || !item) break;
			const field = event.type === "message.delta" ? "text" : "thinking";
			item.data[field] = `${item.data[field] ?? ""}${data.text}`;
			if (event.type === "message.delta") ensureTurn(state, turnId).responseStartedAt ??= event.at;
			break;
		}
		case "run.systemPrompt": {
			const turnId = data.sessionTurnId ?? state.runTurns[data.runId] ?? state.currentTurnId;
			const pending = { id: `system:${data.runId}`, item: { kind: "system", at: event.at, data: { ...data } } };
			if (turnId) addEvidence(state, turnId, pending.id, pending.item);
			else (state.orphanRunEvidence[data.runId] ??= []).push(pending);
			break;
		}
		case "tool.started": {
			const turnId = data.sessionTurnId ?? state.currentTurnId;
			if (!turnId) break;
			state.toolTurns[data.id] = turnId;
			const turn = ensureTurn(state, turnId);
			turn.tools[data.id] = { id: data.id, name: data.name, startedAt: event.at, args: data.args, isError: undefined };
			turn.toolCount = Object.keys(turn.tools).length;
			addEvidence(state, turnId, `tool:${data.id}`, { kind: "tool", at: event.at, data: { ...turn.tools[data.id] } });
			break;
		}
		case "tool.completed": {
			const turnId = data.sessionTurnId ?? state.toolTurns[data.id] ?? state.currentTurnId;
			if (!turnId) break;
			const turn = ensureTurn(state, turnId);
			const tool = turn.tools[data.id] ?? { id: data.id, name: data.name, startedAt: event.at };
			Object.assign(tool, { endedAt: event.at, isError: data.isError, result: data.result, ...(data.durationKnown !== false ? { durationMs: data.durationMs } : {}) });
			turn.tools[data.id] = tool;
			turn.toolCount = Object.keys(turn.tools).length;
			turn.errorCount = Object.values(turn.tools).filter((item) => item.isError).length;
			addEvidence(state, turnId, `tool:${data.id}`, { kind: "tool", at: tool.startedAt, data: { ...tool } });
			break;
		}
		case "turn.usage": {
			const turnId = state.runTurns[data.runId] ?? data.runId ?? state.currentTurnId;
			if (!turnId) break;
			const turn = ensureTurn(state, turnId);
			turn.modelRequests = (turn.modelRequests ?? 0) + 1;
			turn.contextEnd = data.contextSnapshot ?? turn.contextEnd;
			if (data.contextSnapshot) state.session.contextPoints.push({ at: event.at, turnId, snapshot: { ...data.contextSnapshot } });
			addEvidence(state, turnId, `usage:${data.id}`, { kind: "usage", at: event.at, data: { ...data } });
			break;
		}
		case "session.compacted":
		{
			const turnId = data.sessionTurnId ?? state.currentTurnId;
			if (turnId) addEvidence(state, turnId, `marker:${event.seq}`, { kind: "marker", at: event.at, data: { type: event.type, ...data } });
			state.session.markers.push({ type: "compaction", at: event.at, turnId, detail: `${data.reason} · ${data.tokensBefore} tokens before`, summary: data.summary });
			break;
		}
	}
}

function hydrateTurn(state, facts) {
	const turn = ensureTurn(state, facts.id, normalizeFacts(facts));
	Object.assign(turn, normalizeFacts(facts));
	return turn;
}

function normalizeFacts(facts) {
	return {
		...facts,
		tools: Object.fromEntries((facts.tools ?? []).map((tool) => [tool.id, { ...tool }])),
	};
}

function ensureTurn(state, id, seed = {}) {
	if (!state.turns[id]) {
		state.turns[id] = {
			id,
			status: "active",
			startedAt: seed.startedAt ?? Date.now(),
			prompt: "",
			modelRequests: 0,
			usage: {},
			toolCount: 0,
			errorCount: 0,
			tools: {},
			...seed,
		};
		state.turnOrder.push(id);
		state.evidenceByTurn[id] = [];
	}
	return state.turns[id];
}

function addEvidence(state, turnId, id, item) {
	ensureTurn(state, turnId, { startedAt: item.at });
	if (!state.evidence[id]) state.evidenceByTurn[turnId].push(id);
	state.evidence[id] = { id, turnId, ...item };
}

function emptyMetrics() {
	return { modelRequests: 0, usage: {}, tools: 0 };
}

function clone(value) {
	return structuredClone(value);
}

function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}

function formatDuration(milliseconds) {
	return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}
