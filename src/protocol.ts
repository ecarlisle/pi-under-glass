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

export interface ModelIdentity {
	provider: string;
	id: string;
	name: string;
}

export interface Metrics {
	modelRequests: number;
	usage: UsageValues;
	tools: number;
	latestContext?: ContextSnapshot;
}

export type SessionTurnStatus = "active" | "completed" | "interrupted";

export interface TurnToolFact {
	id: string;
	name: string;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	isError?: boolean;
}

export interface TurnFacts {
	id: string;
	status: SessionTurnStatus;
	startedAt: number;
	endedAt?: number;
	durationMs?: number;
	prompt?: string;
	agentReportedExcerpt?: string;
	responseStartedAt?: number;
	responseEndedAt?: number;
	model?: ModelIdentity;
	thinkingLevel?: string;
	modelRequests: number;
	usage: UsageValues;
	toolCount: number;
	errorCount: number;
	tools: TurnToolFact[];
	contextStart?: ContextSnapshot;
	contextEnd?: ContextSnapshot;
}

export interface SessionMarkerFact {
	type: "compaction" | "model" | "thinking";
	at: number;
	turnId?: string;
	detail: string;
	summary?: string;
}

export interface EvidenceMetadata {
	id: string;
	type: string;
	at: number;
	turnId?: string;
	label?: string;
	isError?: boolean;
	durationMs?: number;
}

export interface SessionSnapshot {
	sequence: number;
	model?: ModelIdentity;
	thinkingLevel?: string;
	currentTurn?: TurnFacts;
	completedTurns: TurnFacts[];
	contextPoints: Array<{ at: number; turnId?: string; snapshot: ContextSnapshot }>;
	markers: SessionMarkerFact[];
	evidence: EvidenceMetadata[];
}

export interface EventDataMap {
	"session.started": { cwd: string };
	"session.model.changed": {
		model: ModelIdentity;
		previousModel?: ModelIdentity;
		source: "set" | "cycle" | "restore";
		thinkingLevel?: string;
	};
	"session.thinking.changed": { level: string; previousLevel: string };
	"session.compacted": {
		reason: "manual" | "threshold" | "overflow";
		tokensBefore: number;
		summary: string;
		fromExtension: boolean;
		willRetry: boolean;
	};
	"session.ended": { endedAt: number };
	"turn.started": {
		id: string;
		prompt: string;
		model?: ModelIdentity;
		thinkingLevel?: string;
	};
	"turn.completed": TurnFacts;
	"run.systemPrompt": { runId: string; text: string; sessionTurnId?: string };
	"message.completed": {
		id: string;
		role: "user" | "assistant";
		text: string;
		thinking?: string;
		sessionTurnId?: string;
	};
	"message.started": { id: string; role: "assistant"; runId: string; sessionTurnId?: string };
	"message.delta": { id: string; text: string };
	"message.thinking.delta": { id: string; text: string };
	"turn.usage": {
		id: string;
		messageId?: string;
		runId: string;
		usage: UsageValues;
		contextSnapshot?: ContextSnapshot;
		durationMs?: number;
	};
	"run.completed": { id: string; modelRequests: number; usage: UsageValues };
	"tool.started": { id: string; name: string; args?: unknown; turnId?: string; sessionTurnId?: string };
	"tool.completed": {
		id: string;
		name: string;
		isError: boolean;
		durationMs: number;
		durationKnown?: boolean;
		result?: unknown;
		turnId?: string;
		sessionTurnId?: string;
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
	snapshot?: SessionSnapshot;
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
