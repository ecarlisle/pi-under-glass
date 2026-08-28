import { buildRibbonSegments, createSessionState, deriveSignals, reduceIncoming, selectTurn, selectedTurn, turnEvidence } from "./state.js";
import { createEvidenceRenderer } from "./transcript.js";

const elements = Object.fromEntries([
	"status", "elapsed", "activity", "tokens", "cost", "context-value", "model", "thinking-level", "sequence-health",
	"turn-list", "selected-title", "selected-prompt", "selected-facts", "selected-signals", "agent-reported", "evidence",
	"options-details", "show-usage", "show-tool-input", "show-tool-results", "show-timestamps", "show-thinking",
	"show-system-prompt", "expand-thinking", "expand-tools", "expand-compactions",
].map((id) => [camel(id), document.querySelector(`#${id}`)]));

const parameters = new URLSearchParams(location.search);
const token = parameters.get("token");
const debug = parameters.get("debug") === "1";
const PREFS_KEY = "pi-under-glass:options";
const optionElements = [elements.showUsage, elements.showToolInput, elements.showToolResults, elements.showTimestamps, elements.showThinking, elements.showSystemPrompt, elements.expandThinking, elements.expandTools, elements.expandCompactions];
let state = createSessionState();
let retryTimer;
let flushTimer;
let reconnectAttempts = 0;

restorePreferences();
for (const option of optionElements) option.addEventListener("change", () => { savePreferences(); render(); });
elements.optionsDetails.addEventListener("toggle", savePreferences);

const evidenceRenderer = createEvidenceRenderer(elements.evidence, () => ({
	showUsage: elements.showUsage.checked,
	showToolInput: elements.showToolInput.checked,
	showToolResults: elements.showToolResults.checked,
	showTimestamps: elements.showTimestamps.checked,
	showThinking: elements.showThinking.checked,
	showSystemPrompt: elements.showSystemPrompt.checked,
	expandThinking: elements.expandThinking.checked,
	expandTools: elements.expandTools.checked,
	expandCompactions: elements.expandCompactions.checked,
}));

function connect() {
	if (state.connection === "ended") return;
	if (!token) return setConnection("missing-token");
	setConnection(reconnectAttempts > 0 ? "reconnecting" : "connecting");
	const socket = new WebSocket(`ws://${location.host}/events?token=${encodeURIComponent(token)}`);
	socket.addEventListener("open", () => {
		reconnectAttempts = 0;
		setConnection("live");
	});
	socket.addEventListener("message", ({ data }) => {
		try { handle(JSON.parse(data)); } catch { /* Malformed local messages do not replace known-good state. */ }
	});
	socket.addEventListener("close", () => {
		if (state.connection === "ended") return render();
		reconnectAttempts += 1;
		setConnection("reconnecting");
		const delay = Math.min(1200 * 2 ** (reconnectAttempts - 1), 15_000);
		clearTimeout(retryTimer);
		retryTimer = setTimeout(connect, delay);
	});
}

function handle(message) {
	state = reduceIncoming(state, message);
	if (state.connection === "ended") clearTimeout(retryTimer);
	if (Object.keys(state.pending).length > 0) {
		clearTimeout(flushTimer);
		flushTimer = setTimeout(() => {
			state = reduceIncoming(state, { type: "transport.flush" });
			render();
		}, 250);
	}
	render();
}

async function playDebugFixture() {
	if (!token) return setConnection("missing-token");
	setConnection("sample");
	try {
		const response = await fetch(`/debug-fixture?token=${encodeURIComponent(token)}`);
		if (!response.ok) throw new Error("fixture unavailable");
		const fixture = await response.json();
		const fixtureStartedAt = Number.isFinite(fixture.hello?.startedAt) ? fixture.hello.startedAt : 0;
		const playbackStartedAt = Date.now();
		handle({ ...fixture.hello, startedAt: playbackStartedAt });
		setConnection("sample");
		for (const item of fixture.events ?? []) {
			const delay = Number.isFinite(item.afterMs) ? Math.max(0, item.afterMs) : 0;
			if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
			const at = Number.isFinite(item.event?.at) ? playbackStartedAt + Math.max(0, item.event.at - fixtureStartedAt) : Date.now();
			handle({ ...item.event, at });
			setConnection("sample");
		}
	} catch {
		setConnection("sample-error");
	}
}

function setConnection(connection) {
	if (state.connection !== "ended") state = { ...state, connection };
	render();
}

function render() {
	renderStatus();
	renderSessionFacts();
	renderTurnList();
	renderSelectedTurn();
}

function renderStatus() {
	const labels = {
		live: "Live",
		sample: "Sample",
		connecting: "Connecting",
		reconnecting: `Reconnecting · attempt ${reconnectAttempts}`,
		ended: "Session ended",
		"missing-token": "Missing token",
		"sample-error": "Sample unavailable",
	};
	elements.status.textContent = labels[state.connection] ?? "Connecting";
	elements.status.className = `status status--${state.connection}`;
}

function renderSessionFacts() {
	const metrics = state.session.metrics ?? { modelRequests: 0, usage: {}, tools: 0 };
	elements.activity.textContent = `${formatNumber(metrics.modelRequests)} request${metrics.modelRequests === 1 ? "" : "s"} · ${formatNumber(metrics.tools)} tool${metrics.tools === 1 ? "" : "s"}`;
	const usage = metrics.usage ?? {};
	elements.tokens.textContent = usage.inputTokens === undefined && usage.outputTokens === undefined ? "Unavailable" : `${usage.inputTokens === undefined ? "—" : formatNumber(usage.inputTokens)} in / ${usage.outputTokens === undefined ? "—" : formatNumber(usage.outputTokens)} out`;
	elements.cost.textContent = usage.cost === undefined ? "Unavailable" : `$${usage.cost.toFixed(4)}`;
	const latestContext = metrics.latestContext ?? state.session.contextPoints.at(-1)?.snapshot;
	elements.contextValue.textContent = latestContext ? `${formatNumber(latestContext.inputTokens)}${latestContext.contextWindow ? ` / ${formatNumber(latestContext.contextWindow)}` : ""} tokens` : "Unavailable";
	elements.model.textContent = state.session.model ? formatModel(state.session.model) : "Unavailable";
	elements.thinkingLevel.textContent = state.session.thinkingLevel ? titleCase(state.session.thinkingLevel) : "Unavailable";
	const pending = Object.keys(state.pending).length;
	elements.sequenceHealth.textContent = state.gaps.length > 0 ? `${state.gaps.length} event gap${state.gaps.length === 1 ? "" : "s"} observed` : pending > 0 ? `Waiting for ${pending} event${pending === 1 ? "" : "s"}` : state.duplicates > 0 ? `${state.duplicates} duplicate${state.duplicates === 1 ? "" : "s"} ignored` : "Complete since connected";
}

function renderTurnList() {
	elements.turnList.replaceChildren();
	if (state.turnOrder.length === 0) {
		const empty = document.createElement("p");
		empty.className = "empty";
		empty.textContent = "Send Pi a prompt to see the first turn.";
		elements.turnList.append(empty);
		return;
	}
	state.turnOrder.forEach((turnId, index) => {
		const turn = state.turns[turnId];
		const row = document.createElement("article");
		row.className = `turn-row${state.selectedTurnId === turnId ? " selected" : ""}`;
		row.tabIndex = 0;
		row.setAttribute("role", "button");
		row.setAttribute("aria-pressed", String(state.selectedTurnId === turnId));
		row.addEventListener("click", () => chooseTurn(turnId));
		row.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); chooseTurn(turnId); } });
		const heading = document.createElement("div");
		heading.className = "turn-row-heading";
		const label = document.createElement("strong");
		label.textContent = `Turn ${index + 1}`;
		const excerpt = document.createElement("span");
		excerpt.textContent = excerptText(turn.prompt || "Prompt unavailable", 72);
		heading.append(label, excerpt);
		const facts = document.createElement("div");
		facts.className = "turn-row-facts";
		facts.append(factBadge(statusLabel(turn.status), turn.status === "active" ? "active" : turn.status === "interrupted" ? "error" : "neutral"));
		facts.append(factBadge(formatDuration(turn.durationMs ?? Math.max(0, Date.now() - turn.startedAt)), "neutral"));
		facts.append(factBadge(`${turn.toolCount ?? Object.keys(turn.tools ?? {}).length} tools`, "neutral"));
		facts.append(factBadge(`${turn.errorCount ?? 0} errors`, turn.errorCount > 0 ? "error" : "neutral"));
		row.append(heading, renderRibbon(turn), facts);
		elements.turnList.append(row);
	});
}

function renderRibbon(turn) {
	const ribbon = document.createElement("div");
	ribbon.className = "turn-ribbon";
	ribbon.setAttribute("aria-label", "Turn event ribbon");
	for (const segment of buildRibbonSegments(turn)) {
		const item = document.createElement("span");
		item.className = `ribbon-segment ribbon-segment--${segment.type}`;
		item.style.left = `${segment.left}%`;
		item.style.width = `${segment.width}%`;
		item.title = segment.type === "tool" ? "Tool activity" : segment.type === "response" ? "Assistant response" : "Outside tools";
		item.tabIndex = 0;
		item.addEventListener("click", (event) => { event.stopPropagation(); chooseTurn(turn.id, segment.type); });
		ribbon.append(item);
	}
	const evidence = turnEvidence(state, turn.id);
	const end = turn.endedAt ?? Date.now();
	const duration = Math.max(1, end - turn.startedAt);
	const points = [{ type: "prompt", at: turn.startedAt }, ...evidence.filter((item) => item.kind === "marker" || (item.kind === "tool" && item.data.isError)).map((item) => ({ type: item.kind === "marker" ? "marker" : "error", at: item.at }))];
	for (const point of points) {
		const marker = document.createElement("span");
		marker.className = `ribbon-point ribbon-point--${point.type}`;
		marker.style.left = `${Math.min(100, Math.max(0, ((point.at - turn.startedAt) / duration) * 100))}%`;
		marker.title = point.type === "prompt" ? "User prompt" : point.type === "error" ? "Tool error" : "Session marker";
		ribbon.append(marker);
	}
	return ribbon;
}

function chooseTurn(turnId, segmentType) {
	state = selectTurn(state, turnId);
	render();
	if (!segmentType) return;
	const kind = segmentType === "tool" ? "tool" : segmentType === "response" ? "assistant" : segmentType === "prompt" ? "prompt" : undefined;
	const target = kind ? turnEvidence(state, turnId).find((item) => item.kind === kind) : undefined;
	if (target) evidenceRenderer.focus(target.id);
}

function renderSelectedTurn() {
	const turn = selectedTurn(state);
	if (!turn) {
		elements.selectedTitle.textContent = "Selected turn";
		elements.selectedPrompt.textContent = "Choose a turn from the session overview.";
		elements.selectedFacts.replaceChildren();
		elements.selectedSignals.replaceChildren();
		elements.agentReported.hidden = true;
		evidenceRenderer.render(state, undefined);
		return;
	}
	const index = state.turnOrder.indexOf(turn.id) + 1;
	elements.selectedTitle.textContent = `Turn ${index} evidence`;
	elements.selectedPrompt.textContent = turn.prompt || "Prompt unavailable";
	elements.selectedFacts.replaceChildren(
		fact("Status", statusLabel(turn.status)),
		fact("Wall time", formatDuration(turn.durationMs ?? Math.max(0, Date.now() - turn.startedAt))),
		fact("Tools", formatNumber(turn.toolCount ?? Object.keys(turn.tools ?? {}).length)),
		fact("Errors", formatNumber(turn.errorCount ?? 0)),
		fact("Model requests", formatNumber(turn.modelRequests ?? 0)),
		fact("Context", formatContext(turn)),
	);
	const signals = deriveSignals(turn);
	elements.selectedSignals.replaceChildren();
	elements.selectedSignals.hidden = signals.length === 0;
	for (const signal of signals) {
		const item = document.createElement("li");
		item.textContent = signal;
		elements.selectedSignals.append(item);
	}
	const agentReported = turn.agentReportedExcerpt ?? turn.assistantText;
	if (agentReported) {
		elements.agentReported.hidden = false;
		elements.agentReported.querySelector("p").textContent = excerptText(agentReported, 180);
	} else elements.agentReported.hidden = true;
	evidenceRenderer.render(state, turn.id);
}

function fact(label, value) {
	const wrapper = document.createElement("div");
	const name = document.createElement("span");
	name.textContent = label;
	const content = document.createElement("strong");
	content.textContent = value;
	wrapper.append(name, content);
	return wrapper;
}

function factBadge(text, kind) {
	const badge = document.createElement("span");
	badge.className = `fact-badge fact-badge--${kind}`;
	badge.textContent = text;
	return badge;
}

function restorePreferences() {
	let saved = {};
	try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}"); } catch { /* Use defaults. */ }
	for (const option of optionElements) if (typeof saved[option.id] === "boolean") option.checked = saved[option.id];
	if (typeof saved.optionsOpen === "boolean") elements.optionsDetails.open = saved.optionsOpen;
}

function savePreferences() {
	const prefs = { optionsOpen: elements.optionsDetails.open };
	for (const option of optionElements) prefs[option.id] = option.checked;
	try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* Private browsing may reject writes. */ }
}

function formatModel(model) {
	return model.name && model.name !== model.id ? `${model.name} (${model.provider}/${model.id})` : `${model.provider}/${model.id}`;
}

function formatContext(turn) {
	const start = turn.contextStart?.inputTokens;
	const end = turn.contextEnd?.inputTokens;
	if (start === undefined && end === undefined) return "Unavailable";
	if (start === undefined) return `${formatNumber(end)} tokens`;
	if (end === undefined) return `${formatNumber(start)} tokens at start`;
	return `${formatNumber(start)} → ${formatNumber(end)}`;
}

function statusLabel(status) { return status === "active" ? "In progress" : status === "interrupted" ? "Interrupted" : "Completed"; }
function formatDuration(milliseconds) {
	if (milliseconds < 1000) return `${Math.round(milliseconds)}ms`;
	const seconds = milliseconds / 1000;
	return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
function excerptText(text, length) { const compact = text.replace(/\s+/g, " ").trim(); return compact.length <= length ? compact : `${compact.slice(0, length - 1)}…`; }
function formatNumber(value) { return new Intl.NumberFormat().format(value); }
function titleCase(value) { return `${value.charAt(0).toUpperCase()}${value.slice(1)}`; }
function camel(value) { return value.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()); }

setInterval(() => {
	const base = state.session.startedAt ?? Date.now();
	const end = state.session.endedAt ?? Date.now();
	elements.elapsed.textContent = formatDuration(Math.max(0, end - base));
	if (state.currentTurnId) renderTurnList();
}, 1000);

render();
if (debug) void playDebugFixture();
else connect();
