/**
 * GAL tool builders — separated from GalCoordinator for testability.
 *
 * Two categories:
 *   1. **Worker tools** — injected into every spawned worker session.
 *      Synchronous lock operations via FileLockTable (no LLM roundtrip).
 *   2. **GAL tools** — used by GAL's own LLM session for coordination.
 */
import type { FileLockTable } from "./file-lock-table";
import type { GalWorkerInfo } from "../shared/gal-types";

// Re-export tool return type helper
type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  details?: Record<string, any>;
};

function textResult(text: string, details?: Record<string, any>): ToolResult {
  return { content: [{ type: "text" as const, text }], details };
}

// ── Worker tools (injected into each spawned worker) ─────────────────

/**
 * Build lock tools for a worker agent.
 * These give the worker the ability to claim/release/check file locks.
 */
export function buildWorkerLockTools(
  lockTable: FileLockTable,
  workerId: string,
  workerName: string,
): any[] {
  return [
    {
      name: "claim_file_lock",
      label: "Claim File Lock",
      description:
        "Claim exclusive access to a file before editing it. " +
        "If the file is free, the lock is granted immediately. " +
        "If another agent holds it, you'll be queued and should wait or work on something else. " +
        "Always release the lock after your edit is complete.",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string" as const,
            description: "Absolute path to the file you want to edit",
          },
          purpose: {
            type: "string" as const,
            description:
              "Brief description of what you plan to do (e.g. 'add error handling')",
          },
        },
        required: ["path"],
      },
      async execute(
        _toolCallId: string,
        params: { path: string; purpose?: string },
      ) {
        try {
          const result = lockTable.claim(
            workerId,
            workerName,
            params.path,
            params.purpose,
          );

          if (result.granted) {
            const note = result.alreadyHeld
              ? " (lock refreshed — you already held it)"
              : "";
            return textResult(
              `Lock granted for ${params.path}${note}. Proceed with your edit, then call release_file_lock when done.`,
              { granted: true, path: params.path },
            );
          }

          return textResult(
            `Lock DENIED for ${params.path}. Currently held by "${result.holderName}" (${result.holder}). ` +
              `You are #${result.queuePosition} in the wait queue. ` +
              `Work on something else and try again later, or wait for the lock to be released.`,
            {
              granted: false,
              holder: result.holder,
              queuePosition: result.queuePosition,
            },
          );
        } catch (err: any) {
          return textResult(`Error claiming lock: ${err.message}`);
        }
      },
    },

    {
      name: "release_file_lock",
      label: "Release File Lock",
      description:
        "Release exclusive access to a file after your edit is complete. " +
        "Always call this after finishing your edit. " +
        "If another agent is waiting for this file, they will be granted access automatically.",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string" as const,
            description: "Absolute path to the file to release",
          },
        },
        required: ["path"],
      },
      async execute(_toolCallId: string, params: { path: string }) {
        try {
          const result = lockTable.release(workerId, params.path);

          if (result.released) {
            const next = result.nextWaiter
              ? ` Next in queue: "${result.nextWaiter.name}" has been auto-granted.`
              : "";
            return textResult(
              `Lock released for ${params.path}.${next}`,
              { released: true, path: params.path },
            );
          }

          return textResult(
            `Could not release ${params.path} — you don't hold a lock on it.`,
            { released: false },
          );
        } catch (err: any) {
          return textResult(`Error releasing lock: ${err.message}`);
        }
      },
    },

    {
      name: "check_file_available",
      label: "Check File Available",
      description:
        "Check whether a file is currently available (unlocked) or held by another agent. " +
        "Use this before attempting to edit a file to avoid unnecessary contention.",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string" as const,
            description: "Absolute path to the file to check",
          },
        },
        required: ["path"],
      },
      async execute(_toolCallId: string, params: { path: string }) {
        try {
          const result = lockTable.check(params.path);

          if (result.available) {
            return textResult(
              `${params.path} is available — no one holds a lock on it.`,
              { available: true },
            );
          }

          return textResult(
            `${params.path} is LOCKED by "${result.holderName}" (${result.holder}). ` +
              `${result.queueLength} agent(s) waiting in queue.`,
            {
              available: false,
              holder: result.holder,
              queueLength: result.queueLength,
            },
          );
        } catch (err: any) {
          return textResult(`Error checking file: ${err.message}`);
        }
      },
    },
  ];
}

// ── GAL tools (used by GAL's own LLM session) ───────────────────────

export interface GalToolDeps {
  lockTable: FileLockTable;
  /** Spawn workers via SubagentManager. Returns array of { id, name }. */
  spawnWorkers: (
    configs: Array<{ name: string; task: string }>,
  ) => Promise<Array<{ id: string; name: string }>>;
  /** Send a message to a worker via the message bus. */
  messageWorker: (workerId: string, message: string) => Promise<void>;
  /** Get current worker info. */
  getWorkers: () => GalWorkerInfo[];
  /** Report an escalation to the user / main agent. */
  escalate: (message: string) => void;
}

/**
 * Build tools for GAL's own LLM session.
 * These allow GAL to spawn workers, manage locks, and coordinate.
 */
export function buildGalTools(deps: GalToolDeps): any[] {
  const { lockTable, spawnWorkers, messageWorker, getWorkers, escalate } = deps;

  return [
    {
      name: "spawn_worker",
      label: "Spawn Worker",
      description:
        "Spawn one or more worker agents to work on tasks. " +
        "Each worker will have file lock tools to coordinate edits. " +
        "Workers work independently — use message_worker to communicate with them.",
      parameters: {
        type: "object" as const,
        properties: {
          workers: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                name: {
                  type: "string" as const,
                  description: "Short descriptive name (e.g. 'Fix auth tests')",
                },
                task: {
                  type: "string" as const,
                  description: "Detailed instructions for the worker",
                },
              },
              required: ["name", "task"],
            },
            description: "Array of workers to spawn",
          },
        },
        required: ["workers"],
      },
      async execute(
        _toolCallId: string,
        params: { workers: Array<{ name: string; task: string }> },
      ) {
        try {
          const infos = await spawnWorkers(params.workers);
          const names = infos.map((i) => `"${i.name}" (${i.id})`).join(", ");
          return textResult(
            `Spawned ${infos.length} worker(s): ${names}. They are now working with file lock awareness.`,
            { workerIds: infos.map((i) => i.id) },
          );
        } catch (err: any) {
          return textResult(`Error spawning workers: ${err.message}`);
        }
      },
    },

    {
      name: "message_worker",
      label: "Message Worker",
      description:
        "Send a message to a specific worker agent. " +
        "Use this to give instructions, warnings, or request status updates.",
      parameters: {
        type: "object" as const,
        properties: {
          worker_id: {
            type: "string" as const,
            description: "ID of the worker to message",
          },
          message: {
            type: "string" as const,
            description: "Message to send to the worker",
          },
        },
        required: ["worker_id", "message"],
      },
      async execute(
        _toolCallId: string,
        params: { worker_id: string; message: string },
      ) {
        try {
          await messageWorker(params.worker_id, params.message);
          return textResult(
            `Message sent to worker ${params.worker_id}.`,
            { sent: true },
          );
        } catch (err: any) {
          return textResult(`Error messaging worker: ${err.message}`);
        }
      },
    },

    {
      name: "revoke_lock",
      label: "Revoke Lock",
      description:
        "Force-revoke a file lock. Use this to resolve contention or break deadlocks. " +
        "The holder will lose their lock. If there are waiters, the next in queue is auto-granted.",
      parameters: {
        type: "object" as const,
        properties: {
          path: {
            type: "string" as const,
            description: "Absolute path of the file to revoke the lock on",
          },
          reason: {
            type: "string" as const,
            description: "Reason for revoking (will be sent to the holder as a warning)",
          },
        },
        required: ["path"],
      },
      async execute(
        _toolCallId: string,
        params: { path: string; reason?: string },
      ) {
        try {
          const result = lockTable.revoke(params.path);

          if (!result.revoked) {
            return textResult(`No lock to revoke on ${params.path}.`);
          }

          // Warn the holder
          const reason = params.reason ?? "Lock revoked by GAL coordinator";
          if (result.holderId) {
            try {
              await messageWorker(
                result.holderId,
                `⚠️ Your lock on ${params.path} has been revoked. Reason: ${reason}. ` +
                  `If you were mid-edit, re-claim the lock when ready.`,
              );
            } catch {
              // Worker may already be dead
            }
          }

          return textResult(
            `Lock revoked on ${params.path} (was held by ${result.holderId}). Reason: ${reason}`,
            { revoked: true, holderId: result.holderId },
          );
        } catch (err: any) {
          return textResult(`Error revoking lock: ${err.message}`);
        }
      },
    },

    {
      name: "list_lock_table",
      label: "List Lock Table",
      description:
        "Show all current file locks, who holds them, and any waiting agents.",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        try {
          const locks = lockTable.getAllLocks();

          if (locks.length === 0) {
            return textResult("No active locks.");
          }

          const lines = locks.map((l) => {
            const waiters = lockTable.getWaiters(l.path);
            const age = Math.round((Date.now() - l.grantedAt) / 1000);
            let line = `  ${l.path} → held by "${l.holderName}" (${l.holderId}) for ${age}s`;
            if (l.purpose) line += ` [${l.purpose}]`;
            if (waiters.length > 0) {
              line += `\n    Waiting: ${waiters.map((w) => `"${w.requesterName}"`).join(", ")}`;
            }
            return line;
          });

          return textResult(
            `Active locks (${locks.length}):\n${lines.join("\n")}`,
            { lockCount: locks.length },
          );
        } catch (err: any) {
          return textResult(`Error listing locks: ${err.message}`);
        }
      },
    },

    {
      name: "list_workers",
      label: "List Workers",
      description:
        "Show all active worker agents, what they're working on, and which files they hold.",
      parameters: {
        type: "object" as const,
        properties: {},
        required: [],
      },
      async execute() {
        try {
          const workers = getWorkers();

          if (workers.length === 0) {
            return textResult("No active workers.");
          }

          const lines = workers.map((w) => {
            const locks = w.locksHeld.length > 0
              ? `\n    Locks: ${w.locksHeld.join(", ")}`
              : "";
            const status = w.isStreaming ? "streaming" : "idle";
            return `  "${w.name}" (${w.id}) — ${status}, task: "${w.taskText.slice(0, 60)}"${locks}`;
          });

          return textResult(
            `Active workers (${workers.length}):\n${lines.join("\n")}`,
            { workerCount: workers.length },
          );
        } catch (err: any) {
          return textResult(`Error listing workers: ${err.message}`);
        }
      },
    },

    {
      name: "escalate",
      label: "Escalate",
      description:
        "Escalate an issue to the user or main agent. " +
        "Use when you can't resolve a conflict or need human decision. " +
        "Include a clear summary of the problem and your recommendation.",
      parameters: {
        type: "object" as const,
        properties: {
          message: {
            type: "string" as const,
            description: "Clear summary of the issue and your recommendation",
          },
        },
        required: ["message"],
      },
      async execute(
        _toolCallId: string,
        params: { message: string },
      ) {
        try {
          escalate(params.message);
          return textResult(
            "Escalation sent. The user/main agent has been notified.",
            { escalated: true },
          );
        } catch (err: any) {
          return textResult(`Error escalating: ${err.message}`);
        }
      },
    },
  ];
}

// ── Lock instruction preamble for workers ────────────────────────────

/**
 * System prompt preamble injected into every worker's task prompt.
 * Instructs the worker on lock protocol.
 */
export const WORKER_LOCK_PREAMBLE = `
[FILE LOCK PROTOCOL]
You are working in a multi-agent environment. Other agents may be editing files simultaneously.

BEFORE editing any file:
1. Call claim_file_lock(path) to acquire exclusive access
2. If DENIED, work on something else and try again later
3. Perform your edit
4. Call release_file_lock(path) immediately after

RULES:
- Never edit a file without claiming the lock first
- Release locks as soon as your edit is done — don't hold them
- If you need to edit multiple files, claim and release them one at a time
- Use check_file_available(path) to plan your work order
- If you receive a message saying a lock was granted to you, proceed with that file immediately
[/FILE LOCK PROTOCOL]
`.trim();
