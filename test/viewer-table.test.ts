import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Turn overview includes TTFT in its accessible table", async () => {
	const html = await readFile(new URL("../viewer/index.html", import.meta.url), "utf8");
	const headerRow = html.match(/<thead>[\s\S]*?<tr>([\s\S]*?)<\/tr>[\s\S]*?<\/thead>/)?.[1] ?? "";
	const headers = [...headerRow.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)];
	assert.equal(headers.length, 8);
	assert.deepEqual(headers.map((match) => (match[2] ?? "").replace(/<[^>]+>/g, "").trim()), ["Turn", "Prompt", "Visualization", "Status", "Time", "TTFT", "Tools", "Errors"]);
	const visualizationHeader = headers[2];
	assert.ok(visualizationHeader);
	assert.match(visualizationHeader[1] ?? "", /aria-label="Visualization"/);
	assert.match(visualizationHeader[2] ?? "", /class="visually-hidden"/);
	assert.match(headers[5]?.[1] ?? "", /title="Time to first token"/);
	assert.match(html, /<tbody id="turn-list"><\/tbody>/);
	assert.match(html, /<i class="legend-error"><\/i>Errors/);
});

test("Turn table stays compact and retains row and ribbon selection", async () => {
	const [app, css] = await Promise.all([
		readFile(new URL("../viewer/app.js", import.meta.url), "utf8"),
		readFile(new URL("../viewer/styles.css", import.meta.url), "utf8"),
	]);
	assert.match(app, /excerptText\(turn\.prompt \|\| "Prompt unavailable", 21\)/);
	assert.match(app, /row\.addEventListener\("click", \(\) => chooseTurn\(turnId\)\)/);
	assert.match(app, /chooseTurn\(turn\.id, segment\.type\)/);
	assert.match(app, /visualizationCell\.setAttribute\("aria-label", `Turn \$\{turnNumber\} visualization`\)/);
	assert.match(app, /ttftCell\.textContent = formatInvocationLatency\(turn, "firstTextMs"\)/);
	assert.match(app, /fact\("First output", formatInvocationLatency\(turn, "firstOutputMs"\)\)/);
	assert.match(app, /fact\("TTFT", formatInvocationLatency\(turn, "firstTextMs"\)\)/);
	assert.match(css, /\.turn-table \{[^}]*white-space: nowrap;/);
	assert.match(css, /\.turn-table td \{[^}]*text-overflow: ellipsis;/);
	assert.match(css, /\.ribbon-legend \.legend-error \{[^}]*background: var\(--error\);/);
});
