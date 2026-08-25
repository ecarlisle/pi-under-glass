import type { UsageValues } from "./protocol.js";

const FIELDS = [
	"inputTokens",
	"outputTokens",
	"reasoningTokens",
	"cacheReadTokens",
	"cacheWriteTokens",
	"cost",
] as const;

type UsageField = (typeof FIELDS)[number];

export interface ProviderUsage {
	input?: number;
	output?: number;
	reasoning?: number;
	cacheRead?: number;
	cacheWrite?: number;
	cost?: { total?: number };
}

export interface UsageAccumulator {
	requests: number;
	sums: Record<UsageField, number>;
	complete: Record<UsageField, boolean>;
}

export function providerUsage(usage: ProviderUsage | undefined): UsageValues {
	if (!usage) return {};
	return compactUsage({
		inputTokens: usage.input,
		outputTokens: usage.output,
		reasoningTokens: usage.reasoning,
		cacheReadTokens: usage.cacheRead,
		cacheWriteTokens: usage.cacheWrite,
		cost: usage.cost?.total,
	});
}

export function createUsageAccumulator(): UsageAccumulator {
	return {
		requests: 0,
		sums: emptyRecord(0),
		complete: emptyRecord(true),
	};
}

export function addUsage(accumulator: UsageAccumulator, usage: UsageValues): void {
	accumulator.requests += 1;
	for (const field of FIELDS) {
		const value = usage[field];
		if (value === undefined) {
			accumulator.complete[field] = false;
		} else {
			accumulator.sums[field] += value;
		}
	}
}

export function usageRollup(accumulator: UsageAccumulator): UsageValues {
	if (accumulator.requests === 0) return {};
	const usage: UsageValues = {};
	for (const field of FIELDS) {
		if (accumulator.complete[field]) usage[field] = accumulator.sums[field];
	}
	return usage;
}

function compactUsage(usage: Partial<Record<UsageField, number | undefined>>): UsageValues {
	const compact: UsageValues = {};
	for (const field of FIELDS) {
		const value = usage[field];
		if (typeof value === "number" && Number.isFinite(value) && value >= 0) compact[field] = value;
	}
	return compact;
}

function emptyRecord<T>(value: T): Record<UsageField, T> {
	return Object.fromEntries(FIELDS.map((field) => [field, value])) as Record<UsageField, T>;
}
