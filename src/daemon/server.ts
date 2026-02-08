/**
 * WebSocket JSON-RPC 2.0 server for the tau-daemon.
 *
 * Listens on a Unix domain socket (or Windows named pipe).
 * Routes RPC requests to handler functions.
 * Broadcasts notifications to all connected clients.
 */
import { WebSocketServer, WebSocket } from "ws";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
} from "./protocol";
import { RPC_ERRORS } from "./protocol";

export type RpcHandler = (params: any) => Promise<any> | any;

interface ConnectedClient {
  id: string;
  ws: WebSocket;
  connectedAt: number;
}

export class DaemonServer {
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ConnectedClient>();
  private handlers = new Map<string, RpcHandler>();
  private seq = 0;
  private socketPath: string;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /** Register an RPC method handler. */
  handle(method: string, handler: RpcHandler): void {
    this.handlers.set(method, handler);
  }

  /** Register multiple handlers from an object. */
  handleAll(handlers: Record<string, RpcHandler>): void {
    for (const [method, handler] of Object.entries(handlers)) {
      this.handlers.set(method, handler);
    }
  }

  /** Start listening on the Unix socket. */
  async start(): Promise<void> {
    // Clean up stale socket file
    await fs.unlink(this.socketPath).catch(() => {});

    // Create a raw HTTP server on the Unix socket
    const http = await import("node:http");
    const httpServer = http.createServer();

    this.wss = new WebSocketServer({ server: httpServer });

    this.wss.on("connection", (ws) => {
      const clientId = crypto.randomUUID();
      const client: ConnectedClient = {
        id: clientId,
        ws,
        connectedAt: Date.now(),
      };
      this.clients.set(clientId, client);
      console.log(`[daemon] Client connected: ${clientId} (total: ${this.clients.size})`);

      // Send client its ID
      this.sendToClient(ws, {
        jsonrpc: "2.0",
        method: "daemon.connected",
        params: { clientId },
      });

      // WebSocket ping/pong for transport-level heartbeat
      const pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping();
        }
      }, 10_000);

      ws.on("message", async (data) => {
        let raw: string;
        try {
          raw = data.toString("utf-8");
        } catch {
          return;
        }
        await this.handleMessage(ws, raw);
      });

      ws.on("close", () => {
        clearInterval(pingInterval);
        this.clients.delete(clientId);
        console.log(`[daemon] Client disconnected: ${clientId} (total: ${this.clients.size})`);
      });

      ws.on("error", (err) => {
        console.error(`[daemon] WebSocket error for ${clientId}:`, err.message);
      });
    });

    await new Promise<void>((resolve, reject) => {
      httpServer.on("error", reject);
      httpServer.listen(this.socketPath, () => {
        // Set socket permissions (owner only) on Unix
        if (process.platform !== "win32") {
          fs.chmod(this.socketPath, 0o600).catch(() => {});
        }
        resolve();
      });
    });

    console.log(`[daemon] Server listening on ${this.socketPath}`);
  }

  /** Broadcast a notification to all connected clients. */
  broadcast(method: string, params?: any): void {
    this.seq++;
    // Wrap params so we don't corrupt arrays with spread.
    // Arrays (e.g. tasks list) are placed under `data`, while objects
    // get the _seq merged in directly.
    const notification: JsonRpcNotification = {
      jsonrpc: "2.0",
      method,
      params: Array.isArray(params)
        ? { data: params, _seq: this.seq }
        : { ...(params ?? {}), _seq: this.seq },
    };
    const msg = JSON.stringify(notification);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(msg);
      }
    }
  }

  /** Get the current monotonic sequence number. */
  getSeq(): number {
    return this.seq;
  }

  /** Get the number of connected clients. */
  getClientCount(): number {
    return this.clients.size;
  }

  /** Gracefully shut down the server. */
  async stop(): Promise<void> {
    // Notify clients
    this.broadcast("daemon.shutdown", { reason: "shutdown" });

    // Close all client connections
    for (const client of this.clients.values()) {
      client.ws.close(1001, "Server shutting down");
    }
    this.clients.clear();

    // Close WebSocket server
    if (this.wss) {
      await new Promise<void>((resolve) => {
        this.wss!.close(() => resolve());
      });
      this.wss = null;
    }

    // Remove socket file
    await fs.unlink(this.socketPath).catch(() => {});
    console.log("[daemon] Server stopped");
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async handleMessage(ws: WebSocket, raw: string): Promise<void> {
    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.sendToClient(ws, {
        jsonrpc: "2.0",
        id: null as any,
        error: { code: RPC_ERRORS.PARSE_ERROR, message: "Parse error" },
      });
      return;
    }

    // Validate JSON-RPC structure
    if (!parsed || parsed.jsonrpc !== "2.0" || !parsed.method) {
      if (parsed?.id != null) {
        this.sendToClient(ws, {
          jsonrpc: "2.0",
          id: parsed.id,
          error: { code: RPC_ERRORS.INVALID_REQUEST, message: "Invalid Request" },
        });
      }
      return;
    }

    // Notification (no id) — fire and forget
    if (parsed.id == null) {
      const handler = this.handlers.get(parsed.method);
      if (handler) {
        handler(parsed.params).catch((err: any) => {
          console.error(`[daemon] Notification handler error for ${parsed.method}:`, err);
        });
      }
      return;
    }

    // Request (has id) — send response
    const request = parsed as JsonRpcRequest;
    const handler = this.handlers.get(request.method);

    if (!handler) {
      this.sendToClient(ws, {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: RPC_ERRORS.METHOD_NOT_FOUND,
          message: `Method not found: ${request.method}`,
        },
      });
      return;
    }

    try {
      const result = await handler(request.params);
      this.sendToClient(ws, {
        jsonrpc: "2.0",
        id: request.id,
        result: result ?? null,
      });
    } catch (err: any) {
      this.sendToClient(ws, {
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: RPC_ERRORS.INTERNAL_ERROR,
          message: err?.message || String(err),
          data: err?.stack,
        },
      });
    }
  }

  private sendToClient(ws: WebSocket, msg: JsonRpcResponse | JsonRpcNotification): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }
}
