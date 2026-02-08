/**
 * TaskWatcher — watches tasks.md for external edits and broadcasts changes.
 *
 * Uses `fs.watch` with a 500ms debounce.  When the file changes on disk
 * (e.g. the user or another tool edits it) we reload, detect todo→in-progress
 * transitions, auto-spawn subagents, and broadcast the new task list.
 */
import fs from "node:fs";
import path from "node:path";
import type { DaemonServer } from "./server";
import type { AgentHost } from "./agent-host";
import { NOTIFY } from "./protocol";
import { loadTasks, saveTasks } from "../task-store";
import type { Task } from "../shared/task-types";
import { buildMemoryContext } from "./memory-context";

const DEBOUNCE_MS = 500;
const TASK_FILE = "tasks.md";

export class TaskWatcher {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private cwd: string;
  private server: DaemonServer;
  private host: AgentHost;
  private lastKnownStatus = new Map<string, string>();

  constructor(cwd: string, server: DaemonServer, host: AgentHost) {
    this.cwd = cwd;
    this.server = server;
    this.host = host;
  }

  /** Start watching. Safe to call multiple times (restarts). */
  start(): void {
    this.stop();
    const filePath = path.join(this.cwd, TASK_FILE);

    try {
      this.watcher = fs.watch(filePath, { persistent: false }, () => {
        this.scheduleReload();
      });

      this.watcher.on("error", () => {
        // File may not exist yet — that's fine, we'll try again on next start
        this.stop();
      });
    } catch {
      // File doesn't exist — watch the directory instead so we can
      // start watching the file once it appears.
      this.watchDirectory();
    }
  }

  /** Watch the cwd directory for the creation of tasks.md. */
  private watchDirectory(): void {
    try {
      this.watcher = fs.watch(this.cwd, { persistent: false }, (_event, filename) => {
        if (filename === TASK_FILE) {
          // tasks.md was created — switch to watching the file itself
          console.log("[daemon] TaskWatcher: tasks.md appeared — starting file watch");
          this.start();
        }
      });
      this.watcher.on("error", () => this.stop());
    } catch {
      // Directory doesn't exist — nothing we can do
    }
  }

  /** Stop watching. */
  stop(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  /** Update the cwd and restart the watcher. */
  setCwd(cwd: string): void {
    this.cwd = cwd;
    this.lastKnownStatus.clear();
    this.start();
  }

  /** Seed the status map from existing tasks (call after initial load). */
  seedStatus(tasks: Task[]): void {
    this.lastKnownStatus.clear();
    for (const t of tasks) {
      this.lastKnownStatus.set(t.id, t.status);
    }
  }

  // ── Internal ──────────────────────────────────────────────────────

  private scheduleReload(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.reload().catch((err) => {
        console.error("[daemon] TaskWatcher reload error:", err);
      });
    }, DEBOUNCE_MS);
  }

  private async reload(): Promise<void> {
    const tasks = await loadTasks(this.cwd);

    // Clear orphaned subagentIds — tasks assigned to subagents from a previous
    // daemon session that no longer exist.
    const sm = this.host.getAgentManager()?.subagentManager;
    for (const t of tasks) {
      if (t.subagentId && t.status !== "done") {
        const alive = sm ? sm.listAll().some((s: any) => s.id === t.subagentId) : false;
        if (!alive) {
          console.log(`[daemon] TaskWatcher: clearing orphaned subagentId "${t.subagentId}" from "${t.text.slice(0, 40)}"`);
          delete t.subagentId;
          // Reset status tracking so the task is treated as a fresh todo transition
          this.lastKnownStatus.delete(t.id);
        }
      }
    }

    // Detect tasks newly moved to "todo" without a subagent
    const newTodoTasks = tasks.filter(
      (t) =>
        t.status === "todo" &&
        !t.subagentId &&
        this.lastKnownStatus.get(t.id) !== "todo",
    );

    // Update tracking
    for (const t of tasks) this.lastKnownStatus.set(t.id, t.status);

    if (newTodoTasks.length > 0 && sm) {
      console.log(
        `[daemon] TaskWatcher: ${newTodoTasks.length} task(s) moved to todo — spawning subagents`,
      );

      let memoryContext = "";
      try {
        memoryContext = await buildMemoryContext(this.cwd);
      } catch {
        /* proceed without context */
      }

      // Use the currently active model/thinking for subagent spawns
      const agent = this.host.getAgentManager();
      const agentStatus = agent?.getStatus();
      const spawnModel = agentStatus?.model as string | undefined;
      const spawnThinking = agentStatus?.thinkingLevel as string | undefined;

      // Delegate to GAL coordinator if available, otherwise direct spawn
      const gal = this.host.getGalCoordinator();
      if (gal) {
        console.log("[daemon] TaskWatcher: Delegating to GAL coordinator");
        try {
          await gal.submitTasks(newTodoTasks, memoryContext, spawnModel, spawnThinking);
          for (const task of newTodoTasks) {
            this.lastKnownStatus.set(task.id, task.status);
          }
        } catch (err) {
          console.error("[daemon] TaskWatcher: GAL submission failed, falling back:", err);
          await this.directSpawnTasks(sm, newTodoTasks, memoryContext, spawnModel, spawnThinking);
        }
      } else {
        await this.directSpawnTasks(sm, newTodoTasks, memoryContext, spawnModel, spawnThinking);
      }

      // Save the updated tasks (with subagentId + in-progress)
      await saveTasks(this.cwd, tasks);
    }

    // Always broadcast the current state
    this.server.broadcast(NOTIFY.TASKS_CHANGED, tasks);
  }

  /** Fallback: direct spawn without GAL coordination. */
  private async directSpawnTasks(
    sm: any,
    newTodoTasks: Task[],
    memoryContext: string,
    spawnModel?: string,
    spawnThinking?: string,
  ): Promise<void> {
    for (const task of newTodoTasks) {
      try {
        let prompt = task.text;
        if (memoryContext) {
          prompt = `[CONTEXT]\n${memoryContext}\n[/CONTEXT]\n\n${task.text}`;
        }

        const config: any = {
          name: task.text.slice(0, 40),
          task: prompt,
          canSpawn: false,
        };
        if (spawnModel) config.model = spawnModel;
        if (spawnThinking) config.thinkingLevel = spawnThinking;

        const results = await sm.spawn([config]);

        if (results.length > 0) {
          task.subagentId = results[0].id;
          task.status = "in-progress";
          task.done = false;
          this.lastKnownStatus.set(task.id, "in-progress");
        }
      } catch (err) {
        console.error(
          `[daemon] TaskWatcher: Failed to spawn for "${task.text}":`,
          err,
        );
      }
    }
  }
}
