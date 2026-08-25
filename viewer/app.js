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
};

const token = new URLSearchParams(location.search).get("token");
const messages = new Map();
const toolRows = new Map();
const turnUsageRows = new Map();
const runUsageRows = new Map();
let startedAt = Date.now();
let retryTimer;
let lastAgentGroup;

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

function handle(event) {
	if (event.v !== 2) return;

	switch (event.type) {
		case "hello":
			handleHello(event);
			break;
		case "metrics":
			handleMetrics(event);
			break;
		case "message.started":
			handleMessageStarted(event);
			break;
		case "message.delta":
			handleMessageDelta(event);
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
	createMessage(event.data.id, "assistant", "");
}

function handleMessageDelta(event) {
	const content = messages.get(event.data.id) ?? createMessage(event.data.id, "assistant", "");
	content.textContent += event.data.text;
	content.classList.add("cursor");
	scrollToLatest();
}

function handleMessageCompleted(event) {
	const content = messages.get(event.data.id) ?? createMessage(event.data.id, event.data.role, event.data.text);
	setMessageContent(content, event.data.text, event.data.role);
	content.classList.remove("cursor");
	if (event.data.role === "assistant" && !event.data.text) content.closest(".message-block")?.remove();
	scrollToLatest();
}

function handleTurnUsage(event) {
	const message = event.data.messageId ? messages.get(event.data.messageId) : undefined;
	const group = message?.closest(".message-group") ?? lastAgentGroup ?? createSpeakerGroup("assistant");
	let content = turnUsageRows.get(event.data.id);
	if (!content) {
		content = createBlock(group, "Turn usage", "", "usage-block");
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
		content = createBlock(group, "Agent run usage", "", "usage-block");
		runUsageRows.set(event.data.id, content);
	}
	const requestLabel = event.data.modelRequests === 1 ? "1 model request" : `${event.data.modelRequests} model requests`;
	content.textContent = `${requestLabel} · ${formatUsage(event.data.usage)}`;
	scrollToLatest();
}

function handleToolStarted(event) {
	const group = lastAgentGroup ?? createSpeakerGroup("assistant");
	const content = createBlock(group, `Tool · ${event.data.name}`, "running", "tool-block");
	toolRows.set(event.data.id, content);
	scrollToLatest();
}

function handleToolCompleted(event) {
	let content = toolRows.get(event.data.id);
	if (!content) {
		const group = lastAgentGroup ?? createSpeakerGroup("assistant");
		content = createBlock(group, `Tool · ${event.data.name}`, "", "tool-block");
	}
	content.textContent = `${event.data.isError ? "failed" : "done"} · ${formatDuration(event.data.durationMs)}`;
	if (event.data.isError) content.closest(".message-block")?.classList.add("error");
	scrollToLatest();
}

function createMessage(id, role, text) {
	const group = createSpeakerGroup(role);
	const content = createBlock(group, role === "assistant" ? "Text" : "", text);
	messages.set(id, content);
	return content;
}

function createSpeakerGroup(role) {
	elements.empty?.remove();
	const row = document.createElement("article");
	row.className = `event ${role}`;
	const label = document.createElement("div");
	label.className = "label";
	label.textContent = role === "user" ? "User" : "Agent";
	const group = document.createElement("div");
	group.className = "message-group";
	row.append(label, group);
	elements.events.append(row);
	lastAgentGroup = role === "assistant" ? group : undefined;
	return group;
}

function createBlock(group, type, text, className = "") {
	const block = document.createElement("div");
	block.className = `message-block ${className}`.trim();
	if (type) {
		const typeLabel = document.createElement("div");
		typeLabel.className = "message-type";
		typeLabel.textContent = type;
		block.append(typeLabel);
	}
	const content = document.createElement("div");
	content.className = "content";
	content.textContent = text;
	block.append(content);
	group.append(block);
	return content;
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

connect();
