export const PROTOCOL_VERSION = 2 as const;

export interface UsageValues {
	inputTokens?: number;
	outputTokens?: number;
	reasoningTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	cost?: number;
}

export interface ContextSnapshot {
	inputTokens: number;
	contextWindow?: number;
}

export interface Metrics {
	modelRequests: number;
	usage: UsageValues;
	tools: number;
	latestContext?: ContextSnapshot;
}

export interface EventDataMap {
	"session.started": { cwd: string };
	"message.completed": { id: string; role: "user" | "assistant"; text: string; thinking?: string };
	"message.started": { id: string; role: "assistant" };
	"message.delta": { id: string; text: string };
	"message.thinking.delta": { id: string; text: string };
	"turn.usage": {
		id: string;
		messageId?: string;
		runId: string;
		usage: UsageValues;
		contextSnapshot?: ContextSnapshot;
	};
	"run.completed": { id: string; modelRequests: number; usage: UsageValues };
	"tool.started": { id: string; name: string; args?: unknown };
	"tool.completed": {
		id: string;
		name: string;
		isError: boolean;
		durationMs: number;
		result?: unknown;
	};
	metrics: Metrics;
}

export type GlassEvent<K extends keyof EventDataMap = keyof EventDataMap> = K extends keyof EventDataMap
	? {
			v: typeof PROTOCOL_VERSION;
			seq: number;
			at: number;
			sessionId: string;
			type: K;
			data: EventDataMap[K];
		}
	: never;

export interface HelloMessage {
	v: typeof PROTOCOL_VERSION;
	type: "hello";
	sessionId: string;
	startedAt: number;
	cwd: string;
	metrics: Metrics;
}

export function createEvent<K extends keyof EventDataMap>(
	sessionId: string,
	seq: number,
	type: K,
	data: EventDataMap[K],
	at = Date.now(),
): GlassEvent<K> {
	return { v: PROTOCOL_VERSION, seq, at, sessionId, type, data } as GlassEvent<K>;
}
