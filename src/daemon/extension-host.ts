/**
 * ExtensionHost — sandboxed runtime extension system for the tau daemon.
 *
 * Loads .js files from ~/.tau/extensions/ and runs each in an isolated
 * Worker thread. Extensions communicate with the daemon exclusively via
 * structured message passing — no direct access to daemon internals.
 *
 * Each worker is resource-limited and can be terminated if unresponsive.
 */
import { Worker } from "node:worker_threads";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";

// ── Types ────────────────────────────────────────────────────────────

export interface ExtensionToolDef {
  name: string;
  description: string;
  parameters: Record<string, any>;
}

export interface ExtensionRegistration {
  tools: ExtensionToolDef[];
  events: string[];
}

export interface ExtensionInfo {
  id: string;
  file: string;
  status: "running" | "errored" | "stopped";
  registration: ExtensionRegistration | null;
  error?: string;
}

/** Message from daemon → worker */
export type DaemonToWorkerMsg =
  | { type: "init"; extensionId: string }
  | { type: "tool_call"; id: string; name: string; params: any }
  | { type: "event"; event: string; data: any }
  | { type: "shutdown" };

/** Message from worker → daemon */
export type WorkerToDaemonMsg =
  | { type: "register"; tools: ExtensionToolDef[]; events: string[] }
  | { type: "tool_result"; id: string; result: any; error?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  | { type: "create_memory"; memoryType: string; title: string; content: string; tags?: string[] }
  | { type: "bash"; id: string; command: string; timeout?: number };

const EXTENSIONS_DIR = "extensions";
const WORKER_TIMEOUT_MS = 30_000; // 30s for tool calls
const WORKER_INIT_TIMEOUT_MS = 5_000;
const RESOURCE_LIMITS = {
  maxOldGenerationSizeMb: 64,
  maxYoungGenerationSizeMb: 16,
  codeRangeSizeMb: 16,
};

interface ManagedWorker {
  worker: Worker;
  info: ExtensionInfo;
  pendingCalls: Map<string, {
    resolve: (result: any) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  }>;
}

export class ExtensionHost {
  private workers = new Map<string, ManagedWorker>();
  private dirWatcher: fs.FSWatcher | null = null;
  private extensionsDir: string = "";

  /** Callback for memory creation requests from extensions */
  onCreateMemory: ((memoryType: string, title: string, content: string, tags?: string[]) => Promise<void>) | null = null;

  /** Callback for bash execution requests from extensions */
  onBashRequest: ((command: string, timeout?: number) => Promise<string>) | null = null;

  // ── Public API ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    const tauDir = path.join(os.homedir(), ".tau");
    this.extensionsDir = path.join(tauDir, EXTENSIONS_DIR);

    try {
      await fsp.mkdir(this.extensionsDir, { recursive: true });
    } catch {
      // exists
    }

    await this.loadAllExtensions();
    this.watchDirectory();
    console.log(`[ext-host] Started — watching ${this.extensionsDir}`);
  }

  stop(): void {
    if (this.dirWatcher) {
      this.dirWatcher.close();
      this.dirWatcher = null;
    }
    for (const [id, managed] of this.workers) {
      this.terminateWorker(managed);
      this.workers.delete(id);
    }
    console.log("[ext-host] Stopped");
  }

  /** Reload all extensions (stop existing, load fresh). */
  async reload(): Promise<void> {
    console.log("[ext-host] Reloading all extensions");
    for (const [id, managed] of this.workers) {
      this.terminateWorker(managed);
      this.workers.delete(id);
    }
    await this.loadAllExtensions();
  }

  /** List all loaded extensions. */
  list(): ExtensionInfo[] {
    return Array.from(this.workers.values()).map((m) => ({ ...m.info }));
  }

  /** Get all registered tools across all extensions. */
  getTools(): (ExtensionToolDef & { extensionId: string })[] {
    const tools: (ExtensionToolDef & { extensionId: string })[] = [];
    for (const [id, managed] of this.workers) {
      if (managed.info.registration) {
        for (const tool of managed.info.registration.tools) {
          tools.push({ ...tool, extensionId: id });
        }
      }
    }
    return tools;
  }

  /** Call a tool registered by an extension. Returns the result. */
  async callTool(toolName: string, params: any): Promise<any> {
    // Find which extension owns this tool
    for (const [_id, managed] of this.workers) {
      const reg = managed.info.registration;
      if (reg && reg.tools.some((t) => t.name === toolName)) {
        return this.sendToolCall(managed, toolName, params);
      }
    }
    throw new Error(`No extension provides tool "${toolName}"`);
  }

  /** Broadcast an event to all extensions that subscribed to it. */
  broadcastEvent(event: string, data: any): void {
    for (const [_id, managed] of this.workers) {
      const reg = managed.info.registration;
      if (reg && reg.events.includes(event)) {
        try {
          managed.worker.postMessage({ type: "event", event, data } satisfies DaemonToWorkerMsg);
        } catch {
          // Worker may have died
        }
      }
    }
  }

  // ── Internal: loading ──────────────────────────────────────────────

  private async loadAllExtensions(): Promise<void> {
    let files: string[];
    try {
      files = await fsp.readdir(this.extensionsDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".js")) continue;
      await this.loadExtension(file);
    }
  }

  private async loadExtension(file: string): Promise<void> {
    const id = file.replace(/\.js$/, "");
    const filePath = path.join(this.extensionsDir, file);

    // Stop existing if reloading
    const existing = this.workers.get(id);
    if (existing) {
      this.terminateWorker(existing);
      this.workers.delete(id);
    }

    const info: ExtensionInfo = {
      id,
      file,
      status: "running",
      registration: null,
    };

    try {
      const worker = new Worker(filePath, {
        resourceLimits: RESOURCE_LIMITS,
        workerData: { extensionId: id },
        // Set NODE_PATH so extensions can resolve npm packages from ~/.tau/extensions/node_modules
        env: {
          ...process.env,
          NODE_PATH: path.join(this.extensionsDir, "node_modules"),
        },
      });

      const managed: ManagedWorker = { worker, info, pendingCalls: new Map() };
      this.workers.set(id, managed);

      // Wait for registration
      const regPromise = new Promise<ExtensionRegistration>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error("Extension init timeout"));
        }, WORKER_INIT_TIMEOUT_MS);

        const handler = (msg: WorkerToDaemonMsg) => {
          if (msg.type === "register") {
            clearTimeout(timer);
            worker.off("message", handler);
            resolve({ tools: msg.tools || [], events: msg.events || [] });
          }
        };
        worker.on("message", handler);
      });

      // Set up message handler
      worker.on("message", (msg: WorkerToDaemonMsg) => {
        this.handleWorkerMessage(managed, msg);
      });

      worker.on("error", (err) => {
        console.error(`[ext-host] Worker ${id} error:`, err.message);
        info.status = "errored";
        info.error = err.message;
      });

      worker.on("exit", (code) => {
        if (info.status === "running") {
          console.warn(`[ext-host] Worker ${id} exited unexpectedly (code ${code})`);
          info.status = "stopped";
        }
        // Reject all pending calls
        for (const [callId, pending] of managed.pendingCalls) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Extension ${id} exited`));
        }
        managed.pendingCalls.clear();
      });

      // Send init
      worker.postMessage({ type: "init", extensionId: id } satisfies DaemonToWorkerMsg);

      // Await registration
      info.registration = await regPromise;
      console.log(
        `[ext-host] Loaded ${id}: ${info.registration.tools.length} tool(s), ${info.registration.events.length} event subscription(s)`,
      );
    } catch (err: any) {
      console.error(`[ext-host] Failed to load ${file}:`, err.message);
      info.status = "errored";
      info.error = err.message;
    }
  }

  // ── Internal: message handling ─────────────────────────────────────

  private handleWorkerMessage(managed: ManagedWorker, msg: WorkerToDaemonMsg): void {
    switch (msg.type) {
      case "tool_result": {
        const pending = managed.pendingCalls.get(msg.id);
        if (pending) {
          clearTimeout(pending.timer);
          managed.pendingCalls.delete(msg.id);
          if (msg.error) {
            pending.reject(new Error(msg.error));
          } else {
            pending.resolve(msg.result);
          }
        }
        break;
      }

      case "log": {
        const prefix = `[ext:${managed.info.id}]`;
        if (msg.level === "error") console.error(prefix, msg.message);
        else if (msg.level === "warn") console.warn(prefix, msg.message);
        else console.log(prefix, msg.message);
        break;
      }

      case "create_memory": {
        if (this.onCreateMemory) {
          this.onCreateMemory(msg.memoryType, msg.title, msg.content, msg.tags).catch((err) => {
            console.error(`[ext-host] Memory creation failed for ${managed.info.id}:`, err);
          });
        }
        break;
      }

      case "bash": {
        if (this.onBashRequest) {
          this.onBashRequest(msg.command, msg.timeout)
            .then((result) => {
              try {
                managed.worker.postMessage({
                  type: "tool_result",
                  id: msg.id,
                  result,
                } as any);
              } catch {
                // worker dead
              }
            })
            .catch((err) => {
              try {
                managed.worker.postMessage({
                  type: "tool_result",
                  id: msg.id,
                  result: null,
                  error: err.message,
                } as any);
              } catch {
                // worker dead
              }
            });
        }
        break;
      }

      case "register":
        // Already handled during init — ignore duplicates
        break;
    }
  }

  // ── Internal: tool calls ───────────────────────────────────────────

  private sendToolCall(managed: ManagedWorker, name: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = `call_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const timer = setTimeout(() => {
        managed.pendingCalls.delete(id);
        reject(new Error(`Tool call "${name}" timed out (${WORKER_TIMEOUT_MS}ms)`));
      }, WORKER_TIMEOUT_MS);

      managed.pendingCalls.set(id, { resolve, reject, timer });

      try {
        managed.worker.postMessage({ type: "tool_call", id, name, params } satisfies DaemonToWorkerMsg);
      } catch (err: any) {
        clearTimeout(timer);
        managed.pendingCalls.delete(id);
        reject(err);
      }
    });
  }

  // ── Internal: worker lifecycle ─────────────────────────────────────

  private terminateWorker(managed: ManagedWorker): void {
    managed.info.status = "stopped";
    try {
      managed.worker.postMessage({ type: "shutdown" } satisfies DaemonToWorkerMsg);
    } catch {
      // already dead
    }
    // Give it 1s to clean up, then force terminate
    setTimeout(() => {
      managed.worker.terminate().catch(() => {});
    }, 1000);
  }

  // ── Internal: directory watching ───────────────────────────────────

  private watchDirectory(): void {
    try {
      this.dirWatcher = fs.watch(this.extensionsDir, { persistent: false }, (_event, filename) => {
        if (filename && filename.endsWith(".js")) {
          // Debounce: small delay for file writes to complete
          setTimeout(() => {
            this.loadExtension(filename).catch((err) => {
              console.error(`[ext-host] Hot-reload failed for ${filename}:`, err);
            });
          }, 500);
        }
      });
      this.dirWatcher.on("error", () => {
        // Directory removed? Stop watching.
        if (this.dirWatcher) {
          this.dirWatcher.close();
          this.dirWatcher = null;
        }
      });
    } catch {
      // Can't watch — extensions still loaded, just no hot reload
    }
  }
}
