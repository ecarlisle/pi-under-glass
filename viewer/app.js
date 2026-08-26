const elements = {
	status: document.querySelector("#status"),
	elapsed: document.querySelector("#elapsed"),
	activity: document.querySelector("#activity"),
	tokens: document.querySelector("#tokens"),
	cache: document.querySelector("#cache"),
	contextSnapshot: document.querySelector("#context-snapshot"),
	contextValue: document.querySelector("#context-value"),
	contextTrack: document.querySelector("#context-track"),
	contextFill: document.querySelector("#context-fill"),
	events: document.querySelector("#events"),
	empty: document.querySelector("#empty"),
	options: document.querySelector(".options"),
	optionsDetails: document.querySelector("#options-details"),
	jumpToLatest: document.querySelector("#jump-to-latest"),
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
let stickToBottom = true;

const PREFS_KEY = "pi-under-glass:options";
const contentOptions = [
	elements.showUsage,
	elements.showToolInput,
	elements.showToolResults,
	elements.showTimestamps,
	elements.showThinking,
	elements.showSystemPrompt,
];
const expandOptions = [elements.expandThinking, elements.expandTools];

restoreOptionPrefs();

for (const option of contentOptions) {
	option.addEventListener("change", () => {
		applyContentOptions();
		saveOptionPrefs();
	});
}
elements.expandThinking.addEventListener("change", () => {
	setDetailsOpen(".thinking-block", elements.expandThinking.checked);
	saveOptionPrefs();
});
elements.expandTools.addEventListener("change", () => {
	setDetailsOpen(".tool-block", elements.expandTools.checked);
	saveOptionPrefs();
});
elements.optionsDetails.addEventListener("toggle", saveOptionPrefs);

function restoreOptionPrefs() {
	let saved;
	try {
		saved = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}");
	} catch {
		saved = {};
	}
	for (const option of [...contentOptions, ...expandOptions]) {
		if (typeof saved[option.id] === "boolean") option.checked = saved[option.id];
	}
	if (typeof saved.optionsOpen === "boolean") elements.optionsDetails.open = saved.optionsOpen;
}

function saveOptionPrefs() {
	const prefs = { optionsOpen: elements.optionsDetails.open };
	for (const option of [...contentOptions, ...expandOptions]) prefs[option.id] = option.checked;
	try {
		localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
	} catch {
		// Ignore storage failures (e.g. private browsing quota).
	}
}

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

const SCROLL_BOTTOM_THRESHOLD = 80;
window.addEventListener("scroll", updateStickToBottom, { passive: true });
elements.jumpToLatest.addEventListener("click", () => {
	stickToBottom = true;
	scrollToLatest();
});

function updateStickToBottom() {
	const distanceFromBottom = document.documentElement.scrollHeight - (window.scrollY + window.innerHeight);
	stickToBottom = distanceFromBottom <= SCROLL_BOTTOM_THRESHOLD;
	if (stickToBottom) elements.jumpToLatest.hidden = true;
}

const RECONNECT_BASE_MS = 1200;
const RECONNECT_MAX_MS = 15000;
let reconnectAttempts = 0;

function connect() {
	if (!token) return setStatus("Missing token", false);
	const socket = new WebSocket(`ws://${location.host}/events?token=${encodeURIComponent(token)}`);
	setStatus(reconnectAttempts > 0 ? `Reconnecting (attempt ${reconnectAttempts})` : "Connecting", false);
	socket.addEventListener("open", () => {
		reconnectAttempts = 0;
		setStatus("Live", true);
	});
	socket.addEventListener("message", ({ data }) => {
		try {
			handle(JSON.parse(data));
		} catch {
			// Ignore malformed local messages.
		}
	});
	socket.addEventListener("close", () => {
		reconnectAttempts += 1;
		const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_MS);
		setStatus(`Reconnecting in ${Math.round(delay / 1000)}s (attempt ${reconnectAttempts})`, false);
		clearTimeout(retryTimer);
		retryTimer = setTimeout(connect, delay);
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
	summary.append(createTypeIcon("system-prompt"), "System prompt", createTimestamp(prompt.at));
	const copyRow = document.createElement("div");
	copyRow.className = "copy-row";
	copyRow.append(createCopyButton(() => prompt.text));
	const content = document.createElement("div");
	content.className = "system-prompt-content";
	content.textContent = prompt.text;
	details.append(summary, copyRow, content);
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
	row.rawText += event.data.text;
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
	row.rawText = thinking;
	row.body.innerHTML = renderMarkdown(thinking);
	row.body.classList.remove("cursor");
}

function handleTurnUsage(event) {
	const message = event.data.messageId ? messages.get(event.data.messageId) : undefined;
	const group = message?.closest(".message-group") ?? lastAgentGroup ?? createSpeakerGroup("assistant");
	let content = turnUsageRows.get(event.data.id);
	if (!content) {
		content = createBlock(group, "Turn usage", "", "usage-block", event.at, "usage");
		turnUsageRows.set(event.data.id, content);
	}
	content.replaceChildren(buildUsageFragment(event.data.usage));
	if (event.data.contextSnapshot) updateContextSnapshot(event.data.contextSnapshot);
	scrollToLatest();
}

function handleRunCompleted(event) {
	// A single-turn run's total is numerically identical to the one Turn usage line already
	// shown above it (usage.ts sums whole-run totals from completed turns), so skip the
	// duplicate row entirely rather than repeating the same numbers with a "1 request" prefix.
	if (event.data.modelRequests === 1) return;
	const group = lastAgentGroup ?? createSpeakerGroup("assistant");
	let content = runUsageRows.get(event.data.id);
	if (!content) {
		content = createBlock(group, "Agent run usage", "", "usage-block", event.at, "usage");
		runUsageRows.set(event.data.id, content);
	}
	content.replaceChildren(`${formatNumber(event.data.modelRequests)} requests · `, buildUsageFragment(event.data.usage));
	scrollToLatest();
}

function handleToolStarted(event) {
	const group = lastAgentGroup ?? createSpeakerGroup("assistant");
	const row = createToolRow(group, event.data.name, event.at);
	row.row.classList.add("running");
	row.status.textContent = "running";
	if (event.data.args !== undefined) {
		addToolSection(row.body, "Args", toolValueText(event.data.args), "tool-input");
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
		addToolSection(row.body, "Result", toolValueText(event.data.result), "tool-result", event.data.isError);
	}
	toolRows.set(event.data.id, row);
	scrollToLatest();
}

// Bounds how many auto-expanded tool rows accumulate in a long session: once more than this
// many are open by default, the oldest ones auto-collapse. Rows the user has explicitly
// toggled are never touched — nothing is ever removed, just visually collapsed.
const AUTO_COLLAPSE_KEEP_OPEN = 25;
const autoManagedToolRows = [];

/** Builds a collapsible tool row: <details> with summary (name + status) and a detail body. */
function createToolRow(group, name, at) {
	const row = document.createElement("details");
	row.className = "message-block tool-block";
	row.open = elements.expandTools.checked;
	const summary = document.createElement("summary");
	summary.className = "tool-summary";
	const title = document.createElement("span");
	title.className = "tool-name";
	title.append(createTypeIcon("tool"), `Tool · ${name}`);
	const status = document.createElement("span");
	status.className = "tool-status";
	summary.append(title, status, createTimestamp(at));
	const body = document.createElement("div");
	body.className = "tool-details";
	row.append(summary, body);
	group.append(row);
	summary.addEventListener("click", () => (row.dataset.pinned = "true"), { once: true });
	autoManagedToolRows.push(row);
	while (autoManagedToolRows.length > AUTO_COLLAPSE_KEEP_OPEN) {
		const oldest = autoManagedToolRows.shift();
		if (!oldest.dataset.pinned && !oldest.classList.contains("running")) oldest.open = false;
	}
	return { row, status, body };
}

function addToolSection(body, label, fullText, className, isError = false) {
	const section = document.createElement("div");
	section.className = `tool-section ${className}`;
	const header = document.createElement("div");
	header.className = "tool-section-header";
	const heading = document.createElement("h4");
	heading.textContent = label;
	header.append(heading, createCopyButton(() => fullText));
	const pre = document.createElement("pre");
	pre.textContent = truncateText(fullText);
	if (isError) pre.classList.add("error");
	section.append(header, pre);
	body.append(section);
}

/** A small button that copies the result of `getText()` to the clipboard, with transient feedback. */
function createCopyButton(getText) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "copy-button";
	button.textContent = "Copy";
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		navigator.clipboard
			.writeText(getText())
			.then(() => (button.textContent = "Copied"))
			.catch(() => (button.textContent = "Copy failed"));
		setTimeout(() => (button.textContent = "Copy"), 1500);
	});
	return button;
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
		summary.append(createTypeIcon("thinking"), "Thinking");
		const copyRow = document.createElement("div");
		copyRow.className = "copy-row";
		copyRow.append(createCopyButton(() => row.rawText));
		const body = document.createElement("div");
		body.className = "thinking-content";
		details.append(summary, copyRow, body);
		block.insertBefore(details, content);
		row = { details, body, rawText: "" };
		thinkingRows.set(messageId, row);
	}
	return row;
}

function createMessage(id, role, text, at) {
	const group = createSpeakerGroup(role);
	const content = createBlock(
		group,
		role === "assistant" ? "Text" : "",
		text,
		"",
		at,
		role === "assistant" ? "text" : undefined,
	);
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

const TYPE_ICON_PATHS = {
	text: {
		mode: "stroke",
		d: "M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-2.5 2.5v-2.5h-2a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1Z",
	},
	tool: {
		mode: "fill",
		d: "M9.8 4.2a.667.667 0 0 0 0 .933l1.067 1.067a.667.667 0 0 0 .933 0l2.513-2.513a4 4 0 0 1-5.293 5.293l-4.607 4.607a1.413 1.413 0 0 1-2-2l4.607-4.607a4 4 0 0 1 5.293-5.293l-2.507 2.507Z",
	},
	"system-prompt": {
		mode: "stroke",
		d: "M4 2.5h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM5.5 6h5M5.5 8.5h5M5.5 11h3",
	},
	usage: { mode: "fill", d: "M3 13V9h2v4H3Zm4 0V5h2v8H7Zm4 0V7h2v6h-2Z" },
};

/** Small inline SVG glyph distinguishing a content type (text/tool/thinking/system-prompt/usage). */
function createTypeIcon(kind) {
	const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("focusable", "false");
	if (kind === "thinking") {
		svg.classList.add("type-icon", "type-icon--fill");
		for (const cx of [3.5, 8, 12.5]) {
			const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
			circle.setAttribute("cx", String(cx));
			circle.setAttribute("cy", "8");
			circle.setAttribute("r", "1.3");
			svg.append(circle);
		}
		return svg;
	}
	const def = TYPE_ICON_PATHS[kind];
	if (!def) return undefined;
	svg.classList.add("type-icon", `type-icon--${def.mode}`);
	const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
	path.setAttribute("d", def.d);
	svg.append(path);
	return svg;
}

function createBlock(group, type, text, className = "", at, iconKind) {
	const block = document.createElement("div");
	block.className = `message-block ${className}`.trim();
	if (type) {
		const typeLabel = document.createElement("div");
		typeLabel.className = "message-type";
		const icon = iconKind && createTypeIcon(iconKind);
		if (icon) typeLabel.append(icon);
		typeLabel.append(type);
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
	updateActivity(metrics.modelRequests, metrics.tools);
	updatePairedMetric(
		"tokens",
		metrics.modelRequests === 0 ? 0 : metrics.usage.inputTokens,
		metrics.modelRequests === 0 ? 0 : metrics.usage.outputTokens,
		(input, output) => `${input} in / ${output} out`,
	);
	updateOptionalMetric("cost", metrics.usage.cost, formatCost);
	updateOptionalMetric("reasoning", metrics.usage.reasoningTokens, formatNumber);
	updatePairedMetric(
		"cache",
		metrics.usage.cacheReadTokens,
		metrics.usage.cacheWriteTokens,
		(read, write) => `${read} / ${write}`,
	);
	if (metrics.latestContext) updateContextSnapshot(metrics.latestContext);
	else elements.contextSnapshot.hidden = true;
}

function updateActivity(modelRequests, tools) {
	const requestLabel = modelRequests === 1 ? "1 request" : `${formatNumber(modelRequests)} requests`;
	const toolLabel = tools > 0 ? ` · ${tools === 1 ? "1 tool" : `${formatNumber(tools)} tools`}` : "";
	elements.activity.textContent = `${requestLabel}${toolLabel}`;
}

function updateOptionalMetric(name, value, format) {
	const wrapper = document.querySelector(`[data-metric="${name}"]`);
	const target = document.querySelector(`#${name}`);
	wrapper.hidden = value === undefined;
	if (value !== undefined) target.textContent = format(value);
}

/** Renders two related counts (e.g. input/output tokens, cache read/write) as one compact field. */
function updatePairedMetric(name, first, second, format) {
	const wrapper = document.querySelector(`[data-metric="${name}"]`);
	wrapper.hidden = first === undefined && second === undefined;
	if (wrapper.hidden) return;
	elements[name].textContent = format(
		first === undefined ? "—" : formatNumber(first),
		second === undefined ? "—" : formatNumber(second),
	);
}

function updateContextSnapshot(snapshot) {
	elements.contextSnapshot.hidden = false;
	const hasWindow = Boolean(snapshot.contextWindow);
	elements.contextTrack.hidden = !hasWindow;
	if (hasWindow) {
		const ratio = Math.min(1, snapshot.inputTokens / snapshot.contextWindow);
		elements.contextFill.style.width = `${(ratio * 100).toFixed(1)}%`;
		elements.contextFill.classList.toggle("warn", ratio >= 0.75 && ratio < 0.9);
		elements.contextFill.classList.toggle("danger", ratio >= 0.9);
		elements.contextValue.textContent = `${formatNumber(snapshot.inputTokens)} / ${formatNumber(snapshot.contextWindow)} tokens`;
	} else {
		elements.contextValue.textContent = `${formatNumber(snapshot.inputTokens)} tokens · window unavailable`;
	}
}

/**
 * Builds a compact turn/run usage line as a fragment of styled spans: token pairs read as
 * "in / out", zero-valued optional fields (reasoning, cache) are dimmed rather than omitted
 * (0 is a reported value, distinct from "not reported"), and cost gets its own accent.
 */
function buildUsageFragment(usage) {
	const parts = [];
	if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) {
		const input = usage.inputTokens === undefined ? "—" : formatNumber(usage.inputTokens);
		const output = usage.outputTokens === undefined ? "—" : formatNumber(usage.outputTokens);
		parts.push({ text: `${input} in / ${output} out` });
	}
	if (usage.reasoningTokens !== undefined) {
		parts.push({ text: `Reasoning ${formatNumber(usage.reasoningTokens)}`, dim: usage.reasoningTokens === 0 });
	}
	if (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined) {
		const read = usage.cacheReadTokens;
		const write = usage.cacheWriteTokens;
		parts.push({
			text: `Cache ${read === undefined ? "—" : formatNumber(read)} / ${write === undefined ? "—" : formatNumber(write)}`,
			dim: !read && !write,
		});
	}
	if (usage.cost !== undefined) parts.push({ text: formatCost(usage.cost), cost: true });

	const fragment = document.createDocumentFragment();
	if (parts.length === 0) {
		fragment.append("Usage unavailable");
		return fragment;
	}
	parts.forEach((part, index) => {
		if (index > 0) fragment.append(" · ");
		const span = document.createElement("span");
		if (part.dim) span.className = "usage-part-dim";
		if (part.cost) span.className = "usage-part-cost";
		span.textContent = part.text;
		fragment.append(span);
	});
	return fragment;
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
	elements.status.classList.toggle("reconnecting", text.startsWith("Reconnecting"));
}

function formatDuration(milliseconds) {
	return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}

function scrollToLatest() {
	if (!stickToBottom) {
		elements.jumpToLatest.hidden = false;
		return;
	}
	// Instant, not smooth: a smooth scroll animates toward a target that can go stale mid-flight
	// while streaming content keeps growing the page, which falsely reads as "user scrolled away."
	window.scrollTo({ top: document.body.scrollHeight, behavior: "auto" });
}

setInterval(() => {
	const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
	const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
	elements.elapsed.textContent = `${minutes}:${(seconds % 60).toString().padStart(2, "0")}`;
}, 1000);

if (debug) void playDebugFixture();
else connect();
