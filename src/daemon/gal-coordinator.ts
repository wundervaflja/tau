/**
 * GalCoordinator — GAL (Global Agent Lock) orchestrator.
 *
 * Sits on top of SubagentManager as a coordination layer that:
 *   1. Spawns worker agents with file-lock tools injected
 *   2. Maintains a FileLockTable for file-level mutual exclusion
 *   3. Handles lock events (contention, timeout, deadlock) deterministically
 *   4. Optionally runs a GAL LLM session for conflict reasoning
 *
 * Phase 2: All coordination is programmatic (no LLM roundtrip for routine ops).
 * Phase 3: GAL LLM session started for conflict resolution and batch planning.
 */
import { FileLockTable } from "./file-lock-table";
import {
  buildWorkerLockTools,
  buildGalTools,
  WORKER_LOCK_PREAMBLE,
  type GalToolDeps,
} from "./gal-tools";
import type {
  GalWorkerInfo,
  GalLockInfo,
  GalStatus,
  LockEvent,
} from "../shared/gal-types";
import type { Task } from "../shared/task-types";

/** System prompt for the GAL LLM agent. */
const GAL_SYSTEM_PROMPT = `You are GAL (Global Agent Lock), the task coordinator for tau.

Role: Spawn worker agents, manage file locks, resolve conflicts.

You are notified about events:
- NEW_TASKS: Tasks ready for workers. Spawn workers for each.
- LOCK_CONTENTION: A worker wants a file held by another. Decide: wait, ask holder to hurry, or revoke.
- LOCK_TIMEOUT: A lock was auto-revoked after timeout. Inform affected worker.
- DEADLOCK: Circular lock dependency detected. Break one lock to resolve.
- WORKER_COMPLETE: A worker finished. Clean up its locks.

Guidelines:
- Be efficient. You are a coordinator, not a conversationalist.
- Spawn workers promptly when tasks arrive.
- Let the lock table handle routine grant/release — only intervene on conflicts.
- When revoking a lock, message the holder with a clear warning.
- If unsure, escalate to the user.`;

interface GalCoordinatorConfig {
  /** SubagentManager instance for spawning workers. */
  subagentManager: any;
  /** Working directory. */
  cwd: string;
  /** Lock timeout in ms (default 60_000). */
  lockTimeoutMs?: number;
  /** Callback to broadcast GAL events. */
  onEvent?: (event: { type: string; data: any }) => void;
  /** Callback for escalations to user. */
  onEscalate?: (message: string) => void;
}

export class GalCoordinator {
  private sm: any;
  private cwd: string;
  private lockTable: FileLockTable;
  private workers = new Map<string, GalWorkerInfo>();
  private contentionCount = 0;
  private galSession: any = null;
  private onEvent: ((event: { type: string; data: any }) => void) | null;
  private onEscalate: ((message: string) => void) | null;

  /**
   * Mutex for spawnWithLockTools — prevents concurrent calls from
   * corrupting the monkey-patched buildToolsForAgent method (fix #2).
   */
  private _spawnLock: Promise<void> = Promise.resolve();

  constructor(config: GalCoordinatorConfig) {
    this.sm = config.subagentManager;
    this.cwd = config.cwd;
    this.onEvent = config.onEvent ?? null;
    this.onEscalate = config.onEscalate ?? null;

    this.lockTable = new FileLockTable({
      timeoutMs: config.lockTimeoutMs,
    });

    // Wire lock events to our handler
    this.lockTable.onEvent = (event: LockEvent) => {
      this.handleLockEvent(event);
    };
  }

  // ── Public API (called by handlers.ts / task-watcher.ts) ──────────

  /**
   * Submit tasks for GAL-coordinated execution.
   * Spawns workers with file-lock tools injected.
   * Replaces direct sm.spawn() calls.
   */
  async submitTasks(
    tasks: Task[],
    memoryContext?: string,
    spawnModel?: string,
    spawnThinking?: string,
  ): Promise<void> {
    if (tasks.length === 0) return;

    console.log(
      `[GAL] Submitting ${tasks.length} task(s) for coordinated execution`,
    );

    // If GAL LLM session is active, delegate planning to it
    if (this.galSession) {
      await this.notifyGal(
        "NEW_TASKS",
        `${tasks.length} new task(s) to coordinate:\n` +
          tasks.map((t, i) => `${i + 1}. ${t.text}`).join("\n") +
          (memoryContext ? `\n\nContext:\n${memoryContext}` : ""),
      );
      return;
    }

    // Phase 2: Programmatic — spawn workers directly with lock tools
    for (const task of tasks) {
      try {
        await this.spawnWorkerForTask(task, memoryContext, spawnModel, spawnThinking);
      } catch (err) {
        console.error(
          `[GAL] Failed to spawn worker for "${task.text.slice(0, 40)}":`,
          err,
        );
      }
    }
  }

  /**
   * Called when a worker agent completes (agent_end event).
   * Cleans up locks and worker tracking.
   */
  onWorkerComplete(subagentId: string): void {
    const worker = this.workers.get(subagentId);
    if (!worker) return;

    console.log(
      `[GAL] Worker "${worker.name}" (${subagentId}) completed — cleaning up locks`,
    );

    // Release all locks held by this worker
    const released = this.lockTable.releaseAllForAgent(subagentId);
    if (released.length > 0) {
      console.log(
        `[GAL] Released ${released.length} lock(s) for completed worker: ${released.join(", ")}`,
      );
    }

    this.workers.delete(subagentId);

    // Notify GAL LLM if active
    if (this.galSession) {
      this.notifyGal(
        "WORKER_COMPLETE",
        `Worker "${worker.name}" (${subagentId}) completed. Released ${released.length} lock(s).`,
      ).catch(() => {});
    }
  }

  // ── GAL LLM session (Phase 3) ────────────────────────────────────

  /**
   * Start GAL's own LLM session for conflict reasoning.
   * Call this after SubagentManager is initialized.
   */
  async startGalSession(): Promise<void> {
    if (this.galSession) return;

    console.log("[GAL] Starting GAL LLM session...");

    try {
      const galTools = buildGalTools(this.buildGalToolDeps());

      // Fix #1: Pass tools in the spawn config so the GAL LLM can actually use them
      const results = await this.sm.spawn([
        {
          name: "GAL-Coordinator",
          task: GAL_SYSTEM_PROMPT +
            "\n\nYou have been started. Acknowledge and wait for events.",
          persistent: true,
          tools: galTools,
        },
      ]);

      if (results.length > 0) {
        this.galSession = results[0];
        console.log(`[GAL] GAL LLM session started: ${this.galSession.id}`);
      }
    } catch (err) {
      console.error("[GAL] Failed to start GAL session:", err);
      // Fall back to programmatic coordination
      this.galSession = null;
    }
  }

  /**
   * Send a notification to GAL's LLM session.
   */
  private async notifyGal(eventType: string, detail: string): Promise<void> {
    if (!this.galSession) return;

    try {
      const prompt = `[${eventType}]\n${detail}`;
      // Use the steer/prompt approach — send as a new message
      const session = this.sm.getSession?.(this.galSession.id);
      if (session) {
        await session.prompt(prompt);
      }
    } catch (err) {
      console.error(`[GAL] Failed to notify GAL LLM (${eventType}):`, err);
    }
  }

  // ── Status / snapshot ─────────────────────────────────────────────

  /** Get current GAL status summary. */
  getStatus(): GalStatus {
    return {
      active: true,
      workerCount: this.workers.size,
      lockCount: this.lockTable.size,
      contentionCount: this.contentionCount,
    };
  }

  /** Get all current locks. */
  getLocks(): GalLockInfo[] {
    return this.lockTable.getAllLocks().map((lock) => ({
      path: lock.path,
      holderId: lock.holderId,
      holderName: lock.holderName,
      grantedAt: lock.grantedAt,
      queueLength: this.lockTable.getWaiters(lock.path).length,
    }));
  }

  /** Get all worker info. */
  getWorkers(): GalWorkerInfo[] {
    return [...this.workers.values()].map((w) => ({
      ...w,
      locksHeld: this.lockTable.getLocksForAgent(w.id),
    }));
  }

  // ── Cleanup ───────────────────────────────────────────────────────

  dispose(): void {
    console.log("[GAL] Disposing coordinator...");
    this.lockTable.dispose();
    this.workers.clear();
    this.galSession = null;
  }

  // ── Internal ──────────────────────────────────────────────────────

  /**
   * Spawn a single worker for a task, with lock tools injected.
   */
  private async spawnWorkerForTask(
    task: Task,
    memoryContext?: string,
    spawnModel?: string,
    spawnThinking?: string,
  ): Promise<{ id: string; name: string } | null> {
    const name = task.text.slice(0, 40);

    // Build the task prompt with lock preamble
    let prompt = WORKER_LOCK_PREAMBLE + "\n\n";
    if (memoryContext) {
      prompt += `[CONTEXT]\n${memoryContext}\n[/CONTEXT]\n\n`;
    }
    prompt += task.text;

    // We need to spawn via SM but with our custom lock tools added.
    // SM.spawn() uses buildToolsForAgent internally, so we use a
    // wrapper that pre-injects our lock tools.
    const config: any = { name, task: prompt, canSpawn: false };
    if (spawnModel) config.model = spawnModel;
    if (spawnThinking) config.thinkingLevel = spawnThinking;

    const results = await this.spawnWithLockTools([config]);

    if (results.length > 0) {
      const info = results[0];
      this.workers.set(info.id, {
        id: info.id,
        name: info.name,
        taskId: task.id,
        taskText: task.text,
        locksHeld: [],
        isStreaming: true,
        spawnedAt: Date.now(),
      });

      // Wire up task tracking
      task.subagentId = info.id;
      task.status = "in-progress";
      task.done = false;

      console.log(
        `[GAL] Spawned worker "${info.name}" (${info.id}) for task "${task.text.slice(0, 40)}"`,
      );

      return info;
    }

    return null;
  }

  /**
   * Spawn agents via SubagentManager with lock tools injected.
   *
   * We temporarily augment SM's buildToolsForAgent to include our lock tools,
   * then restore it after spawn. A mutex serializes concurrent calls to
   * prevent the monkey-patch from being corrupted (fix #2).
   */
  private async spawnWithLockTools(
    configs: Array<{ name: string; task: string; model?: string; thinkingLevel?: string }>,
  ): Promise<Array<{ id: string; name: string }>> {
    // Acquire the spawn mutex — serialize to prevent monkey-patch races
    let releaseMutex: () => void;
    const acquired = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });
    const prev = this._spawnLock;
    this._spawnLock = acquired;
    await prev;

    const sm = this.sm;
    const lockTable = this.lockTable;

    // Save original tool builder
    const originalBuildTools = sm.buildToolsForAgent.bind(sm);

    // Augment with lock tools
    sm.buildToolsForAgent = (agentId: string, agentName: string): any[] => {
      const baseTools = originalBuildTools(agentId, agentName);
      const lockTools = buildWorkerLockTools(lockTable, agentId, agentName);
      return [...baseTools, ...lockTools];
    };

    try {
      const results = await sm.spawn(configs);
      return results.map((r: any) => ({ id: r.id, name: r.name }));
    } finally {
      // Restore original
      sm.buildToolsForAgent = originalBuildTools;
      releaseMutex!();
    }
  }

  /**
   * Handle lock events from FileLockTable.
   * Phase 2: programmatic responses.
   * Phase 3: forward to GAL LLM for reasoning.
   */
  private handleLockEvent(event: LockEvent): void {
    switch (event.type) {
      case "contention":
        this.contentionCount++;
        console.log(
          `[GAL] Lock contention: "${event.requesterName}" wants ${event.path}, held by "${event.holderName}"`,
        );
        this.onEvent?.({
          type: "gal.contention",
          data: {
            path: event.path,
            holder: event.holderId,
            requester: event.requesterId,
          },
        });

        // Notify GAL LLM if active
        if (this.galSession) {
          this.notifyGal(
            "LOCK_CONTENTION",
            `"${event.requesterName}" (${event.requesterId}) wants ${event.path}, ` +
              `held by "${event.holderName}" (${event.holderId}).`,
          ).catch(() => {});
        }
        break;

      case "timeout":
        console.warn(
          `[GAL] Lock timeout: "${event.holderName}" timed out on ${event.path}`,
        );
        this.onEvent?.({
          type: "gal.timeout",
          data: {
            path: event.path,
            holder: event.holderId,
          },
        });

        // Warn the holder
        this.warnWorker(
          event.holderId,
          `⚠️ Your lock on ${event.path} has timed out and been revoked. ` +
            `If you still need the file, re-claim the lock.`,
        );

        if (this.galSession) {
          this.notifyGal(
            "LOCK_TIMEOUT",
            `Lock on ${event.path} held by "${event.holderName}" (${event.holderId}) timed out.`,
          ).catch(() => {});
        }
        break;

      case "deadlock":
        console.error(
          `[GAL] Deadlock detected! Cycle: ${event.cycle.join(" → ")}`,
        );
        this.onEvent?.({
          type: "gal.deadlock",
          data: { cycle: event.cycle },
        });

        if (this.galSession) {
          this.notifyGal(
            "DEADLOCK",
            `Deadlock detected: ${event.cycle.join(" → ")}. Break one lock to resolve.`,
          ).catch(() => {});
        } else {
          // Phase 2: auto-break the last lock in the cycle
          this.autoBreakDeadlock(event.cycle);
        }
        break;

      case "released":
        // Routine — no action needed beyond logging
        if (event.nextWaiterId) {
          console.log(
            `[GAL] Lock on ${event.path} released → auto-granted to "${event.nextWaiterName}"`,
          );
        }
        break;

      case "queue_granted":
        // Fix #3: Notify the worker that it was auto-granted the lock
        console.log(
          `[GAL] Lock on ${event.path} auto-granted to queued worker "${event.agentName}" (${event.agentId})`,
        );
        this.warnWorker(
          event.agentId,
          `🔓 You have been granted the lock on ${event.path}. You can now proceed with your edit. ` +
            `Remember to call release_file_lock when done.`,
        );
        break;
    }
  }

  /**
   * Phase 2 deadlock resolution: revoke the last agent's lock in the cycle.
   */
  private autoBreakDeadlock(cycle: string[]): void {
    if (cycle.length === 0) return;

    // Break the last agent's locks — this is a simple heuristic.
    // The GAL LLM (Phase 3) can make smarter decisions.
    const victimId = cycle[cycle.length - 1];
    const locks = this.lockTable.getLocksForAgent(victimId);
    if (locks.length === 0) return;

    const path = locks[0]; // Revoke first lock
    const result = this.lockTable.revoke(path);
    if (result.revoked) {
      console.warn(
        `[GAL] Auto-broke deadlock by revoking ${path} from ${victimId}`,
      );
      this.warnWorker(
        victimId,
        `⚠️ Your lock on ${path} was revoked to break a deadlock. Re-claim when ready.`,
      );
    }
  }

  /**
   * Send a warning message to a worker via the message bus.
   */
  private warnWorker(workerId: string, message: string): void {
    try {
      this.sm.bus?.send?.({
        fromId: "GAL",
        fromName: "GAL Coordinator",
        toId: workerId,
        content: message,
        timestamp: Date.now(),
      });
    } catch {
      // Worker may be dead — that's fine
    }
  }

  /**
   * Build the dependency object for GAL tools (Phase 3).
   */
  private buildGalToolDeps(): GalToolDeps {
    return {
      lockTable: this.lockTable,
      spawnWorkers: async (configs) => {
        return this.spawnWithLockTools(configs);
      },
      messageWorker: async (workerId, message) => {
        this.warnWorker(workerId, message);
      },
      getWorkers: () => this.getWorkers(),
      escalate: (message) => {
        console.warn(`[GAL] Escalation: ${message}`);
        this.onEscalate?.(message);
        this.onEvent?.({
          type: "gal.escalation",
          data: { message },
        });
      },
    };
  }
}
