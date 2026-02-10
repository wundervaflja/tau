/**
 * DaemonClient — Electron main-process connection manager for the tau-daemon.
 *
 * Responsibilities:
 * - Discover or spawn the daemon process
 * - Connect via WebSocket (Unix domain socket)
 * - Send JSON-RPC requests and await responses
 * - Subscribe to daemon notifications and forward to renderer
 * - Auto-reconnect with exponential backoff
 * - Monitor heartbeat for daemon health
 */
import { WebSocket } from "ws";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, openSync, readFileSync, readdirSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  getDaemonDir,
  getPidFilePath,
  getSocketPath,
  ensureDaemonDir,
} from "./daemon/paths";
import {
  ipcToRpc,
  notifyToIpc,
  isRequestChannel,
  PUSH_CHANNELS,
} from "./daemon/protocol";
import type {
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  PidFileContent,
} from "./daemon/protocol";

type NotificationHandler = (params: any) => void;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

const REQUEST_TIMEOUT_MS = 30_000;
const HEARTBEAT_STALE_MS = 15_000;
const MAX_RECONNECT_RETRIES = 3;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 10_000;

export class DaemonClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number | string, PendingRequest>();
  private notificationHandlers = new Map<string, NotificationHandler[]>();
  private lastHeartbeat = 0;
  private heartbeatCheckTimer: NodeJS.Timeout | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private _connected = false;
  private _onDisconnect: (() => void) | null = null;

  /** True if we have an active WebSocket connection. */
  get connected(): boolean {
    return this._connected;
  }

  /** Set a callback for when the connection is lost. */
  set onDisconnect(handler: (() => void) | null) {
    this._onDisconnect = handler;
  }

  // ── Connection lifecycle ──────────────────────────────────────────

  /**
   * Ensure the daemon is running and connect to it.
   * If the daemon isn't running, spawns it first.
   */
  async ensureRunning(): Promise<void> {
    // Try connecting to existing daemon
    const connected = await this.tryConnect();
    if (connected) return;

    // No daemon running — spawn one
    await this.spawnDaemon();

    // Wait for socket to become available (up to 10s)
    const socketPath = getSocketPath();
    for (let i = 0; i < 20; i++) {
      await sleep(500);
      try {
        await fs.access(socketPath);
        const ok = await this.tryConnect();
        if (ok) return;
      } catch {
        // Socket not ready yet
      }
    }

    throw new Error("Daemon failed to start within 10 seconds");
  }

  /** Try to connect to an existing daemon. Returns true if successful. */
  private async tryConnect(): Promise<boolean> {
    const pidFile = await this.readPidFile();
    if (!pidFile) return false;

    // Verify process is alive
    if (!isProcessAlive(pidFile.pid)) {
      // Stale PID file — clean up
      await fs.unlink(getPidFilePath()).catch(() => {});
      return false;
    }

    try {
      await this.connect(pidFile.socketPath);
      return true;
    } catch {
      return false;
    }
  }

  /** Connect to daemon at the given socket path. */
  private connect(socketPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url =
        process.platform === "win32"
          ? `ws+unix:${socketPath}`
          : `ws+unix://${socketPath}`;

      const ws = new WebSocket(url);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error("Connection timeout"));
      }, 5_000);

      ws.on("open", () => {
        clearTimeout(timeout);
        this.ws = ws;
        this._connected = true;
        this.reconnectAttempt = 0;
        this.lastHeartbeat = Date.now();
        this.startHeartbeatCheck();
        console.log("[daemon-client] Connected to daemon");
        resolve();
      });

      ws.on("message", (data: Buffer) => {
        this.handleMessage(data.toString("utf-8"));
      });

      ws.on("close", () => {
        clearTimeout(timeout);
        this.handleDisconnect();
      });

      ws.on("error", (err) => {
        clearTimeout(timeout);
        if (!this._connected) {
          reject(err);
        }
      });
    });
  }

  /** Spawn the daemon as a detached child process. */
  private async spawnDaemon(): Promise<void> {
    await ensureDaemonDir();
    const socketPath = getSocketPath();

    // Find the daemon entry point.
    // IMPORTANT: process.execPath inside Electron is the Electron binary,
    // NOT system node.  We must resolve system node explicitly.
    const projectRoot = path.resolve(__dirname, "..");
    const devEntryPoint = path.join(projectRoot, "src", "daemon", "index.ts");
    // In Electron, process.resourcesPath is always set (even in dev), so we
    // detect dev mode by checking whether the daemon source file exists.
    const isDev = existsSync(devEntryPoint);

    let command: string;
    let args: string[];

    if (isDev) {
      // In dev: use npx to run tsx (guaranteed to find the project-local tsx)
      command = process.platform === "win32" ? "npx.cmd" : "npx";
      args = [
        "tsx",
        path.join(projectRoot, "src", "daemon", "index.ts"),
        "--socket-path", socketPath,
      ];
    } else {
      // In production: the daemon is bundled as ESM in extraResources/daemon-pkg/
      // We must find the real system `node` binary because:
      //  - process.execPath is the Electron binary, not Node
      //  - ELECTRON_RUN_AS_NODE=1 is ignored in code-signed macOS apps
      //  - macOS .app bundles have a minimal PATH that excludes typical node locations
      command = resolveNodeBinary();
      const daemonScript = path.join(process.resourcesPath!, "daemon-pkg", "index.mjs");
      args = [
        daemonScript,
        "--socket-path", socketPath,
      ];
    }

    console.log(`[daemon-client] Spawning daemon: ${command} ${args.join(" ")}`);

    // Log daemon stdout/stderr to a file for debugging instead of discarding
    const logPath = path.join(getDaemonDir(), "tau-daemon.log");
    const logFd = openSync(logPath, "a");

    // Default working directory: ~/tau (created if missing).
    // In a packaged .app, process.cwd() is "/" which is useless.
    const tauHome = path.join(os.homedir(), "tau");
    await fs.mkdir(tauHome, { recursive: true });

    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      cwd: tauHome,
      env: { ...process.env },
    });

    child.unref();
    console.log(`[daemon-client] Daemon spawned (pid: ${child.pid}), log: ${logPath}`);
  }

  /** Disconnect from the daemon (daemon keeps running). */
  disconnect(): void {
    this.stopHeartbeatCheck();
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
    }

    this._connected = false;

    // Reject all pending requests
    for (const [id, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("Client disconnected"));
    }
    this.pending.clear();
  }

  // ── RPC calls ─────────────────────────────────────────────────────

  /**
   * Send a JSON-RPC request and await the response.
   *
   * @param method  RPC method name (e.g. "agent.prompt")
   * @param params  Method parameters (positional array or named object)
   */
  call(method: string, params?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        reject(new Error("Not connected to daemon"));
        return;
      }

      const id = this.nextId++;
      const request: JsonRpcRequest = {
        jsonrpc: "2.0",
        id,
        method,
        params,
      };

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify(request));
    });
  }

  /**
   * Proxy an IPC channel call to the daemon.
   *
   * Translates the Electron IPC channel name to its RPC method name
   * and forwards the arguments.
   */
  async callIpc(channel: string, ...args: any[]): Promise<any> {
    const method = ipcToRpc(channel);
    if (!method) {
      throw new Error(`No RPC method for IPC channel: ${channel}`);
    }
    // Always pass args as an array so daemon handlers can index positionally.
    // Passing a bare string would cause params[0] to return the first character.
    return this.call(method, args.length > 0 ? args : undefined);
  }

  // ── Notification subscriptions ────────────────────────────────────

  /** Subscribe to a daemon notification method. */
  onNotification(method: string, handler: NotificationHandler): () => void {
    let handlers = this.notificationHandlers.get(method);
    if (!handlers) {
      handlers = [];
      this.notificationHandlers.set(method, handlers);
    }
    handlers.push(handler);

    // Return unsubscribe function
    return () => {
      const list = this.notificationHandlers.get(method);
      if (list) {
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      }
    };
  }

  // ── Message handling ──────────────────────────────────────────────

  private handleMessage(raw: string): void {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!msg || msg.jsonrpc !== "2.0") return;

    // Response to a request
    if (msg.id != null && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id);
      if (pending) {
        this.pending.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || "RPC error"));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Notification (no id)
    if (msg.method) {
      // Track heartbeat
      if (msg.method === "daemon.heartbeat") {
        this.lastHeartbeat = Date.now();
      }

      const handlers = this.notificationHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.params);
          } catch (err) {
            console.error(`[daemon-client] Notification handler error for ${msg.method}:`, err);
          }
        }
      }
    }
  }

  // ── Heartbeat monitoring ──────────────────────────────────────────

  private startHeartbeatCheck(): void {
    this.stopHeartbeatCheck();
    this.heartbeatCheckTimer = setInterval(() => {
      if (Date.now() - this.lastHeartbeat > HEARTBEAT_STALE_MS) {
        console.warn("[daemon-client] Heartbeat stale — daemon may be dead");
        this.handleDisconnect();
      }
    }, HEARTBEAT_STALE_MS);
  }

  private stopHeartbeatCheck(): void {
    if (this.heartbeatCheckTimer) {
      clearInterval(this.heartbeatCheckTimer);
      this.heartbeatCheckTimer = null;
    }
  }

  // ── Reconnection ──────────────────────────────────────────────────

  private handleDisconnect(): void {
    if (!this._connected) return;
    this._connected = false;
    this.ws = null;
    this.stopHeartbeatCheck();

    console.warn("[daemon-client] Disconnected from daemon");

    // Reject all pending requests
    for (const [, req] of this.pending) {
      clearTimeout(req.timer);
      req.reject(new Error("Connection lost"));
    }
    this.pending.clear();

    this._onDisconnect?.();

    // Start reconnection
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempt >= MAX_RECONNECT_RETRIES) {
      console.error("[daemon-client] Max reconnect attempts reached — respawning daemon");
      this.reconnectAttempt = 0;
      this.ensureRunning().catch((err) => {
        console.error("[daemon-client] Failed to respawn daemon:", err);
      });
      return;
    }

    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempt),
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt++;

    console.log(
      `[daemon-client] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempt}/${MAX_RECONNECT_RETRIES})`,
    );

    this.reconnectTimer = setTimeout(async () => {
      try {
        const ok = await this.tryConnect();
        if (!ok) {
          this.scheduleReconnect();
        }
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────

  private async readPidFile(): Promise<PidFileContent | null> {
    try {
      const raw = await fs.readFile(getPidFilePath(), "utf-8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
}

// ── Utility ──────────────────────────────────────────────────────────────

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Find a system `node` binary (≥ v18) that supports ESM.
 *
 * Inside a packaged macOS .app the PATH is minimal and doesn't include
 * typical Node install locations.  We check version-manager paths first
 * (nvm, fnm, volta) since they're most likely to have a recent Node,
 * then fall back to well-known system paths and login-shell resolution.
 *
 * Every candidate is validated with `node --version` to ensure it's ≥ v18.
 */
function resolveNodeBinary(): string {
  const home = process.env.HOME || "";
  const MIN_MAJOR = 18;

  // Candidates ordered: version managers first (most likely modern), then system paths
  const candidates: string[] = [];

  // 1. nvm paths (highest priority — user explicitly manages versions here)
  if (home) {
    try {
      const nvmDir = path.join(home, ".nvm", "versions", "node");
      if (existsSync(nvmDir)) {
        // nvm default alias
        const defaultAlias = path.join(home, ".nvm", "alias", "default");
        if (existsSync(defaultAlias)) {
          try {
            const ver = readFileSync(defaultAlias, "utf-8").trim();
            const versionedPath = ver.startsWith("v")
              ? path.join(nvmDir, ver, "bin", "node")
              : path.join(nvmDir, `v${ver}`, "bin", "node");
            candidates.push(versionedPath);
          } catch { /* ignore */ }
        }
        // Scan installed nvm versions (newest first)
        try {
          const versions = readdirSync(nvmDir)
            .filter((d: string) => d.startsWith("v"))
            .sort()
            .reverse();
          for (const v of versions) {
            candidates.push(path.join(nvmDir, v, "bin", "node"));
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    // fnm / volta
    candidates.push(path.join(home, ".fnm", "current", "bin", "node"));
    candidates.push(path.join(home, ".volta", "bin", "node"));
  }

  // 2. System paths (may have old versions — validated below)
  candidates.push("/opt/homebrew/bin/node");  // macOS Apple Silicon (Homebrew)
  candidates.push("/usr/local/bin/node");     // macOS Intel (Homebrew / installer)
  candidates.push("/usr/bin/node");           // Linux / system install

  // Check each candidate: must exist AND be a modern enough version
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    if (isNodeVersionOk(p, MIN_MAJOR)) {
      console.log(`[daemon-client] Resolved node binary: ${p}`);
      return p;
    }
    console.log(`[daemon-client] Skipping ${p} — too old (need v${MIN_MAJOR}+)`);
  }

  // 3. Fallback: resolve from the user's login shell
  const shells = [
    process.env.SHELL || "/bin/zsh",
    "/bin/zsh",
    "/bin/bash",
  ];
  for (const shell of [...new Set(shells)]) {
    try {
      const resolved = execFileSync(shell, ["-lc", "which node"], {
        encoding: "utf-8",
        timeout: 5_000,
      }).trim();
      if (resolved && existsSync(resolved) && isNodeVersionOk(resolved, MIN_MAJOR)) {
        console.log(`[daemon-client] Resolved node binary via ${shell}: ${resolved}`);
        return resolved;
      }
    } catch {
      // try next shell
    }
  }

  throw new Error(
    `Could not find Node.js >= v${MIN_MAJOR}. Please install a modern Node.js ` +
    "(https://nodejs.org) and ensure it is on your PATH.",
  );
}

/** Returns true if the node binary at `p` reports a major version >= `minMajor`. */
function isNodeVersionOk(p: string, minMajor: number): boolean {
  try {
    const out = execFileSync(p, ["--version"], {
      encoding: "utf-8",
      timeout: 3_000,
    }).trim(); // e.g. "v22.21.0"
    const match = out.match(/^v(\d+)/);
    if (!match) return false;
    return parseInt(match[1], 10) >= minMajor;
  } catch {
    return false;
  }
}

/**
 * Helper to create the IPC proxy wiring in Electron main process.
 *
 * For each request IPC channel, registers `ipcMain.handle` that proxies
 * to the daemon.  For daemon notifications, forwards them to the
 * BrowserWindow as IPC events.
 */
export function wireDaemonToIpc(
  client: DaemonClient,
  ipcMain: Electron.IpcMain,
  getMainWindow: () => Electron.BrowserWindow | null,
  ipcChannels: Record<string, string>,
): void {
  // Request channels → daemon RPC proxy
  for (const channel of Object.values(ipcChannels)) {
    if (!isRequestChannel(channel)) continue;

    // Skip APP_SELECT_DIR — handled by Electron natively
    if (channel === "app:select-dir") continue;
    // Skip APP_GET_THEME — handled by Electron natively
    if (channel === "app:get-theme") continue;
    // Skip APP_SET_THEME — handled by Electron natively
    if (channel === "app:set-theme") continue;

    ipcMain.handle(channel, async (_event: any, ...args: any[]) => {
      return client.callIpc(channel, ...args);
    });
  }

  // Daemon notifications → renderer IPC push
  const notificationMethods = [
    "daemon.agent.event",
    "daemon.subagent.event",
    "daemon.git.changed",
    "daemon.tasks.changed",
  ] as const;

  for (const method of notificationMethods) {
    const ipcChannel = notifyToIpc(method);
    if (!ipcChannel) continue;

    client.onNotification(method, (params) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        // Unwrap array data that was wrapped by broadcast() to avoid
        // spread-corruption.  If params has a `data` array, send that
        // instead of the wrapper object.
        const payload =
          params && Array.isArray(params.data) ? params.data : params;
        win.webContents.send(ipcChannel, payload);
      }
    });
  }
}
