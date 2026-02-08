/**
 * AgentHost — owns all manager instances inside the daemon process.
 *
 * Replaces the global variables + setupAgentManager() pattern from main.ts.
 * Events are forwarded by broadcasting JSON-RPC notifications to all clients
 * via the DaemonServer.
 */
import type { DaemonServer } from "./server";
import { NOTIFY } from "./protocol";
import { loadTasks, saveTasks } from "../task-store";
import { GalCoordinator } from "./gal-coordinator";

export class AgentHost {
  private server: DaemonServer;
  private agentManager: any = null;
  private gitManager: any = null;
  private galCoordinator: GalCoordinator | null = null;
  private _cwd: string | null = null;

  /**
   * Ready gate — resolves once setupAgent() completes (success or failure).
   * RPC handlers that need the agent should `await host.ready` first.
   */
  private _readyResolve!: () => void;
  private _ready: Promise<void>;
  private _isReady = false;

  constructor(server: DaemonServer) {
    this.server = server;
    this._ready = new Promise<void>((resolve) => {
      this._readyResolve = resolve;
    });
  }

  /** Resolves when the agent has been initialized (or initialization failed). */
  get ready(): Promise<void> {
    return this._ready;
  }

  /** True if setupAgent has completed at least once. */
  get isReady(): boolean {
    return this._isReady;
  }

  // ── Status accessors ───────────────────────────────────────────────

  getCwd(): string | null {
    return this._cwd;
  }

  getIsStreaming(): boolean {
    try {
      return this.agentManager?.getStatus()?.isStreaming ?? false;
    } catch {
      return false;
    }
  }

  getActiveSubagentCount(): number {
    try {
      return this.agentManager?.subagentManager?.listAll()?.length ?? 0;
    } catch {
      return 0;
    }
  }

  // ── Manager accessors ──────────────────────────────────────────────

  getAgentManager(): any {
    return this.agentManager;
  }

  getGitManager(): any {
    return this.gitManager;
  }

  getGalCoordinator(): GalCoordinator | null {
    return this.galCoordinator;
  }

  // ── Agent lifecycle ────────────────────────────────────────────────

  async setupAgent(cwd: string): Promise<void> {
    try {
      const { AgentManager } = await import("../agent-manager");
      if (this.agentManager) this.agentManager.dispose();

      this._cwd = cwd;
      this.agentManager = new AgentManager(
        cwd,
        // onEvent: broadcast agent events to all clients
        (event: any) => this.server.broadcast(NOTIFY.AGENT_EVENT, event),
        // onSubagentEvent: broadcast + auto-complete tasks + GAL cleanup + close
        (evt: any) => {
          this.server.broadcast(NOTIFY.SUBAGENT_EVENT, evt);
          if (evt?.event?.type === "agent_end" && evt?.subagentId) {
            const sid = evt.subagentId;
            // Complete task first (reads history), then cleanup GAL locks, then close the subagent
            this.completeTaskForSubagent(sid)
              .catch(() => {})
              .finally(() => {
                this.galCoordinator?.onWorkerComplete(sid);
                // Remove the finished subagent from SubagentManager so it doesn't
                // count against the spawn limit.
                try {
                  this.agentManager?.subagentManager?.close(sid);
                } catch {
                  // Already closed or disposed — safe to ignore
                }
              });
          }
          // Task moved to refinement by subagent — broadcast updated tasks
          if (evt?.event?.type === "task_refinement" && evt?.event?.data?.tasks) {
            this.server.broadcast(NOTIFY.TASKS_CHANGED, evt.event.data.tasks);
          }
        },
        // onBusMessage: broadcast as subagent event
        (msg: any) =>
          this.server.broadcast(NOTIFY.SUBAGENT_EVENT, {
            subagentId: "__bus__",
            event: { type: "bus_message", data: msg },
          }),
      );
      await this.agentManager.initialize();
      await this.setupGitManager(cwd);
      this.setupGalCoordinator();
      console.log("[daemon] Agent ready");
    } catch (err) {
      console.error("[daemon] Failed to initialize agent:", err);
      this.server.broadcast(NOTIFY.AGENT_EVENT, {
        type: "error",
        data: { message: `Failed to initialize: ${err}` },
      });
    } finally {
      // Always resolve the ready gate — even on failure — so callers don't hang forever.
      this._isReady = true;
      this._readyResolve();
    }
  }

  private setupGalCoordinator(): void {
    const sm = this.agentManager?.subagentManager;
    if (!sm || !this._cwd) return;

    if (this.galCoordinator) this.galCoordinator.dispose();

    this.galCoordinator = new GalCoordinator({
      subagentManager: sm,
      cwd: this._cwd,
      onEvent: (event) => {
        this.server.broadcast(NOTIFY.GAL_EVENT, event);
      },
      onEscalate: (message) => {
        // Forward escalation as an agent event for the UI
        this.server.broadcast(NOTIFY.AGENT_EVENT, {
          type: "gal_escalation",
          data: { message },
        });
      },
    });

    console.log("[daemon] GAL coordinator initialized");
  }

  private async setupGitManager(cwd: string): Promise<void> {
    const { GitManager } = await import("../git-manager");
    if (this.gitManager) this.gitManager.dispose();
    this.gitManager = new GitManager(cwd, () => {
      this.server.broadcast(NOTIFY.GIT_CHANGED, null);
    });
    this.gitManager.startWatching();
  }

  // ── Task-Subagent completion bridge ────────────────────────────────

  private async completeTaskForSubagent(subagentId: string): Promise<void> {
    try {
      const cwd = this._cwd ?? process.cwd();
      const tasks = await loadTasks(cwd);
      let changed = false;

      const sm = this.agentManager?.subagentManager;
      let result = "";
      if (sm) {
        try {
          const history = sm.getHistory(subagentId);
          const lastAssistant = [...history].reverse().find((m: any) => m.role === "assistant");
          if (lastAssistant?.content) {
            const content = lastAssistant.content.trim();
            result = content.length > 500 ? content.slice(0, 497) + "..." : content;
          }
        } catch {
          console.warn(`[daemon] Could not retrieve history for subagent ${subagentId}`);
        }
      }

      for (const task of tasks) {
        if (task.subagentId === subagentId && task.status !== "done") {
          task.status = "done";
          task.done = true;
          if (result) task.result = result;
          changed = true;
          console.log(`[daemon] Task "${task.text.slice(0, 40)}" completed by subagent ${subagentId}`);
        }
      }

      if (changed) {
        await saveTasks(cwd, tasks);
        this.server.broadcast(NOTIFY.TASKS_CHANGED, tasks);
      }
    } catch (err) {
      console.error("[daemon] Failed to complete task for subagent:", err);
    }
  }

  // ── Dispose ────────────────────────────────────────────────────────

  dispose(): void {
    this.galCoordinator?.dispose();
    this.galCoordinator = null;
    this.agentManager?.subagentManager?.disposeAll();
    this.agentManager?.dispose();
    this.agentManager = null;
    this.gitManager?.dispose();
    this.gitManager = null;
    this._cwd = null;
  }
}
