#!/usr/bin/env node
/**
 * tau-daemon — persistent sidecar process for tau.
 *
 * Runs independently of Electron.  Owns the agent, stores, heartbeat,
 * and task watcher.  Communicates with Electron (or any client) via
 * WebSocket JSON-RPC 2.0 over a Unix domain socket.
 *
 * Usage:
 *   node dist/daemon/index.js [--socket-path <path>]
 *
 * The daemon writes a PID file so that Electron can find it on startup.
 */
import fs from "node:fs/promises";
import { DaemonServer } from "./server";
import { AgentHost } from "./agent-host";
import { Heartbeat, ensureHeartbeatFile } from "./heartbeat";
import { TaskWatcher } from "./task-watcher";
import { JournalWatcher } from "./journal-watcher";
import { ExtensionHost } from "./extension-host";
import { buildHandlers } from "./handlers";
import {
  ensureDaemonDir,
  getPidFilePath,
  getSocketPath,
} from "./paths";
import type { PidFileContent } from "./protocol";
import { loadTasks } from "../task-store";

// ── CLI args ────────────────────────────────────────────────────────────

function parseArgs(): { socketPath: string } {
  const args = process.argv.slice(2);
  let socketPath = getSocketPath();

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--socket-path" && args[i + 1]) {
      socketPath = args[++i];
    }
  }

  return { socketPath };
}

// ── PID file management ─────────────────────────────────────────────────

async function writePidFile(socketPath: string): Promise<void> {
  await ensureDaemonDir();
  const content: PidFileContent = {
    pid: process.pid,
    socketPath,
    startedAt: Date.now(),
    version: "1.0.0",
  };
  await fs.writeFile(getPidFilePath(), JSON.stringify(content, null, 2));
}

async function removePidFile(): Promise<void> {
  try {
    await fs.unlink(getPidFilePath());
  } catch {
    /* already gone */
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { socketPath } = parseArgs();

  console.log(`[daemon] Starting tau-daemon (pid: ${process.pid})`);
  console.log(`[daemon] Socket: ${socketPath}`);

  // Start WebSocket server
  const server = new DaemonServer(socketPath);
  const host = new AgentHost(server);
  const heartbeat = new Heartbeat(host, server);
  let taskWatcher: TaskWatcher | null = null;
  let journalWatcher: JournalWatcher | null = null;
  const extensionHost = new ExtensionHost();

  // Register RPC handlers (pass heartbeat + extension host for status/config RPCs)
  const handlers = buildHandlers(host, server, heartbeat, extensionHost);
  server.handleAll(handlers);

  // Daemon-specific: shutdown RPC
  server.handle("daemon.shutdown", async () => {
    console.log("[daemon] Shutdown requested via RPC");
    await shutdown();
    return { ok: true };
  });

  await ensureDaemonDir();
  await server.start();
  await writePidFile(socketPath);

  // Ensure HEARTBEAT.md exists before starting heartbeat
  await ensureHeartbeatFile();

  // Start heartbeat (liveness ping + task tick)
  await heartbeat.start();

  // Initialize agent with cwd
  const cwd = process.cwd();
  await host.setupAgent(cwd);

  // Start task watcher — seed existing task statuses first so we don't
  // treat already-existing todo tasks as "newly moved to todo".
  taskWatcher = new TaskWatcher(cwd, server, host);
  try {
    const existingTasks = await loadTasks(cwd);
    taskWatcher.seedStatus(existingTasks);
  } catch {
    // No tasks.md yet — fine, watcher will seed when file appears
  }
  taskWatcher.start();

  // Start journal watcher — extracts memories from new journal paragraphs
  journalWatcher = new JournalWatcher(cwd, host);
  await journalWatcher.start();

  // Start extension host — sandboxed worker-thread extensions from ~/.tau/extensions/
  extensionHost.onCreateMemory = async (memoryType, title, content, tags) => {
    const agent = host.getAgentManager();
    if (agent) {
      await agent.prompt(
        `Create a memory: type=${memoryType}, title="${title}", content="${content}"${tags ? `, tags=${tags.join(",")}` : ""}. Use the create_memory tool.`,
      );
    }
  };
  extensionHost.onBashRequest = async (command, timeout) => {
    const { execSync } = await import("node:child_process");
    return execSync(command, {
      timeout: timeout ?? 30_000,
      encoding: "utf-8",
      cwd: host.getCwd() || process.cwd(),
    });
  };
  await extensionHost.start();

  console.log("[daemon] Ready — listening for connections");

  // ── Graceful shutdown ───────────────────────────────────────────────

  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log("[daemon] Shutting down...");
    extensionHost.stop();
    journalWatcher?.stop();
    taskWatcher?.stop();
    heartbeat.stop();
    host.dispose();
    await server.stop();
    await removePidFile();
    console.log("[daemon] Goodbye.");
    process.exit(0);
  }

  process.on("SIGTERM", () => shutdown());
  process.on("SIGINT", () => shutdown());
  process.on("uncaughtException", (err) => {
    console.error("[daemon] Uncaught exception:", err);
    shutdown();
  });
}

main().catch((err) => {
  console.error("[daemon] Fatal:", err);
  process.exit(1);
});
