import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
	createEvent,
	PROTOCOL_VERSION,
	type ContextSnapshot,
	type EventDataMap,
	type EvidenceMetadata,
	type Metrics,
	type ModelIdentity,
	type SessionMarkerFact,
	type SessionSnapshot,
	type SessionTurnStatus,
	type TurnFacts,
	type TurnToolFact,
} from "./protocol.js";
import { startViewerServer, type ViewerServer } from "./server.js";
import {
	addUsage,
	createUsageAccumulator,
	providerUsage,
	usageRollup,
	type ProviderUsage,
	type UsageAccumulator,
} from "./usage.js";

const DEBUG_FIXTURE_PATH = fileURLToPath(new URL("../fixtures/sample-session.json", import.meta.url));

type Role = "user" | "assistant" | "toolResult";

interface Message {
	role: Role;
	content: string | Array<{ type: string; text?: string; thinking?: string }>;
	usage?: ProviderUsage;
}

interface PiContext {
	cwd: string;
	mode: "tui" | "rpc" | "json" | "print";
	ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
	model?: PiModel;
	thinkingLevel?: string;
}

interface PiModel {
	provider: string;
	id: string;
	name: string;
	contextWindow?: number;
}

interface ActiveSessionTurn {
	id: string;
	startedAt: number;
	prompt: string;
	usage: UsageAccumulator;
	tools: TurnToolFact[];
	errorCount: number;
	assistantText?: string;
	responseStartedAt?: number;
	responseEndedAt?: number;
	model?: ModelIdentity;
	thinkingLevel?: string;
	contextStart?: ContextSnapshot;
	contextEnd?: ContextSnapshot;
}

interface ActiveInvocation {
	id: string;
	sessionTurnId: string;
	sessionTurn: ActiveSessionTurn;
	messageId: string | undefined;
	startedAt: number;
}

type EventHandler = (event: any, context: PiContext) => void | Promise<void>;

interface PiApi {
	on(event: string, handler: EventHandler): void;
	registerCommand(
		name: string,
		command: {
			description: string;
			handler: (args: string, context: PiContext) => Promise<void>;
		},
	): void;
	exec(command: string, args: string[]): Promise<{ code: number; stderr: string }>;
}

export default function piUnderGlass(pi: PiApi): void {
	const sessionId = randomUUID();
	const token = randomBytes(24).toString("base64url");
	const startedAt = Date.now();
	const sessionUsage = createUsageAccumulator();
	const toolStarts = new Map<string, { start: number; invocationId?: string; sessionTurnId?: string }>();
	const completedTurns: TurnFacts[] = [];
	const contextPoints: SessionSnapshot["contextPoints"] = [];
	const markers: SessionMarkerFact[] = [];
	const evidence: EvidenceMetadata[] = [];
	let cwd = process.cwd();
	let sequence = 0;
	let messageSequence = 0;
	let sessionTurnSequence = 0;
	let invocationSequence = 0;
	let tools = 0;
	let latestContext: ContextSnapshot | undefined;
	let currentModel: ModelIdentity | undefined;
	let currentThinkingLevel: string | undefined;
	let activeSessionTurn: ActiveSessionTurn | undefined;
	let activeInvocation: ActiveInvocation | undefined;
	let activeAssistantId: string | undefined;
	let server: ViewerServer | undefined;
	let starting: Promise<ViewerServer> | undefined;

	const publish = <K extends keyof EventDataMap>(type: K, data: EventDataMap[K]) => {
		if (!server) return;
		const event = createEvent(sessionId, ++sequence, type, data);
		recordEvidence(event.type, event.data, event.at);
		server.publish(event);
	};

	const metrics = (): Metrics => ({
		modelRequests: sessionUsage.requests,
		usage: usageRollup(sessionUsage),
		tools,
		...(latestContext ? { latestContext } : {}),
	});

	const turnFacts = (turn: ActiveSessionTurn, status: SessionTurnStatus, endedAt?: number): TurnFacts => ({
		id: turn.id,
		status,
		startedAt: turn.startedAt,
		...(endedAt !== undefined ? { endedAt, durationMs: Math.max(0, endedAt - turn.startedAt) } : {}),
		...(turn.prompt ? { prompt: turn.prompt } : {}),
		...(turn.assistantText ? { agentReportedExcerpt: textExcerpt(turn.assistantText, 240) } : {}),
		...(turn.responseStartedAt !== undefined ? { responseStartedAt: turn.responseStartedAt } : {}),
		...(turn.responseEndedAt !== undefined ? { responseEndedAt: turn.responseEndedAt } : {}),
		...(turn.model ? { model: turn.model } : {}),
		...(turn.thinkingLevel ? { thinkingLevel: turn.thinkingLevel } : {}),
		modelRequests: turn.usage.requests,
		usage: usageRollup(turn.usage),
		toolCount: turn.tools.length,
		errorCount: turn.errorCount,
		tools: turn.tools.map((tool) => ({ ...tool })),
		...(turn.contextStart ? { contextStart: turn.contextStart } : {}),
		...(turn.contextEnd ? { contextEnd: turn.contextEnd } : {}),
	});

	const finishSessionTurn = (status: SessionTurnStatus = "completed") => {
		if (!activeSessionTurn) return;
		const endedAt = Date.now();
		const facts = turnFacts(activeSessionTurn, status, endedAt);
		publish("turn.completed", facts);
		// Preserve the legacy technical Agent-run summary for older v2 viewers.
		if (facts.modelRequests > 0) {
			publish("run.completed", {
				id: facts.id,
				modelRequests: facts.modelRequests,
				usage: facts.usage,
			});
		}
		completedTurns.push(facts);
		if (completedTurns.length > 100) completedTurns.shift();
		activeSessionTurn = undefined;
	};

	const beginSessionTurn = (prompt: string): ActiveSessionTurn => {
		if (activeSessionTurn) finishSessionTurn("interrupted");
		activeSessionTurn = {
			id: `turn-${++sessionTurnSequence}`,
			startedAt: Date.now(),
			prompt,
			usage: createUsageAccumulator(),
			tools: [],
			errorCount: 0,
			...(currentModel ? { model: currentModel } : {}),
			...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
			...(latestContext ? { contextStart: latestContext } : {}),
		};
		publish("turn.started", {
			id: activeSessionTurn.id,
			prompt,
			...(currentModel ? { model: currentModel } : {}),
			...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
		});
		return activeSessionTurn;
	};

	const currentSessionTurn = (): ActiveSessionTurn => activeSessionTurn ?? beginSessionTurn("");

	const snapshot = (): SessionSnapshot => ({
		sequence,
		...(currentModel ? { model: currentModel } : {}),
		...(currentThinkingLevel ? { thinkingLevel: currentThinkingLevel } : {}),
		...(activeSessionTurn ? { currentTurn: turnFacts(activeSessionTurn, "active") } : {}),
		completedTurns: completedTurns.map((turn) => ({ ...turn, tools: turn.tools.map((tool) => ({ ...tool })) })),
		contextPoints: contextPoints.map((point) => ({ ...point, snapshot: { ...point.snapshot } })),
		markers: markers.map((marker) => ({ ...marker })),
		evidence: evidence.map((item) => ({ ...item })),
	});

	const recordEvidence = (type: keyof EventDataMap, rawData: EventDataMap[keyof EventDataMap], at: number) => {
		if (type === "metrics" || type === "message.delta" || type === "message.thinking.delta") return;
		const data = rawData as Record<string, unknown>;
		const sessionTurnId =
			type === "turn.started" || type === "turn.completed"
				? String(data.id)
				: typeof data.sessionTurnId === "string"
					? data.sessionTurnId
					: activeSessionTurn?.id;
		const item: EvidenceMetadata = {
			id: `${sequence}:${type}:${typeof data.id === "string" ? data.id : "event"}`,
			type,
			at,
			...(sessionTurnId ? { turnId: sessionTurnId } : {}),
			...(typeof data.name === "string" ? { label: data.name } : {}),
			...(typeof data.isError === "boolean" ? { isError: data.isError } : {}),
			...(typeof data.durationMs === "number" ? { durationMs: data.durationMs } : {}),
		};
		evidence.push(item);
		if (evidence.length > 250) evidence.shift();
	};

	const ensureServer = async (context: PiContext): Promise<ViewerServer> => {
		cwd = context.cwd;
		if (server) return server;
		if (!starting) {
			starting = startViewerServer({
				token,
				port: configuredPort(),
				debugFixturePath: DEBUG_FIXTURE_PATH,
				hello: () => ({
					v: PROTOCOL_VERSION,
					type: "hello",
					sessionId,
					startedAt,
					cwd,
					metrics: metrics(),
					snapshot: snapshot(),
				}),
			}).then((started) => {
				server = started;
				return started;
			});
		}
		try {
			return await starting;
		} catch (error) {
			starting = undefined;
			throw error;
		}
	};

	pi.on("session_start", async (_event, context) => {
		currentModel = context.model ? modelIdentity(context.model) : undefined;
		currentThinkingLevel = context.thinkingLevel;
		try {
			await ensureServer(context);
			publish("session.started", { cwd });
		} catch (error) {
			context.ui.notify(`Pi Under Glass could not start: ${errorText(error)}`, "error");
		}
	});

	pi.on("before_agent_start", (event: { systemPrompt: string }) => {
		const turn = currentSessionTurn();
		if (event.systemPrompt) {
			publish("run.systemPrompt", { runId: turn.id, sessionTurnId: turn.id, text: event.systemPrompt });
		}
	});

	pi.on(
		"model_select",
		(
			event: {
				model: PiModel;
				previousModel?: PiModel;
				source: "set" | "cycle" | "restore";
			},
			context,
		) => {
			currentModel = modelIdentity(event.model);
			currentThinkingLevel = context.thinkingLevel;
			publish("session.model.changed", {
				model: currentModel,
				...(event.previousModel ? { previousModel: modelIdentity(event.previousModel) } : {}),
				source: event.source,
				...(context.thinkingLevel ? { thinkingLevel: context.thinkingLevel } : {}),
			});
			markers.push({
				type: "model",
				at: Date.now(),
				...(activeSessionTurn ? { turnId: activeSessionTurn.id } : {}),
				detail: `${event.previousModel ? `${event.previousModel.provider}/${event.previousModel.id} → ` : ""}${event.model.provider}/${event.model.id}`,
			});
			if (markers.length > 100) markers.shift();
		},
	);

	pi.on("thinking_level_select", (event: { level: string; previousLevel: string }) => {
		currentThinkingLevel = event.level;
		publish("session.thinking.changed", {
			level: event.level,
			previousLevel: event.previousLevel,
		});
		markers.push({
			type: "thinking",
			at: Date.now(),
			...(activeSessionTurn ? { turnId: activeSessionTurn.id } : {}),
			detail: `${event.previousLevel} → ${event.level}`,
		});
		if (markers.length > 100) markers.shift();
	});

	pi.on(
		"session_compact",
		(event: {
			compactionEntry: { tokensBefore: number; summary: string };
			fromExtension: boolean;
			reason: "manual" | "threshold" | "overflow";
			willRetry: boolean;
		}) => {
			latestContext = undefined;
			publish("session.compacted", {
				reason: event.reason,
				tokensBefore: event.compactionEntry.tokensBefore,
				summary: event.compactionEntry.summary,
				fromExtension: event.fromExtension,
				willRetry: event.willRetry,
			});
			markers.push({
				type: "compaction",
				at: Date.now(),
				...(activeSessionTurn ? { turnId: activeSessionTurn.id } : {}),
				detail: `${event.reason} · ${event.compactionEntry.tokensBefore} tokens before`,
				summary: event.compactionEntry.summary,
			});
			if (markers.length > 100) markers.shift();
			publish("metrics", metrics());
		},
	);

	pi.on("message_start", (event: { message: Message }) => {
		if (event.message.role === "user") {
			const turn = beginSessionTurn(messageText(event.message));
			publish("message.completed", {
				id: `message-${++messageSequence}`,
				role: "user",
				text: turn.prompt,
				sessionTurnId: turn.id,
			});
		} else if (event.message.role === "assistant") {
			const turn = currentSessionTurn();
			activeAssistantId = `message-${++messageSequence}`;
			if (activeInvocation) activeInvocation.messageId = activeAssistantId;
			publish("message.started", {
				id: activeAssistantId,
				role: "assistant",
				runId: turn.id,
				sessionTurnId: turn.id,
			});
		}
	});

	pi.on("turn_start", () => {
		const turn = currentSessionTurn();
		activeInvocation = {
			id: `invocation-${++invocationSequence}`,
			sessionTurnId: turn.id,
			sessionTurn: turn,
			messageId: undefined,
			startedAt: Date.now(),
		};
	});

	pi.on("message_update", (event: { assistantMessageEvent?: { type: string; delta?: string } }) => {
		const update = event.assistantMessageEvent;
		if (!activeAssistantId || !update?.delta) return;
		if (update.type === "text_delta") {
			if (activeSessionTurn && activeSessionTurn.responseStartedAt === undefined) {
				activeSessionTurn.responseStartedAt = Date.now();
			}
			publish("message.delta", { id: activeAssistantId, text: update.delta });
		} else if (update.type === "thinking_delta") {
			publish("message.thinking.delta", { id: activeAssistantId, text: update.delta });
		}
	});

	pi.on("message_end", (event: { message: Message }) => {
		if (event.message.role !== "assistant") return;
		const id = activeAssistantId ?? `message-${++messageSequence}`;
		const thinking = messageThinking(event.message);
		publish("message.completed", {
			id,
			role: "assistant",
			text: messageText(event.message),
			...(thinking ? { thinking } : {}),
			...(activeSessionTurn ? { sessionTurnId: activeSessionTurn.id } : {}),
		});
		if (activeSessionTurn) {
			const text = messageText(event.message);
			activeSessionTurn.assistantText = text;
			if (text && activeSessionTurn.responseStartedAt === undefined) activeSessionTurn.responseStartedAt = Date.now();
			activeSessionTurn.responseEndedAt = Date.now();
		}
		activeAssistantId = undefined;
	});

	pi.on("turn_end", (event: { message: Message }, context) => {
		const hadActiveInvocation = Boolean(activeInvocation);
		let invocation = activeInvocation;
		if (!invocation) {
			const fallbackTurn = currentSessionTurn();
			invocation = {
				id: `invocation-${++invocationSequence}`,
				sessionTurnId: fallbackTurn.id,
				sessionTurn: fallbackTurn,
				messageId: undefined,
				startedAt: Date.now(),
			};
		}
		// Only report duration when we actually observed turn_start; a synthetic fallback turn has
		// no real start time to measure from, and this codebase never estimates missing values.
		const durationMs = hadActiveInvocation ? Date.now() - invocation.startedAt : undefined;
		const usage = providerUsage(event.message.usage);
		addUsage(invocation.sessionTurn.usage, usage);
		addUsage(sessionUsage, usage);

		latestContext = undefined;
		if (usage.inputTokens !== undefined) {
			const contextWindow = context.model?.contextWindow;
			latestContext = {
				inputTokens: usage.inputTokens,
				...(typeof contextWindow === "number" && contextWindow > 0 ? { contextWindow } : {}),
			};
			invocation.sessionTurn.contextEnd = latestContext;
			contextPoints.push({
				at: Date.now(),
				turnId: invocation.sessionTurnId,
				snapshot: latestContext,
			});
			if (contextPoints.length > 200) contextPoints.shift();
		}

		if (Object.keys(usage).length > 0) {
			publish("turn.usage", {
				id: invocation.id,
				runId: invocation.sessionTurnId,
				usage,
				...(invocation.messageId ? { messageId: invocation.messageId } : {}),
				...(latestContext ? { contextSnapshot: latestContext } : {}),
				...(durationMs !== undefined ? { durationMs } : {}),
			});
		}
		publish("metrics", metrics());
		activeInvocation = undefined;
	});

	pi.on("agent_settled", () => finishSessionTurn());

	pi.on("tool_execution_start", (event: { toolCallId: string; toolName: string; args?: unknown }) => {
		const sessionTurn = currentSessionTurn();
		const start = Date.now();
		toolStarts.set(event.toolCallId, {
			start,
			...(activeInvocation ? { invocationId: activeInvocation.id } : {}),
			sessionTurnId: sessionTurn.id,
		});
		sessionTurn.tools.push({ id: event.toolCallId, name: event.toolName, startedAt: start });
		tools += 1;
		publish("tool.started", {
			id: event.toolCallId,
			name: event.toolName,
			...(event.args !== undefined ? { args: event.args } : {}),
			...(activeInvocation ? { turnId: activeInvocation.id } : {}),
			sessionTurnId: sessionTurn.id,
		});
		publish("metrics", metrics());
	});

	pi.on(
		"tool_execution_end",
		(event: { toolCallId: string; toolName: string; isError: boolean; result?: unknown }) => {
			const began = toolStarts.get(event.toolCallId);
			toolStarts.delete(event.toolCallId);
			const endedAt = Date.now();
			const durationMs = began ? endedAt - began.start : 0;
			const sessionTurn =
				activeSessionTurn?.id === began?.sessionTurnId ? activeSessionTurn : undefined;
			const tool = sessionTurn?.tools.find((item) => item.id === event.toolCallId);
			if (tool && began) {
				tool.endedAt = endedAt;
				tool.durationMs = endedAt - began.start;
				tool.isError = event.isError;
			}
			if (event.isError && sessionTurn) sessionTurn.errorCount += 1;
			publish("tool.completed", {
				id: event.toolCallId,
				name: event.toolName,
				isError: event.isError,
				durationMs,
				durationKnown: Boolean(began),
				...(event.result !== undefined ? { result: event.result } : {}),
				...(began?.invocationId ? { turnId: began.invocationId } : {}),
				...(began?.sessionTurnId ? { sessionTurnId: began.sessionTurnId } : {}),
			});
		},
	);

	pi.on("session_shutdown", async () => {
		if (activeSessionTurn) finishSessionTurn("interrupted");
		publish("session.ended", { endedAt: Date.now() });
		const current = server;
		server = undefined;
		starting = undefined;
		if (current) await current.close();
	});

	pi.registerCommand("underglass", {
		description: "Open Pi Under Glass (add 'debug' for sample data)",
		handler: async (args, context) => {
			try {
				const current = await ensureServer(context);
				const debug = args.trim() === "debug";
				const url = debug ? `${current.url}&debug=1` : current.url;
				context.ui.notify(`Pi Under Glass${debug ? " sample data" : ""}: ${url}`, "info");
				if (context.mode === "tui") {
					const browser = browserCommand(url);
					const result = await pi.exec(browser.command, browser.args);
					if (result.code !== 0) {
						context.ui.notify("Could not open a browser; use the URL shown above.", "warning");
					}
				}
			} catch (error) {
				context.ui.notify(`Pi Under Glass could not start: ${errorText(error)}`, "error");
			}
		},
	});
}

function messageText(message: Message): string {
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text ?? "")
		.join("");
}

function modelIdentity(model: PiModel): ModelIdentity {
	return { provider: model.provider, id: model.id, name: model.name };
}

function messageThinking(message: Message): string {
	if (typeof message.content === "string") return "";
	return message.content
		.filter((part) => part.type === "thinking")
		.map((part) => part.thinking ?? "")
		.join("");
}

function configuredPort(): number {
	const raw = process.env.PI_UNDER_GLASS_PORT;
	if (!raw) return 0;
	const port = Number(raw);
	return Number.isInteger(port) && port >= 0 && port <= 65_535 ? port : 0;
}

function browserCommand(url: string): { command: string; args: string[] } {
	if (process.platform === "darwin") return { command: "open", args: [url] };
	if (process.platform === "win32") return { command: "cmd", args: ["/c", "start", "", url] };
	return { command: "xdg-open", args: [url] };
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function textExcerpt(text: string, limit: number): string {
	const compact = text.replace(/\s+/g, " ").trim();
	return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}
