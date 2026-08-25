const elements = {
	status: document.querySelector("#status"),
	elapsed: document.querySelector("#elapsed"),
	requests: document.querySelector("#requests"),
	input: document.querySelector("#input"),
	output: document.querySelector("#output"),
	tools: document.querySelector("#tools"),
	contextSnapshot: document.querySelector("#context-snapshot"),
	contextValue: document.querySelector("#context-value"),
	events: document.querySelector("#events"),
	empty: document.querySelector("#empty"),
	options: document.querySelector(".options"),
	showUsage: document.querySelector("#show-usage"),
	showToolInput: document.querySelector("#show-tool-input"),
	showToolResults: document.querySelector("#show-tool-results"),
	showTimestamps: document.querySelector("#show-timestamps"),
	showThinking: document.querySelector("#show-thinking"),
	showSystemPrompt: document.querySelector("#show-system-prompt"),
	expandThinking: document.querySelector("#expand-thinking"),
	expandTools: document.querySelector("#expand-tools"),
};

const parameters = new URLSearchParams(location.search);
const token = parameters.get("token");
const debug = parameters.get("debug") === "1";
const timeFormatter = new Intl.DateTimeFormat([], {
	hour: "numeric",
	minute: "2-digit",
	second: "2-digit",
});
const messages = new Map();
const thinkingRows = new Map();
const toolRows = new Map();
const turnUsageRows = new Map();
const runUsageRows = new Map();
const runGroups = new Map();
const systemPrompts = new Map();
const renderedSystemPrompts = new Set();
let startedAt = Date.now();
let retryTimer;
let lastAgentGroup;

for (const option of [
	elements.showUsage,
	elements.showToolInput,
	elements.showToolResults,
	elements.showTimestamps,
	elements.showThinking,
	elements.showSystemPrompt,
]) {
	option.addEventListener("change", applyContentOptions);
}
elements.expandThinking.addEventListener("change", () => {
	setDetailsOpen(".thinking-block", elements.expandThinking.checked);
});
elements.expandTools.addEventListener("change", () => {
	setDetailsOpen(".tool-block", elements.expandTools.checked);
});

function setDetailsOpen(selector, open) {
	for (const details of document.querySelectorAll(selector)) details.open = open;
}

function applyContentOptions() {
	document.body.classList.toggle("show-usage", elements.showUsage.checked);
	document.body.classList.toggle("show-tool-input", elements.showToolInput.checked);
	document.body.classList.toggle("show-tool-results", elements.showToolResults.checked);
	document.body.classList.toggle("show-timestamps", elements.showTimestamps.checked);
	document.body.classList.toggle("show-thinking", elements.showThinking.checked);
	document.body.classList.toggle("show-system-prompt", elements.showSystemPrompt.checked);
}

applyContentOptions();
const optionsObserver = new ResizeObserver(() => {
	const height = Math.ceil(elements.options.getBoundingClientRect().height);
	document.documentElement.style.setProperty("--options-height", `${height}px`);
});
optionsObserver.observe(elements.options);

function connect() {
	if (!token) return setStatus("Missing token", false);
	const socket = new WebSocket(`ws://${location.host}/events?token=${encodeURIComponent(token)}`);
	setStatus("Connecting", false);
	socket.addEventListener("open", () => setStatus("Live", true));
	socket.addEventListener("message", ({ data }) => {
		try {
			handle(JSON.parse(data));
		} catch {
			// Ignore malformed local messages.
		}
	});
	socket.addEventListener("close", () => {
		setStatus("Reconnecting", false);
		clearTimeout(retryTimer);
		retryTimer = setTimeout(connect, 1200);
	});
}

async function playDebugFixture() {
	if (!token) return setStatus("Missing token", false);
	setStatus("Sample data", false);
	elements.status.classList.add("sample");
	try {
		const response = await fetch(`/debug-fixture?token=${encodeURIComponent(token)}`);
		if (!response.ok) throw new Error("fixture unavailable");
		const fixture = await response.json();
		if (!fixture?.hello || !Array.isArray(fixture.events)) throw new Error("invalid fixture");
		const fixtureStartedAt = Number.isFinite(fixture.hello.startedAt) ? fixture.hello.startedAt : 0;
		const playbackStartedAt = Date.now();
		handle({ ...fixture.hello, startedAt: playbackStartedAt });
		for (const item of fixture.events) {
			const delay = Number.isFinite(item.afterMs) ? Math.max(0, item.afterMs) : 0;
			if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
			const at = Number.isFinite(item.event?.at)
				? playbackStartedAt + Math.max(0, item.event.at - fixtureStartedAt)
				: Date.now();
			handle({ ...item.event, at });
		}
	} catch {
		setStatus("Sample unavailable", false);
		elements.status.classList.remove("sample");
	}
}

function handle(event) {
	if (event.v !== 2) return;

	switch (event.type) {
		case "hello":
			handleHello(event);
			break;
		case "metrics":
			handleMetrics(event);
			break;
		case "run.systemPrompt":
			handleSystemPrompt(event);
			break;
		case "message.started":
			handleMessageStarted(event);
			break;
		case "message.delta":
			handleMessageDelta(event);
			break;
		case "message.thinking.delta":
			handleThinkingDelta(event);
			break;
		case "message.completed":
			handleMessageCompleted(event);
			break;
		case "turn.usage":
			handleTurnUsage(event);
			break;
		case "run.completed":
			handleRunCompleted(event);
			break;
		case "tool.started":
			handleToolStarted(event);
			break;
		case "tool.completed":
			handleToolCompleted(event);
			break;
	}
}

function handleHello(event) {
	startedAt = event.startedAt;
	updateMetrics(event.metrics);
}

function handleMetrics(event) {
	updateMetrics(event.data);
}

function handleMessageStarted(event) {
	const content = createMessage(event.data.id, "assistant", "", event.at);
	const group = content.closest(".message-group");
	runGroups.set(event.data.runId, group);
	renderSystemPrompt(event.data.runId, group);
}

function handleSystemPrompt(event) {
	systemPrompts.set(event.data.runId, { text: event.data.text, at: event.at });
	const group = runGroups.get(event.data.runId);
	if (group) renderSystemPrompt(event.data.runId, group);
}

function renderSystemPrompt(runId, group) {
	const prompt = systemPrompts.get(runId);
	if (!prompt || renderedSystemPrompts.has(runId)) return;
	const details = document.createElement("details");
	details.className = "message-block system-prompt-block";
	const summary = document.createElement("summary");
	summary.append("System prompt", createTimestamp(prompt.at));
	const content = document.createElement("div");
	content.className = "system-prompt-content";
	content.textContent = prompt.text;
	details.append(summary, content);
	group.prepend(details);
	renderedSystemPrompts.add(runId);
	systemPrompts.delete(runId);
}

function handleMessageDelta(event) {
	const content = messages.get(event.data.id) ?? createMessage(event.data.id, "assistant", "", event.at);
	content.textContent += event.data.text;
	content.classList.add("cursor");
	scrollToLatest();
}

function handleThinkingDelta(event) {
	const row = ensureThinkingRow(event.data.id);
	if (!row) return;
	row.body.textContent += event.data.text;
	row.body.classList.add("cursor");
	scrollToLatest();
}

function handleMessageCompleted(event) {
	const content =
		messages.get(event.data.id) ?? createMessage(event.data.id, event.data.role, event.data.text, event.at);
	setMessageContent(content, event.data.text, event.data.role);
	content.classList.remove("cursor");
	finalizeThinking(event.data.id, event.data.thinking);
	if (shouldRemoveEmptyAssistant(event.data)) content.closest(".message-block")?.remove();
	scrollToLatest();
}

function shouldRemoveEmptyAssistant({ role, text, thinking }) {
	return role === "assistant" && !text && !thinking;
}

function finalizeThinking(messageId, thinking) {
	if (!thinking) return;
	const row = ensureThinkingRow(messageId);
	if (!row) return;
	row.body.innerHTML = renderMarkdown(thinking);
	row.body.classList.remove("cursor");
}

function handleTurnUsage(event) {
	const message = event.data.messageId ? messages.get(event.data.messageId) : undefined;
	const group = message?.closest(".message-group") ?? lastAgentGroup ?? createSpeakerGroup("assistant");
	let content = turnUsageRows.get(event.data.id);
	if (!content) {
		content = createBlock(group, "Turn usage", "", "usage-block", event.at);
		turnUsageRows.set(event.data.id, content);
	}
	content.textContent = formatUsage(event.data.usage);
	if (event.data.contextSnapshot) updateContextSnapshot(event.data.contextSnapshot);
	scrollToLatest();
}

function handleRunCompleted(event) {
	const group = lastAgentGroup ?? createSpeakerGroup("assistant");
	let content = runUsageRows.get(event.data.id);
	if (!content) {
		content = createBlock(group, "Agent run usage", "", "usage-block", event.at);
		runUsageRows.set(event.data.id, content);
	}
	const requestLabel = event.data.modelRequests === 1 ? "1 model request" : `${event.data.modelRequests} model requests`;
	content.textContent = `${requestLabel} · ${formatUsage(event.data.usage)}`;
	scrollToLatest();
}

function handleToolStarted(event) {
	const group = lastAgentGroup ?? createSpeakerGroup("assistant");
	const row = createToolRow(group, event.data.name, event.at);
	row.row.classList.add("running");
	row.status.textContent = "running";
	if (event.data.args !== undefined) {
		addToolSection(row.body, "Args", truncateText(toolValueText(event.data.args)), "tool-input");
	}
	toolRows.set(event.data.id, row);
	scrollToLatest();
}

function handleToolCompleted(event) {
	let row = toolRows.get(event.data.id);
	if (!row) {
		const group = lastAgentGroup ?? createSpeakerGroup("assistant");
		row = createToolRow(group, event.data.name, event.at);
	}
	row.row.classList.remove("running");
	row.status.textContent = `${event.data.isError ? "failed" : "done"} · ${formatDuration(event.data.durationMs)}`;
	if (event.data.isError) row.row.classList.add("error");
	if (event.data.result !== undefined) {
		addToolSection(
			row.body,
			"Result",
			truncateText(toolValueText(event.data.result)),
			"tool-result",
			event.data.isError,
		);
	}
	toolRows.set(event.data.id, row);
	scrollToLatest();
}

/** Builds a collapsible tool row: <details> with summary (name + status) and a detail body. */
function createToolRow(group, name, at) {
	const row = document.createElement("details");
	row.className = "message-block tool-block";
	row.open = elements.expandTools.checked;
	const summary = document.createElement("summary");
	summary.className = "tool-summary";
	const title = document.createElement("span");
	title.className = "tool-name";
	title.textContent = `Tool · ${name}`;
	const status = document.createElement("span");
	status.className = "tool-status";
	summary.append(title, status, createTimestamp(at));
	const body = document.createElement("div");
	body.className = "tool-details";
	row.append(summary, body);
	group.append(row);
	return { row, status, body };
}

function addToolSection(body, label, text, className, isError = false) {
	const section = document.createElement("div");
	section.className = `tool-section ${className}`;
	const heading = document.createElement("h4");
	heading.textContent = label;
	const pre = document.createElement("pre");
	pre.textContent = text;
	if (isError) pre.classList.add("error");
	section.append(heading, pre);
	body.append(section);
}

const TOOL_TEXT_LIMIT = 2000;

function toolValueText(value) {
	if (typeof value === "object" && value !== null) {
		try {
			return JSON.stringify(value, null, 2);
		} catch {
			return String(value);
		}
	}
	return String(value);
}

function truncateText(text, limit = TOOL_TEXT_LIMIT) {
	if (text.length <= limit) return text;
	return `${text.slice(0, limit)}\n… omitted ${text.length - limit} chars`;
}

/** Gets or creates the collapsible Thinking row inside the message block, above the answer text. */
function ensureThinkingRow(messageId) {
	const content = messages.get(messageId);
	const block = content?.closest(".message-block");
	if (!block) return undefined;
	let row = thinkingRows.get(messageId);
	if (!row) {
		const details = document.createElement("details");
		details.className = "thinking-block";
		details.open = elements.expandThinking.checked;
		const summary = document.createElement("summary");
		summary.textContent = "Thinking";
		const body = document.createElement("div");
		body.className = "thinking-content";
		details.append(summary, body);
		block.insertBefore(details, content);
		row = { details, body };
		thinkingRows.set(messageId, row);
	}
	return row;
}

function createMessage(id, role, text, at) {
	const group = createSpeakerGroup(role);
	const content = createBlock(group, role === "assistant" ? "Text" : "", text, "", at);
	messages.set(id, content);
	return content;
}

function createSpeakerGroup(role) {
	elements.empty?.remove();
	const row = document.createElement("article");
	row.className = `event ${role}`;
	const label = document.createElement("div");
	label.className = "label";
	label.append(createRoleIcon(role), role === "user" ? "User" : "Agent");
	const group = document.createElement("div");
	group.className = "message-group";
	row.append(label, group);
	elements.events.append(row);
	lastAgentGroup = role === "assistant" ? group : undefined;
	return group;
}

function createRoleIcon(role) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.classList.add("role-icon");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");

	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute(
		"d",
		role === "user"
			? "M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5.5 6c.4-2.7 2.2-4 5.5-4s5.1 1.3 5.5 4"
			: "M8 1.5c.6 3.8 2.7 5.9 6.5 6.5-3.8.6-5.9 2.7-6.5 6.5C7.4 10.7 5.3 8.6 1.5 8 5.3 7.4 7.4 5.3 8 1.5Z",
	);
	svg.append(path);
	return svg;
}

function createBlock(group, type, text, className = "", at) {
	const block = document.createElement("div");
	block.className = `message-block ${className}`.trim();
	if (type) {
		const typeLabel = document.createElement("div");
		typeLabel.className = "message-type";
		typeLabel.textContent = type;
		block.append(typeLabel);
	}
	block.append(createTimestamp(at));
	const content = document.createElement("div");
	content.className = "content";
	content.textContent = text;
	block.append(content);
	group.append(block);
	return content;
}

function createTimestamp(at) {
	const time = document.createElement("time");
	time.className = "timestamp";
	time.dateTime = new Date(at).toISOString();
	time.textContent = timeFormatter.format(at);
	return time;
}

/**
 * Minimal markdown-to-HTML renderer. Escapes HTML first, then converts
 * common markdown patterns. Works without external dependencies.
 */
function renderMarkdown(text) {
	if (!text) return "";

	// Escape HTML entities to prevent XSS and treat raw HTML as text
	let html = text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");

	// Code blocks (``` ... ```) — must be before inline code
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => `<pre><code>${code}</code></pre>`);

	// Inline code (`code`)
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

	// Bold (**text** or __text__)
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	html = html.replace(/__([^_]+)__/g, "<strong>$1</strong>");

	// Italic (*text* or _text_)
	html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");
	html = html.replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, "<em>$1</em>");

	// Headings
	html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
	html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
	html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");

	// Links ([text](url))
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

	// Unordered lists (- item or * item)
	html = html.replace(/^[	 ]*[-*] (.+)$/gm, "<li>$1</li>");
	// Wrap consecutive <li> items in <ul>
	html = html.replace(/(<li>[\s\S]*?<\/li>(\n)?)+/g, (match) => {
		const inner = match.replace(/\n/g, "");
		return `<ul>${inner}</ul>`;
	});

	// Paragraphs and line breaks
	html = html.replace(/\n\n/g, "</p><p>");
	html = html.replace(/\n/g, "<br>");

	return html ? `<p>${html}</p>` : "";
}

/**
 * Stores raw text and renders markdown for assistant messages.
 * Streaming deltas accumulate via textContent; final render on complete.
 */
function setMessageContent(element, text, role) {
	if (role === "assistant") {
		element.innerHTML = renderMarkdown(text);
	} else {
		element.textContent = text;
	}
}

function updateMetrics(metrics) {
	elements.requests.textContent = formatNumber(metrics.modelRequests);
	updateOptionalMetric("input", metrics.modelRequests === 0 ? 0 : metrics.usage.inputTokens, formatNumber);
	updateOptionalMetric("output", metrics.modelRequests === 0 ? 0 : metrics.usage.outputTokens, formatNumber);
	updateOptionalMetric("reasoning", metrics.usage.reasoningTokens, formatNumber);
	updateOptionalMetric("cache-read", metrics.usage.cacheReadTokens, formatNumber);
	updateOptionalMetric("cache-write", metrics.usage.cacheWriteTokens, formatNumber);
	updateOptionalMetric("cost", metrics.usage.cost, formatCost);
	elements.tools.textContent = String(metrics.tools);
	if (metrics.latestContext) updateContextSnapshot(metrics.latestContext);
	else elements.contextSnapshot.hidden = true;
}

function updateOptionalMetric(name, value, format) {
	const wrapper = document.querySelector(`[data-metric="${name}"]`);
	const target = document.querySelector(`#${name}`);
	wrapper.hidden = value === undefined;
	if (value !== undefined) target.textContent = format(value);
}

function updateContextSnapshot(snapshot) {
	elements.contextSnapshot.hidden = false;
	elements.contextValue.textContent = snapshot.contextWindow
		? `Input ${formatNumber(snapshot.inputTokens)} of ${formatNumber(snapshot.contextWindow)} token context window`
		: `Input ${formatNumber(snapshot.inputTokens)} · context window unavailable`;
}

function formatUsage(usage) {
	const parts = [];
	if (usage.inputTokens !== undefined) parts.push(`Input ${formatNumber(usage.inputTokens)}`);
	if (usage.outputTokens !== undefined) parts.push(`Output ${formatNumber(usage.outputTokens)}`);
	if (usage.reasoningTokens !== undefined) parts.push(`Reasoning ${formatNumber(usage.reasoningTokens)}`);
	if (usage.cacheReadTokens !== undefined) parts.push(`Cache read ${formatNumber(usage.cacheReadTokens)}`);
	if (usage.cacheWriteTokens !== undefined) parts.push(`Cache write ${formatNumber(usage.cacheWriteTokens)}`);
	if (usage.cost !== undefined) parts.push(`Cost ${formatCost(usage.cost)}`);
	return parts.length > 0 ? parts.join(" · ") : "Usage unavailable";
}

function formatNumber(value) {
	return new Intl.NumberFormat().format(value);
}

function formatCost(value) {
	return `$${value.toFixed(4)}`;
}

function setStatus(text, live) {
	elements.status.textContent = text;
	elements.status.classList.toggle("live", live);
}

function formatDuration(milliseconds) {
	return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}

function scrollToLatest() {
	window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
}

setInterval(() => {
	const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
	const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
	elements.elapsed.textContent = `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}, 1000);

if (debug) void playDebugFixture();
else connect();
