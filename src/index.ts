import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";

import {
	createEvent,
	PROTOCOL_VERSION,
	type ContextSnapshot,
	type EventDataMap,
	type Metrics,
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
	model?: { contextWindow?: number };
}

interface ActiveRun {
	id: string;
	usage: UsageAccumulator;
}

interface ActiveTurn {
	id: string;
	runId: string;
	run: ActiveRun;
	messageId: string | undefined;
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
	const toolStarts = new Map<string, number>();
	let cwd = process.cwd();
	let sequence = 0;
	let messageSequence = 0;
	let runSequence = 0;
	let turnSequence = 0;
	let tools = 0;
	let latestContext: ContextSnapshot | undefined;
	let activeRun: ActiveRun | undefined;
	let activeTurn: ActiveTurn | undefined;
	let activeAssistantId: string | undefined;
	let server: ViewerServer | undefined;
	let starting: Promise<ViewerServer> | undefined;

	const publish = <K extends keyof EventDataMap>(type: K, data: EventDataMap[K]) => {
		server?.publish(createEvent(sessionId, ++sequence, type, data));
	};

	const metrics = (): Metrics => ({
		modelRequests: sessionUsage.requests,
		usage: usageRollup(sessionUsage),
		tools,
		...(latestContext ? { latestContext } : {}),
	});

	const finishRun = () => {
		if (!activeRun) return;
		if (activeRun.usage.requests > 0) {
			publish("run.completed", {
				id: activeRun.id,
				modelRequests: activeRun.usage.requests,
				usage: usageRollup(activeRun.usage),
			});
		}
		activeRun = undefined;
	};

	const beginRun = (): ActiveRun => {
		finishRun();
		activeRun = { id: `run-${++runSequence}`, usage: createUsageAccumulator() };
		return activeRun;
	};

	const currentRun = (): ActiveRun => activeRun ?? beginRun();

	const ensureServer = async (context: PiContext): Promise<ViewerServer> => {
		cwd = context.cwd;
		if (server) return server;
		if (!starting) {
			starting = startViewerServer({
				token,
				port: configuredPort(),
				hello: () => ({
					v: PROTOCOL_VERSION,
					type: "hello",
					sessionId,
					startedAt,
					cwd,
					metrics: metrics(),
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
		try {
			await ensureServer(context);
			publish("session.started", { cwd });
		} catch (error) {
			context.ui.notify(`Pi Under Glass could not start: ${errorText(error)}`, "error");
		}
	});

	pi.on("message_start", (event: { message: Message }) => {
		if (event.message.role === "user") {
			beginRun();
			publish("message.completed", {
				id: `message-${++messageSequence}`,
				role: "user",
				text: messageText(event.message),
			});
		} else if (event.message.role === "assistant") {
			activeAssistantId = `message-${++messageSequence}`;
			if (activeTurn) activeTurn.messageId = activeAssistantId;
			publish("message.started", { id: activeAssistantId, role: "assistant" });
		}
	});

	pi.on("turn_start", () => {
		const run = currentRun();
		activeTurn = { id: `turn-${++turnSequence}`, runId: run.id, run, messageId: undefined };
	});

	pi.on("message_update", (event: { assistantMessageEvent?: { type: string; delta?: string } }) => {
		const update = event.assistantMessageEvent;
		if (!activeAssistantId || !update?.delta) return;
		if (update.type === "text_delta") {
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
		});
		activeAssistantId = undefined;
	});

	pi.on("turn_end", (event: { message: Message }, context) => {
		let turn = activeTurn;
		if (!turn) {
			const fallbackRun = currentRun();
			turn = {
				id: `turn-${++turnSequence}`,
				runId: fallbackRun.id,
				run: fallbackRun,
				messageId: undefined,
			};
		}
		const usage = providerUsage(event.message.usage);
		addUsage(turn.run.usage, usage);
		addUsage(sessionUsage, usage);

		latestContext = undefined;
		if (usage.inputTokens !== undefined) {
			const contextWindow = context.model?.contextWindow;
			latestContext = {
				inputTokens: usage.inputTokens,
				...(typeof contextWindow === "number" && contextWindow > 0 ? { contextWindow } : {}),
			};
		}

		if (Object.keys(usage).length > 0) {
			publish("turn.usage", {
				id: turn.id,
				runId: turn.runId,
				usage,
				...(turn.messageId ? { messageId: turn.messageId } : {}),
				...(latestContext ? { contextSnapshot: latestContext } : {}),
			});
		}
		publish("metrics", metrics());
		activeTurn = undefined;
	});

	pi.on("agent_settled", () => finishRun());

	pi.on("tool_execution_start", (event: { toolCallId: string; toolName: string; args?: unknown }) => {
		toolStarts.set(event.toolCallId, Date.now());
		tools += 1;
		publish("tool.started", {
			id: event.toolCallId,
			name: event.toolName,
			...(event.args !== undefined ? { args: event.args } : {}),
		});
		publish("metrics", metrics());
	});

	pi.on(
		"tool_execution_end",
		(event: { toolCallId: string; toolName: string; isError: boolean; result?: unknown }) => {
			const beganAt = toolStarts.get(event.toolCallId) ?? Date.now();
			toolStarts.delete(event.toolCallId);
			publish("tool.completed", {
				id: event.toolCallId,
				name: event.toolName,
				isError: event.isError,
				durationMs: Date.now() - beganAt,
				...(event.result !== undefined ? { result: event.result } : {}),
			});
		},
	);

	pi.on("session_shutdown", async () => {
		finishRun();
		const current = server;
		server = undefined;
		starting = undefined;
		if (current) await current.close();
	});

	pi.registerCommand("underglass", {
		description: "Open the local Pi Under Glass viewer",
		handler: async (_args, context) => {
			try {
				const current = await ensureServer(context);
				context.ui.notify(`Pi Under Glass: ${current.url}`, "info");
				if (context.mode === "tui") {
					const { command, args } = browserCommand(current.url);
					const result = await pi.exec(command, args);
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
