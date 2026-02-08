/**
 * Heartbeat — dual-timer system for the tau-daemon.
 *
 * Two internal timers:
 * 1. Status ping (5s) — broadcasts daemon.heartbeat notification for client
 *    liveness detection (DaemonClient considers daemon dead if stale >15s).
 * 2. Task tick (default 30min) — reads ~/.tau/HEARTBEAT.md and sends its
 *    content as an LLM prompt. The LLM interprets tasks, cadence, and
 *    "last run" timestamps. No structured parsing.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { DaemonServer } from "./server";
import type { AgentHost } from "./agent-host";
import { NOTIFY } from "./protocol";
import type { HeartbeatParams } from "./protocol";
import { getHeartbeatState, saveHeartbeatState } from "../stores";
import type { HeartbeatState } from "../shared/types";
import { buildMemoryContext } from "./memory-context";
import { ensureDataDir } from "./paths";

const PING_INTERVAL_MS = 5_000;

const HEARTBEAT_TEMPLATE = `# HEARTBEAT Tasks

Scheduled/recurring tasks for Tau heartbeats.
On each heartbeat tick, this file is read and sent to the LLM as a prompt.
The LLM interprets tasks, cadence, and "last run" timestamps.

## Time-Based Triggers

- [ ] Run soul-update (evolve mode) nightly — last run: never
- [ ] Run memory-decay weekly — last run: never
- [ ] Add your recurring tasks here

---

**Note:** This file is read on every heartbeat tick (default: every 30 minutes).
Keep it concise. If this file is empty (only headers), heartbeats will still run
but no scheduled tasks will be executed.
`;

/**
 * Ensure ~/.tau/HEARTBEAT.md exists. Creates from template if missing.
 */
export async function ensureHeartbeatFile(): Promise<string> {
  const dir = await ensureDataDir();
  const filePath = path.join(dir, "HEARTBEAT.md");
  try {
    await fs.access(filePath);
  } catch {
    await fs.writeFile(filePath, HEARTBEAT_TEMPLATE, "utf-8");
    console.log("[heartbeat] Created HEARTBEAT.md from template");
  }
  return filePath;
}

export class Heartbeat {
  private pingTimer: NodeJS.Timeout | null = null;
  private taskTimer: NodeJS.Timeout | null = null;
  private startedAt = Date.now();
  private state: HeartbeatState = {
    enabled: true,
    intervalMs: 30 * 60 * 1000,
    lastCheckAt: null,
    nextCheckAt: null,
    checkCount: 0,
  };

  constructor(
    private host: AgentHost,
    private server: DaemonServer,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    // Load persisted state
    try {
      this.state = await getHeartbeatState();
    } catch {
      // Use defaults
    }

    // Start the 5s liveness ping
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => this.ping(), PING_INTERVAL_MS);
      this.ping(); // immediate first ping
    }

    // Start the task tick timer
    this.scheduleNextTick();
  }

  stop(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.taskTimer) {
      clearTimeout(this.taskTimer);
      this.taskTimer = null;
    }
  }

  getStatus(): HeartbeatState {
    return { ...this.state };
  }

  async setInterval(ms: number): Promise<void> {
    this.state.intervalMs = Math.max(60_000, ms); // minimum 1 minute
    await this.persistState();
    // Reschedule
    if (this.taskTimer) {
      clearTimeout(this.taskTimer);
      this.taskTimer = null;
    }
    this.scheduleNextTick();
  }

  async setEnabled(enabled: boolean): Promise<void> {
    this.state.enabled = enabled;
    await this.persistState();
    if (!enabled && this.taskTimer) {
      clearTimeout(this.taskTimer);
      this.taskTimer = null;
      this.state.nextCheckAt = null;
    } else if (enabled && !this.taskTimer) {
      this.scheduleNextTick();
    }
  }

  // ── Internal: liveness ping (5s) ───────────────────────────────────

  private ping(): void {
    const params: HeartbeatParams = {
      pid: process.pid,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      cwd: this.host.getCwd(),
      isStreaming: this.host.getIsStreaming(),
      activeSubagents: this.host.getActiveSubagentCount(),
      clientCount: this.server.getClientCount(),
      memoryUsageMB: Math.round(process.memoryUsage.rss() / 1024 / 1024),
      seq: this.server.getSeq(),
    };
    this.server.broadcast(NOTIFY.HEARTBEAT, params);
  }

  // ── Internal: task tick (30min default) ────────────────────────────

  private scheduleNextTick(): void {
    if (!this.state.enabled) return;

    const now = Date.now();
    this.state.nextCheckAt = now + this.state.intervalMs;

    this.taskTimer = setTimeout(async () => {
      this.taskTimer = null;
      await this.tick();
      this.scheduleNextTick();
    }, this.state.intervalMs);
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    this.state.lastCheckAt = now;
    this.state.checkCount++;

    try {
      // Read HEARTBEAT.md
      const dir = await ensureDataDir();
      const heartbeatPath = path.join(dir, "HEARTBEAT.md");
      let content: string;
      try {
        content = await fs.readFile(heartbeatPath, "utf-8");
      } catch {
        console.log("[heartbeat] No HEARTBEAT.md found, skipping tick");
        await this.persistState();
        return;
      }

      // Check if there's actual task content (not just headers/blanks)
      const lines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#") && !l.startsWith("---") && !l.startsWith("**"));
      if (lines.length === 0) {
        console.log("[heartbeat] HEARTBEAT.md has no task content, skipping execution");
        await this.persistState();
        return;
      }

      // Build prompt with memory context + HEARTBEAT.md content
      const agent = this.host.getAgentManager();
      if (!agent) {
        console.log("[heartbeat] Agent not ready, skipping tick");
        await this.persistState();
        return;
      }

      const cwd = this.host.getCwd() || process.cwd();
      let memoryContext = "";
      try {
        memoryContext = await buildMemoryContext(cwd);
      } catch {
        // proceed without memory context
      }

      const prompt = [
        memoryContext ? `[CONTEXT]\n${memoryContext}\n[/CONTEXT]\n` : "",
        "You are running a HEARTBEAT check. The current time is: " + new Date().toISOString(),
        "",
        "Below is your HEARTBEAT.md task list. Review each task, check if it's due based on",
        "its cadence and last run timestamp. Execute any due tasks. After executing, update",
        "the 'last run' timestamp in HEARTBEAT.md.",
        "",
        "---",
        content,
        "---",
      ].filter(Boolean).join("\n");

      // Execute silently so heartbeat tasks don't spam the UI
      console.log(`[heartbeat] Tick #${this.state.checkCount} — executing HEARTBEAT.md tasks`);
      try {
        agent.setSilent(true);
        await agent.prompt(prompt);
      } finally {
        agent.setSilent(false);
      }
    } catch (err) {
      console.error("[heartbeat] Tick failed:", err);
    }

    await this.persistState();
  }

  private async persistState(): Promise<void> {
    try {
      await saveHeartbeatState(this.state);
    } catch (err) {
      console.error("[heartbeat] Failed to persist state:", err);
    }
  }
}
