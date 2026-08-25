import assert from "node:assert/strict";
import test from "node:test";

import { addUsage, createUsageAccumulator, providerUsage, usageRollup } from "../src/usage.js";

test("normalizes provider-reported usage without estimating missing values", () => {
	assert.deepEqual(
		providerUsage({
			input: 100,
			output: 20,
			reasoning: 5,
			cacheRead: 40,
			cacheWrite: 10,
			cost: { total: 0.0123 },
		}),
		{
			inputTokens: 100,
			outputTokens: 20,
			reasoningTokens: 5,
			cacheReadTokens: 40,
			cacheWriteTokens: 10,
			cost: 0.0123,
		},
	);
	assert.deepEqual(providerUsage({ input: 12, output: 3 }), { inputTokens: 12, outputTokens: 3 });
});

test("rolls up only values reported by every completed model request", () => {
	const usage = createUsageAccumulator();
	addUsage(usage, { inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 40, cost: 0.01 });
	addUsage(usage, { inputTokens: 80, outputTokens: 10, cacheReadTokens: 20, cost: 0.02 });

	assert.equal(usage.requests, 2);
	assert.deepEqual(usageRollup(usage), {
		inputTokens: 180,
		outputTokens: 30,
		cacheReadTokens: 60,
		cost: 0.03,
	});
});

test("keeps reported zero values available", () => {
	const usage = createUsageAccumulator();
	addUsage(usage, {
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		cost: 0,
	});
	assert.deepEqual(usageRollup(usage), {
		inputTokens: 0,
		outputTokens: 0,
		reasoningTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		cost: 0,
	});
});
