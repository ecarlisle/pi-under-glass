import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

import type { GlassEvent, HelloMessage } from "./protocol.js";

const VIEWER_DIR = join(dirname(fileURLToPath(import.meta.url)), "../viewer");
const ASSETS = new Map([
	["/", { file: "index.html", contentType: "text/html; charset=utf-8" }],
	["/app.js", { file: "app.js", contentType: "text/javascript; charset=utf-8" }],
	["/state.js", { file: "state.js", contentType: "text/javascript; charset=utf-8" }],
	["/transcript.js", { file: "transcript.js", contentType: "text/javascript; charset=utf-8" }],
	["/styles.css", { file: "styles.css", contentType: "text/css; charset=utf-8" }],
]);

export interface ViewerServerOptions {
	token: string;
	port?: number;
	host?: string;
	debugFixturePath?: string;
	hello: () => HelloMessage;
}

export interface ViewerServer {
	host: string;
	port: number;
	url: string;
	publish(event: GlassEvent): void;
	close(): Promise<void>;
}

export async function startViewerServer(options: ViewerServerOptions): Promise<ViewerServer> {
	const host = options.host ?? "127.0.0.1";
	const port = options.port ?? 0;
	const sockets = new Set<WebSocket>();
	const webSockets = new WebSocketServer({ noServer: true });
	const http = createServer((request, response) => {
		void serveAsset(request, response, options.token, options.debugFixturePath);
	});

	webSockets.on("connection", (socket) => {
		sockets.add(socket);
		socket.send(JSON.stringify(options.hello()));
		socket.on("close", () => sockets.delete(socket));
	});

	http.on("upgrade", (request, socket, head) => {
		const url = requestUrl(request, host);
		if (url.pathname !== "/events" || url.searchParams.get("token") !== options.token) {
			socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
			socket.destroy();
			return;
		}
		webSockets.handleUpgrade(request, socket, head, (client) => {
			webSockets.emit("connection", client, request);
		});
	});

	await new Promise<void>((resolve, reject) => {
		const onError = (error: Error) => {
			http.off("listening", onListening);
			reject(error);
		};
		const onListening = () => {
			http.off("error", onError);
			resolve();
		};
		http.once("error", onError);
		http.once("listening", onListening);
		http.listen(port, host);
	});

	const address = http.address();
	if (!address || typeof address === "string") {
		await closeHttpServer(http);
		throw new Error("Pi Under Glass could not determine its local server address");
	}

	const actualPort = address.port;
	const url = `http://${host}:${actualPort}/?token=${encodeURIComponent(options.token)}`;

	return {
		host,
		port: actualPort,
		url,
		publish(event) {
			const payload = JSON.stringify(event);
			for (const socket of sockets) {
				if (socket.readyState === WebSocket.OPEN) socket.send(payload);
			}
		},
		async close() {
			await Promise.all(
				[...sockets].map(
					(socket) =>
						new Promise<void>((resolve) => {
							if (socket.readyState === WebSocket.CLOSED) return resolve();
							const finish = () => resolve();
							const timeout = setTimeout(() => {
								socket.terminate();
								finish();
							}, 200);
							socket.once("close", () => {
								clearTimeout(timeout);
								finish();
							});
							socket.close(1000, "Session ended");
						}),
				),
			);
			await new Promise<void>((resolve) => webSockets.close(() => resolve()));
			await closeHttpServer(http);
		},
	};
}

async function serveAsset(
	request: IncomingMessage,
	response: ServerResponse,
	token: string,
	debugFixturePath?: string,
): Promise<void> {
	const url = requestUrl(request, "127.0.0.1");
	if (url.pathname === "/debug-fixture") {
		if (!debugFixturePath) return respondNotFound(response);
		if (url.searchParams.get("token") !== token) {
			response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
			response.end("This Pi Under Glass debug link is missing its session token.");
			return;
		}
		try {
			const body = await readFile(debugFixturePath);
			response.writeHead(200, {
				"cache-control": "no-store",
				"content-type": "application/json; charset=utf-8",
				"x-content-type-options": "nosniff",
			});
			response.end(body);
		} catch {
			response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
			response.end("Debug fixture unavailable");
		}
		return;
	}
	const asset = ASSETS.get(url.pathname);
	if (!asset) return respondNotFound(response);

	if (url.pathname === "/" && url.searchParams.get("token") !== token) {
		response.writeHead(401, { "content-type": "text/plain; charset=utf-8" });
		response.end("This Pi Under Glass link is missing its session token.");
		return;
	}

	try {
		const body = await readFile(join(VIEWER_DIR, asset.file));
		response.writeHead(200, {
			"cache-control": "no-store",
			"content-security-policy":
				"default-src 'self'; connect-src 'self' ws://127.0.0.1:*; img-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
			"content-type": asset.contentType,
			"x-content-type-options": "nosniff",
		});
		response.end(body);
	} catch {
		response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
		response.end("Viewer asset unavailable");
	}
}

function respondNotFound(response: ServerResponse): void {
	response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
	response.end("Not found");
}

function requestUrl(request: IncomingMessage, host: string): URL {
	return new URL(request.url ?? "/", `http://${host}`);
}

function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}
