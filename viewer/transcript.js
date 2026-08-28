import { turnEvidence } from "./state.js";

export function createEvidenceRenderer(container, getOptions) {
	const openState = new Map();

	container.addEventListener("toggle", (event) => {
		const details = event.target.closest("details[data-evidence-id]");
		if (details) openState.set(details.dataset.evidenceId, details.open);
	}, true);

	return {
		render(state, turnId) {
			container.replaceChildren();
			if (!turnId) return container.append(empty("Select a turn to inspect its evidence."));
			const items = turnEvidence(state, turnId).sort((a, b) => a.at - b.at);
			if (items.length === 0) return container.append(empty("No detailed evidence was retained for this turn."));
			const options = getOptions();
			const tools = items.filter((item) => item.kind === "tool");
			const latestTool = tools.at(-1);
			const latestAssistantAt = Math.max(0, ...items.filter((item) => item.kind === "assistant").map((item) => item.at));
			for (const item of items) {
				const node = renderItem(item, options, openState, latestTool?.id === item.id, latestAssistantAt);
				if (node) container.append(node);
			}
		},
		focus(evidenceId) {
			const target = container.querySelector(`[data-evidence-id="${CSS.escape(evidenceId)}"]`);
			if (!target) return;
			if (target instanceof HTMLDetailsElement) target.open = true;
			target.scrollIntoView({ block: "nearest", behavior: "smooth" });
			target.classList.add("evidence-focus");
			setTimeout(() => target.classList.remove("evidence-focus"), 1200);
		},
	};
}

function renderItem(item, options, openState, isLatestTool, latestAssistantAt) {
	const at = createTimestamp(item.at, options.showTimestamps);
	switch (item.kind) {
		case "prompt":
			return block(item, "Prompt", item.data.text, "prompt-evidence", at);
		case "assistant": {
			const wrapper = document.createElement("article");
			wrapper.className = "evidence-card response-evidence";
			wrapper.dataset.evidenceId = item.id;
			wrapper.append(header("Assistant response", at));
			if (options.showThinking && item.data.thinking) {
				wrapper.append(details(item.id, "Agent processing", item.data.thinking, "thinking-evidence", options.expandThinking, openState, true));
			}
			const body = document.createElement("div");
			body.className = "evidence-body markdown";
			body.innerHTML = renderMarkdown(item.data.text ?? "");
			wrapper.append(body);
			return wrapper;
		}
		case "system":
			if (!options.showSystemPrompt) return undefined;
			return details(item.id, "System prompt", item.data.text, "system-evidence", false, openState);
		case "tool": {
			const tool = item.data;
			const running = tool.endedAt === undefined;
			const afterAssistant = isLatestTool && latestAssistantAt > (tool.endedAt ?? tool.startedAt);
			const open = options.expandTools || running || tool.isError || afterAssistant;
			const title = `Tool · ${tool.name}`;
			const row = document.createElement("details");
			row.className = `evidence-card tool-evidence${tool.isError ? " error" : ""}${running ? " running" : ""}`;
			row.dataset.evidenceId = item.id;
			row.open = openState.has(item.id) ? openState.get(item.id) : open;
			const status = running ? "running" : `${tool.isError ? "failed" : "done"}${tool.durationMs !== undefined ? ` · ${formatDuration(tool.durationMs)}` : ""}`;
			const summary = document.createElement("summary");
			summary.append(title, badge(status, tool.isError ? "error" : running ? "active" : "neutral"), at);
			row.append(summary);
			if (options.showToolInput && tool.args !== undefined) row.append(valueSection("Arguments", tool.args));
			if (options.showToolResults && tool.result !== undefined) row.append(valueSection("Full result", tool.result, tool.isError));
			return row;
		}
		case "marker": {
			const marker = item.data;
			const title = marker.type === "session.compacted" || marker.type === "compaction" ? "Context compacted" : marker.type === "session.model.changed" || marker.type === "model" ? "Model changed" : "Thinking changed";
			const text = marker.detail ?? markerText(marker);
			const row = block(item, title, text, "marker-evidence", at);
			if (marker.summary) row.append(details(`${item.id}:summary`, "Retained context summary", marker.summary, "compaction-evidence", options.expandCompactions, openState, true));
			return row;
		}
		case "usage":
			if (!options.showUsage) return undefined;
			return block(item, "Model request facts", usageText(item.data), "usage-evidence", at);
		case "metadata":
			return block(item, "Earlier evidence", `${item.data.type}${item.data.label ? ` · ${item.data.label}` : ""}`, "metadata-evidence", at);
		default:
			return undefined;
	}
}

function block(item, title, text, className, timestamp) {
	const wrapper = document.createElement("article");
	wrapper.className = `evidence-card ${className}`;
	wrapper.dataset.evidenceId = item.id;
	wrapper.append(header(title, timestamp));
	const body = document.createElement("div");
	body.className = "evidence-body";
	body.textContent = text ?? "";
	wrapper.append(body);
	return wrapper;
}

function details(id, title, text, className, defaultOpen, openState, markdown = false) {
	const wrapper = document.createElement("details");
	wrapper.className = `nested-evidence ${className}`;
	wrapper.dataset.evidenceId = id;
	wrapper.open = openState.has(id) ? openState.get(id) : defaultOpen;
	const summary = document.createElement("summary");
	summary.textContent = title;
	const copy = copyButton(() => text);
	const body = document.createElement("div");
	body.className = "evidence-body";
	if (markdown) body.innerHTML = renderMarkdown(text);
	else body.textContent = text;
	wrapper.append(summary, copy, body);
	return wrapper;
}

function header(title, timestamp) {
	const row = document.createElement("div");
	row.className = "evidence-header";
	const heading = document.createElement("strong");
	heading.textContent = title;
	row.append(heading, timestamp);
	return row;
}

function valueSection(title, value, isError = false) {
	const section = document.createElement("section");
	section.className = "tool-section";
	const text = valueText(value);
	const heading = document.createElement("div");
	heading.className = "tool-section-heading";
	const label = document.createElement("strong");
	label.textContent = title;
	heading.append(label, copyButton(() => text));
	const pre = document.createElement("pre");
	if (isError) pre.className = "error";
	pre.textContent = text;
	section.append(heading, pre);
	return section;
}

function badge(text, kind) {
	const element = document.createElement("span");
	element.className = `fact-badge fact-badge--${kind}`;
	element.textContent = text;
	return element;
}

function copyButton(getText) {
	const button = document.createElement("button");
	button.type = "button";
	button.className = "copy-button";
	button.textContent = "Copy";
	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		navigator.clipboard.writeText(getText()).then(() => {
			button.textContent = "Copied";
			setTimeout(() => (button.textContent = "Copy"), 1200);
		}).catch(() => (button.textContent = "Copy failed"));
	});
	return button;
}

function createTimestamp(at, visible) {
	const time = document.createElement("time");
	time.className = "timestamp";
	time.hidden = !visible;
	time.dateTime = new Date(at).toISOString();
	time.textContent = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(at);
	return time;
}

function markerText(marker) {
	if (marker.reason) return `${marker.reason} · ${formatNumber(marker.tokensBefore)} tokens before${marker.willRetry ? " · retrying interrupted request" : ""}`;
	if (marker.model) return `${marker.previousModel ? `${formatModel(marker.previousModel)} → ` : ""}${formatModel(marker.model)}`;
	if (marker.level) return `${marker.previousLevel} → ${marker.level}`;
	return "Observed session change";
}

function usageText(data) {
	const parts = [];
	const usage = data.usage ?? {};
	if (usage.inputTokens !== undefined || usage.outputTokens !== undefined) parts.push(`${usage.inputTokens === undefined ? "—" : formatNumber(usage.inputTokens)} in / ${usage.outputTokens === undefined ? "—" : formatNumber(usage.outputTokens)} out`);
	if (usage.reasoningTokens !== undefined) parts.push(`Reasoning tokens ${formatNumber(usage.reasoningTokens)}`);
	if (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined) parts.push(`Cache ${usage.cacheReadTokens === undefined ? "—" : formatNumber(usage.cacheReadTokens)} / ${usage.cacheWriteTokens === undefined ? "—" : formatNumber(usage.cacheWriteTokens)}`);
	if (usage.cost !== undefined) parts.push(`$${usage.cost.toFixed(4)}`);
	if (data.durationMs !== undefined) parts.push(`Request wall time ${formatDuration(data.durationMs)}`);
	return parts.length > 0 ? parts.join(" · ") : "Usage unavailable";
}

function valueText(value) {
	if (typeof value === "string") return value;
	try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function renderMarkdown(text) {
	if (!text) return "";
	let html = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
	html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => `<pre><code>${code}</code></pre>`);
	html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
	html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/__([^_]+)__/g, "<strong>$1</strong>");
	html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>").replace(/(?<!_)_(?!_)([^_]+)_(?!_)/g, "<em>$1</em>");
	html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>").replace(/^## (.+)$/gm, "<h2>$1</h2>").replace(/^# (.+)$/gm, "<h1>$1</h1>");
	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
	html = html.replace(/^[\t ]*[-*] (.+)$/gm, "<li>$1</li>").replace(/(<li>[\s\S]*?<\/li>(\n)?)+/g, (match) => `<ul>${match.replace(/\n/g, "")}</ul>`);
	return `<p>${html.replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>`;
}

function formatModel(model) {
	return model.name && model.name !== model.id ? `${model.name} (${model.provider}/${model.id})` : `${model.provider}/${model.id}`;
}

function formatDuration(milliseconds) {
	return milliseconds < 1000 ? `${milliseconds}ms` : `${(milliseconds / 1000).toFixed(1)}s`;
}

function formatNumber(value) {
	return new Intl.NumberFormat().format(value);
}

function empty(text) {
	const row = document.createElement("p");
	row.className = "empty";
	row.textContent = text;
	return row;
}
