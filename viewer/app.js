import { buildRibbonSegments, createSessionState, deriveSignals, reduceIncoming, selectTurn, selectedTurn, timelineMarkers, turnLatency } from "./state.js";
import { createEvidenceRenderer } from "./transcript.js";

const elements = Object.fromEntries([
	"status", "elapsed", "activity", "tokens", "cost", "context-value", "model", "thinking-level", "connection-note",
	"app-message", "app-message-badge", "app-message-title", "app-message-text", "workspace", "turn-detail",
	"cache", "turn-list", "selected-kicker", "selected-title", "selected-prompt", "selected-facts", "selected-signals", "agent-reported", "evidence",
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
let nextRetryMs;

restorePreferences();
for (const option of optionElements) option.addEventListener("change", () => { savePreferences(); render(); });

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
		nextRetryMs = undefined;
		setConnection("live");
	});
	socket.addEventListener("message", ({ data }) => {
		try { handle(JSON.parse(data)); } catch { /* Malformed local messages do not replace known-good state. */ }
	});
	socket.addEventListener("close", () => {
		if (state.connection === "ended") return render();
		reconnectAttempts += 1;
		const delay = Math.min(1200 * 2 ** (reconnectAttempts - 1), 15_000);
		nextRetryMs = delay;
		setConnection("reconnecting");
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
	elements.connectionNote.textContent = connectionNote();
	const message = state.connection === "missing-token"
		? { title: "Session link required", text: "Open the session-specific URL shown by Pi. The access token stays in that local URL and is never displayed here." }
		: state.connection === "sample-error"
			? { title: "Sample data unavailable", text: "The bundled sample fixture could not be loaded or parsed. Refresh to try again, or open a live Pi session." }
			: undefined;
	elements.appMessage.hidden = !message;
	elements.workspace.hidden = Boolean(message);
	if (message) {
		elements.appMessageBadge.textContent = labels[state.connection];
		elements.appMessageBadge.className = `status status--${state.connection}`;
		elements.appMessageTitle.textContent = message.title;
		elements.appMessageText.textContent = message.text;
	}
}

function renderSessionFacts() {
	const metrics = state.session.metrics ?? { modelRequests: 0, usage: {}, tools: 0 };
	elements.activity.textContent = `${formatNumber(metrics.modelRequests)} request${metrics.modelRequests === 1 ? "" : "s"} · ${formatNumber(metrics.tools)} tool${metrics.tools === 1 ? "" : "s"}`;
	const usage = metrics.usage ?? {};
	elements.tokens.textContent = usage.inputTokens === undefined && usage.outputTokens === undefined ? "Unavailable" : `${usage.inputTokens === undefined ? "—" : formatNumber(usage.inputTokens)} in / ${usage.outputTokens === undefined ? "—" : formatNumber(usage.outputTokens)} out`;
	elements.cache.textContent = formatCache(usage).replace(/^cache /, "") || "Unavailable";
	elements.cost.textContent = usage.cost === undefined ? "Unavailable" : `$${usage.cost.toFixed(4)}`;
	const latestContext = metrics.latestContext ?? state.session.contextPoints.at(-1)?.snapshot;
	elements.contextValue.textContent = latestContext ? `${formatNumber(latestContext.inputTokens)}${latestContext.contextWindow ? ` / ${formatNumber(latestContext.contextWindow)}` : ""} tokens` : "Unavailable";
	elements.model.textContent = state.session.model ? formatModel(state.session.model) : "Unavailable";
	elements.thinkingLevel.textContent = state.session.thinkingLevel ? titleCase(state.session.thinkingLevel) : "Unavailable";
}

function connectionNote() {
	if (state.connection === "sample") return "Recorded sample data — this view is not connected to a live Pi session.";
	if (state.connection === "connecting") return "Opening a read-only view of this local Pi session.";
	if (state.connection === "reconnecting") return `Connection lost. Retrying${nextRetryMs ? ` in about ${formatDuration(nextRetryMs)}` : ""}; information already shown remains available.`;
	if (state.connection === "ended") return `Pi has stopped; no further activity will arrive.${state.session.partialHistory ? " Earlier activity may still be represented by summary facts only." : ""}`;
	if (state.connection === "missing-token") return "The viewer cannot connect without its session-specific local link.";
	if (state.connection === "sample-error") return "The recorded sample could not be loaded.";
	if (state.gaps.length > 0) return `Live, with ${state.gaps.length} event gap${state.gaps.length === 1 ? "" : "s"} observed. Some activity may be missing.`;
	const pending = Object.keys(state.pending).length;
	if (pending > 0) return `Live. Waiting for ${pending} out-of-order event${pending === 1 ? "" : "s"} before the sequence is complete.`;
	if (state.session.partialHistory) return "Live. You joined after activity began; earlier turns show summary facts and any tool evidence, not a full replay.";
	if (state.duplicates > 0) return `Live. Complete since connected; ${state.duplicates} duplicate event${state.duplicates === 1 ? " was" : "s were"} ignored.`;
	return "Live. Showing complete events since this viewer connected.";
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
	const markers = timelineMarkers(state.session.markers ?? [], state.turnOrder.map((id) => state.turns[id].startedAt));
	let nextMarker = 0;
	state.turnOrder.forEach((turnId, index) => {
		const turn = state.turns[turnId];
		const turnNumber = index + 1;
		while (nextMarker < markers.length && markers[nextMarker].at < turn.startedAt) elements.turnList.append(markerRow(markers[nextMarker++]));
		const card = document.createElement("button");
		card.className = `turn-card${state.selectedTurnId === turnId ? " selected" : ""}`;
		card.type = "button";
		card.setAttribute("aria-label", turnCardLabel(turn, turnNumber));
		if (state.selectedTurnId === turnId) card.setAttribute("aria-current", "true");
		card.addEventListener("click", () => chooseTurn(turnId));

		const heading = document.createElement("span");
		heading.className = "turn-card-heading";
		const identity = document.createElement("span");
		identity.className = "turn-card-identity";
		const number = document.createElement("span");
		number.className = "turn-number";
		number.textContent = String(turnNumber);
		const prompt = document.createElement("span");
		prompt.className = "turn-prompt";
		prompt.textContent = excerptText(turn.prompt || "Prompt unavailable", 46);
		prompt.title = turn.prompt || "Prompt unavailable";
		identity.append(number, prompt);
		heading.append(identity, factBadge(statusLabel(turn.status), turn.status === "active" ? "active" : turn.status === "interrupted" ? "error" : "neutral"));

		const facts = document.createElement("span");
		facts.className = "turn-card-facts";
		const duration = formatDuration(turn.durationMs ?? Math.max(0, Date.now() - turn.startedAt));
		const toolCount = turn.toolCount ?? Object.keys(turn.tools ?? {}).length;
		facts.append(cardFact("Time", duration), cardFact("First text", formatInvocationLatency(turn, "firstTextMs")), cardFact("Tools", formatNumber(toolCount)));
		const errors = cardFact("Errors", turn.errorCount > 0 ? `⚠ ${formatNumber(turn.errorCount)}` : "None");
		if (turn.errorCount > 0) errors.classList.add("turn-error-count");
		facts.append(errors);

		card.append(heading, renderRibbon(turn, turnNumber), facts);
		elements.turnList.append(card);
	});
	while (nextMarker < markers.length) elements.turnList.append(markerRow(markers[nextMarker++]));
}

function markerRow(marker) {
	const row = document.createElement("div");
	row.className = `session-marker session-marker--${marker.type}`;
	const label = marker.type === "model" ? "Model" : marker.type === "thinking" ? "Thinking" : marker.type === "compaction" ? "Context compacted" : "Session change";
	const change = marker.to !== undefined ? `${marker.from} → ${marker.to}` : marker.detail;
	row.textContent = change ? `${label}: ${change}` : label;
	row.title = marker.count > 1 ? `${marker.count} changes in a row; showing first and last.` : `Session marker at ${new Date(marker.at).toLocaleTimeString()}`;
	return row;
}

function renderRibbon(turn, turnNumber) {
	const ribbon = document.createElement("div");
	ribbon.className = "turn-ribbon";
	ribbon.setAttribute("aria-label", `Turn ${turnNumber} event visualization`);
	for (const segment of buildRibbonSegments(turn)) {
		const item = document.createElement("span");
		item.className = `ribbon-segment ribbon-segment--${segment.type}`;
		item.style.left = `${segment.left}%`;
		item.style.width = `${segment.width}%`;
		item.title = segment.type === "error" ? "Tool error" : segment.type === "tool" ? "Tool activity" : segment.type === "reasoning" ? "Reasoning before first text" : segment.type === "response" ? "Assistant response" : "Other turn time";
		item.setAttribute("aria-hidden", "true");
		ribbon.append(item);
	}
	return ribbon;
}

function chooseTurn(turnId) {
	state = selectTurn(state, turnId);
	render();
	if (matchMedia("(max-width: 980px)").matches) {
		const behavior = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
		requestAnimationFrame(() => elements.turnDetail.scrollIntoView({ behavior, block: "start" }));
	}
}

function renderSelectedTurn() {
	const turn = selectedTurn(state);
	if (!turn) {
		elements.selectedKicker.textContent = "Selected turn";
		elements.selectedTitle.textContent = "Choose a turn";
		elements.selectedPrompt.textContent = "Select a turn from the session overview to inspect its evidence.";
		elements.selectedFacts.replaceChildren();
		elements.selectedSignals.replaceChildren();
		elements.agentReported.hidden = true;
		evidenceRenderer.render(state, undefined);
		return;
	}
	const index = state.turnOrder.indexOf(turn.id) + 1;
	elements.selectedKicker.textContent = `Turn ${index}`;
	elements.selectedTitle.textContent = turn.prompt || "Prompt unavailable";
	elements.selectedPrompt.textContent = "Observed session activity and agent-reported output are labeled separately.";
	elements.selectedFacts.replaceChildren(
		fact("Status", statusLabel(turn.status)),
		fact("Wall time", formatDuration(turn.durationMs ?? Math.max(0, Date.now() - turn.startedAt))),
		fact("First output", formatInvocationLatency(turn, "firstOutputMs")),
		fact("First text", formatInvocationLatency(turn, "firstTextMs")),
		fact("Tools · Errors", `${formatNumber(turn.toolCount ?? Object.keys(turn.tools ?? {}).length)} · ${formatNumber(turn.errorCount ?? 0)}`),
		fact("Turn usage", formatTurnUsage(turn)),
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
	const missing = value === "—";
	content.textContent = missing ? "Not observed" : value;
	if (missing) content.title = "Not observed: the event that marks this was not seen by this viewer.";
	else if (value.length > 14) content.title = value;
	wrapper.append(name, content);
	return wrapper;
}

function factBadge(text, kind) {
	const badge = document.createElement("span");
	badge.className = `fact-badge fact-badge--${kind}`;
	badge.textContent = text;
	return badge;
}

function cardFact(label, value) {
	const wrapper = document.createElement("span");
	const name = document.createElement("span");
	name.textContent = label;
	const content = document.createElement("strong");
	const missing = value === "—";
	content.textContent = value;
	if (missing) content.title = "Not observed: the event that marks this was not seen by this viewer.";
	else if (value.length > 14) content.title = value;
	wrapper.append(name, content);
	return wrapper;
}

function turnCardLabel(turn, turnNumber) {
	const duration = formatDuration(turn.durationMs ?? Math.max(0, Date.now() - turn.startedAt));
	const tools = turn.toolCount ?? Object.keys(turn.tools ?? {}).length;
	const errors = turn.errorCount ?? 0;
	return `Turn ${turnNumber}: ${turn.prompt || "Prompt unavailable"}. ${statusLabel(turn.status)}. ${duration}. First text ${formatInvocationLatency(turn, "firstTextMs")}. ${tools} tool${tools === 1 ? "" : "s"}. ${errors} error${errors === 1 ? "" : "s"}.`;
}

function restorePreferences() {
	let saved = {};
	try { saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}"); } catch { /* Use defaults. */ }
	for (const option of optionElements) if (typeof saved[option.id] === "boolean") option.checked = saved[option.id];
}

function savePreferences() {
	const prefs = {};
	for (const option of optionElements) prefs[option.id] = option.checked;
	try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* Private browsing may reject writes. */ }
}

function formatModel(model) {
	return model.name && model.name !== model.id ? `${model.name} (${model.provider}/${model.id})` : `${model.provider}/${model.id}`;
}

function formatCache(usage) {
	if (usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined) return "";
	return `cache ${usage.cacheReadTokens === undefined ? "—" : formatNumber(usage.cacheReadTokens)} read / ${usage.cacheWriteTokens === undefined ? "—" : formatNumber(usage.cacheWriteTokens)} write`;
}

function formatTurnUsage(turn) {
	const usage = turn.usage ?? {};
	if (usage.inputTokens === undefined && usage.outputTokens === undefined && usage.cost === undefined) return "Unavailable";
	const tokens = `${usage.inputTokens === undefined ? "—" : formatNumber(usage.inputTokens)} in / ${usage.outputTokens === undefined ? "—" : formatNumber(usage.outputTokens)} out`;
	const cache = formatCache(usage);
	const withCache = cache ? `${tokens} · ${cache}` : tokens;
	return usage.cost === undefined ? withCache : `${withCache} · $${usage.cost.toFixed(4)}`;
}

function statusLabel(status) { return status === "active" ? "In progress" : status === "interrupted" ? "Interrupted" : "Completed"; }
function formatInvocationLatency(turn, field) {
	const value = turnLatency(turn, field);
	return Number.isFinite(value) ? formatDuration(value) : "—";
}
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

// The header grows with its content (totals row, options panel), so sticky offsets track its real height.
const appHeader = document.querySelector(".app-header");
new ResizeObserver(() => document.documentElement.style.setProperty("--header-h", `${appHeader.offsetHeight}px`)).observe(appHeader);
