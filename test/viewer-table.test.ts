import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Viewer prioritizes orientation and keeps detailed totals on demand", async () => {
	const html = await readFile(new URL("../viewer/index.html", import.meta.url), "utf8");
	assert.match(html, /class="orientation" aria-label="Session orientation"/);
	assert.match(html, /<span class="status" id="status" aria-live="polite">/);
	assert.match(html, /<strong id="elapsed">/);
	assert.match(html, /<strong id="model">/);
	assert.match(html, /<details class="session-details" id="session-details">/);
	assert.match(html, /<summary>Session totals<\/summary>/);
	assert.match(html, /<p class="connection-note" id="connection-note" aria-live="polite">/);
	assert.doesNotMatch(html, /Event stream/);
});

test("Turn cards are one focus stop and preserve TTFT and activity context", async () => {
	const [app, css] = await Promise.all([
		readFile(new URL("../viewer/app.js", import.meta.url), "utf8"),
		readFile(new URL("../viewer/styles.css", import.meta.url), "utf8"),
	]);
	assert.match(app, /card\.className = `turn-card/);
	assert.match(app, /card\.type = "button"/);
	assert.match(app, /card\.setAttribute\("aria-label", turnCardLabel\(turn, turnNumber\)\)/);
	assert.match(app, /card\.addEventListener\("click", \(\) => chooseTurn\(turnId\)\)/);
	assert.doesNotMatch(app, /item\.tabIndex = 0/);
	assert.match(app, /cardFact\("First text", formatInvocationLatency\(turn, "firstTextMs"\)\)/);
	assert.match(app, /fact\("First output", formatInvocationLatency\(turn, "firstOutputMs"\)\)/);
	assert.match(app, /fact\("First text", formatInvocationLatency\(turn, "firstTextMs"\)\)/);
	assert.match(app, /turn\.partialEvidence/);
	assert.match(app, /scrollIntoView\(\{ behavior, block: "start" \}\)/);
	assert.match(css, /\.turn-card:focus-visible/);
	assert.match(css, /\.turn-card-facts/);
});

test("Evidence controls sit beside the selected turn and use plain-language labels", async () => {
	const [html, transcript] = await Promise.all([
		readFile(new URL("../viewer/index.html", import.meta.url), "utf8"),
		readFile(new URL("../viewer/transcript.js", import.meta.url), "utf8"),
	]);
	const detail = html.match(/<section class="detail-panel"[\s\S]*?<\/section>/)?.[0] ?? "";
	assert.match(detail, /<summary>Evidence display options<\/summary>/);
	assert.match(detail, /Reasoning trace/);
	assert.match(detail, /System prompt sent to model/);
	assert.doesNotMatch(html, /<aside class="options">/);
	assert.match(transcript, /"Reasoning trace"/);
	assert.match(transcript, /duration unavailable/);
});
