/**
 * FileLockTable — in-memory file lock manager for GAL.
 *
 * Provides synchronous claim/release/check operations with automatic
 * timeout enforcement and deadlock detection.  Event callbacks let the
 * GalCoordinator react to contention, timeouts, and deadlocks.
 */
import path from "node:path";
import type {
  FileLock,
  LockRequest,
  LockEvent,
  LockClaimResult,
  LockReleaseResult,
  LockCheckResult,
} from "../shared/gal-types";

const DEFAULT_TIMEOUT_MS = 60_000;

export class FileLockTable {
  /** path → active lock */
  private locks = new Map<string, FileLock & { _timer: NodeJS.Timeout }>();
  /** path → ordered queue of waiting requests */
  private waitQueue = new Map<string, LockRequest[]>();
  /** agentId → set of locked paths (reverse index for cleanup) */
  private agentLocks = new Map<string, Set<string>>();

  /** Called for every lock event (contention, timeout, deadlock, released, queue_granted). */
  onEvent: ((event: LockEvent) => void) | null = null;

  private timeoutMs: number;

  constructor(opts?: { timeoutMs?: number }) {
    this.timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Attempt to claim exclusive access to a file.
   *
   * - If free → grant immediately, start timeout timer.
   * - If held by same agent → refresh timeout, return granted.
   * - If held by another → enqueue request, emit contention event.
   */
  claim(
    agentId: string,
    agentName: string,
    filePath: string,
    purpose?: string,
  ): LockClaimResult {
    const normPath = this.normalizePath(filePath);

    const existing = this.locks.get(normPath);

    // Already held by same agent → refresh timeout
    if (existing && existing.holderId === agentId) {
      this.refreshTimeout(normPath);
      return { granted: true, alreadyHeld: true };
    }

    // Held by different agent → queue
    if (existing) {
      const request: LockRequest = {
        requesterId: agentId,
        requesterName: agentName,
        path: normPath,
        requestedAt: Date.now(),
      };
      let queue = this.waitQueue.get(normPath);
      if (!queue) {
        queue = [];
        this.waitQueue.set(normPath, queue);
      }
      // Don't double-queue same agent for same path
      if (!queue.some((r) => r.requesterId === agentId)) {
        queue.push(request);
      }
      const queuePosition = queue.findIndex((r) => r.requesterId === agentId) + 1;

      this.onEvent?.({
        type: "contention",
        path: normPath,
        holderId: existing.holderId,
        holderName: existing.holderName,
        requesterId: agentId,
        requesterName: agentName,
      });

      // Check for deadlock after adding to queue
      const cycle = this.detectDeadlock();
      if (cycle) {
        this.onEvent?.({ type: "deadlock", cycle });
      }

      return {
        granted: false,
        holder: existing.holderId,
        holderName: existing.holderName,
        queuePosition,
      };
    }

    // Free → grant
    this.grantLock(agentId, agentName, normPath, purpose);
    return { granted: true };
  }

  /**
   * Release a lock held by the given agent.
   * If there are waiters, auto-grants to the first in queue.
   */
  release(agentId: string, filePath: string): LockReleaseResult {
    const normPath = this.normalizePath(filePath);
    const lock = this.locks.get(normPath);

    if (!lock || lock.holderId !== agentId) {
      return { released: false };
    }

    this.removeLock(normPath);

    // Auto-grant to next waiter
    const nextWaiter = this.grantNextWaiter(normPath);

    this.onEvent?.({
      type: "released",
      path: normPath,
      nextWaiterId: nextWaiter?.requesterId,
      nextWaiterName: nextWaiter?.requesterName,
    });

    return {
      released: true,
      nextWaiter: nextWaiter
        ? { id: nextWaiter.requesterId, name: nextWaiter.requesterName }
        : undefined,
    };
  }

  /** Check whether a file is currently available. */
  check(filePath: string): LockCheckResult {
    const normPath = this.normalizePath(filePath);
    const lock = this.locks.get(normPath);
    const queue = this.waitQueue.get(normPath);

    if (!lock) {
      return { available: true };
    }

    return {
      available: false,
      holder: lock.holderId,
      holderName: lock.holderName,
      queueLength: queue?.length ?? 0,
    };
  }

  /** Release all locks held by a specific agent (cleanup on worker death). */
  releaseAllForAgent(agentId: string): string[] {
    // Remove agent from all wait queues (must happen even if agent holds no locks)
    for (const [, queue] of this.waitQueue) {
      const idx = queue.findIndex((r) => r.requesterId === agentId);
      if (idx >= 0) queue.splice(idx, 1);
    }

    const paths = this.agentLocks.get(agentId);
    if (!paths) return [];

    const released: string[] = [];
    for (const p of paths) {
      const lock = this.locks.get(p);
      if (lock && lock.holderId === agentId) {
        this.removeLock(p);
        this.grantNextWaiter(p);
        released.push(p);
      }
    }
    this.agentLocks.delete(agentId);

    return released;
  }

  /** Force-revoke a lock (used by GAL on timeout or manual revoke). */
  revoke(filePath: string): { revoked: boolean; holderId?: string } {
    const normPath = this.normalizePath(filePath);
    const lock = this.locks.get(normPath);
    if (!lock) return { revoked: false };

    const holderId = lock.holderId;
    this.removeLock(normPath);
    this.grantNextWaiter(normPath);

    return { revoked: true, holderId };
  }

  // ── Deadlock detection ──────────────────────────────────────────────

  /**
   * Simple cycle detection in the wait graph.
   *
   * For each waiting agent, follow the chain:
   *   waiter → path it wants → holder of that path → paths that holder waits for → ...
   * If we reach the original waiter, there's a cycle.
   */
  detectDeadlock(): string[] | null {
    // Build: agentId → paths it's waiting for
    const waitsFor = new Map<string, string[]>();
    for (const [p, queue] of this.waitQueue) {
      for (const req of queue) {
        let paths = waitsFor.get(req.requesterId);
        if (!paths) {
          paths = [];
          waitsFor.set(req.requesterId, paths);
        }
        paths.push(p);
      }
    }

    // For each waiting agent, DFS to find cycles
    for (const startAgent of waitsFor.keys()) {
      const visited = new Set<string>();
      const chain: string[] = [startAgent];

      const hasCycle = (currentAgent: string): boolean => {
        if (visited.has(currentAgent)) {
          // Found cycle — trim chain to just the cycle
          const start = chain.indexOf(currentAgent);
          if (start >= 0) {
            chain.splice(0, start);
          }
          return true;
        }
        visited.add(currentAgent);

        const wantedPaths = waitsFor.get(currentAgent);
        if (!wantedPaths) return false;

        for (const p of wantedPaths) {
          const holder = this.locks.get(p);
          if (!holder) continue;
          chain.push(holder.holderId);
          if (hasCycle(holder.holderId)) return true;
          chain.pop();
        }

        return false;
      };

      if (hasCycle(startAgent)) {
        return chain;
      }
    }

    return null;
  }

  // ── Snapshot ─────────────────────────────────────────────────────────

  /** Get all currently held locks. */
  getAllLocks(): FileLock[] {
    return [...this.locks.values()].map(({ _timer, ...lock }) => lock);
  }

  /** Get pending requests for a path. */
  getWaiters(filePath: string): LockRequest[] {
    return this.waitQueue.get(this.normalizePath(filePath)) ?? [];
  }

  /** Get all paths locked by a specific agent. */
  getLocksForAgent(agentId: string): string[] {
    return [...(this.agentLocks.get(agentId) ?? [])];
  }

  /** Total number of active locks. */
  get size(): number {
    return this.locks.size;
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  /** Dispose all timers. */
  dispose(): void {
    for (const lock of this.locks.values()) {
      clearTimeout(lock._timer);
    }
    this.locks.clear();
    this.waitQueue.clear();
    this.agentLocks.clear();
  }

  // ── Internal ────────────────────────────────────────────────────────

  private normalizePath(p: string): string {
    return path.resolve(p);
  }

  private grantLock(
    agentId: string,
    agentName: string,
    normPath: string,
    purpose?: string,
  ): void {
    const timer = setTimeout(() => {
      this.handleTimeout(normPath);
    }, this.timeoutMs);

    this.locks.set(normPath, {
      path: normPath,
      holderId: agentId,
      holderName: agentName,
      grantedAt: Date.now(),
      timeoutMs: this.timeoutMs,
      purpose,
      _timer: timer,
    });

    // Reverse index
    let paths = this.agentLocks.get(agentId);
    if (!paths) {
      paths = new Set();
      this.agentLocks.set(agentId, paths);
    }
    paths.add(normPath);
  }

  private removeLock(normPath: string): void {
    const lock = this.locks.get(normPath);
    if (!lock) return;

    clearTimeout(lock._timer);

    // Update reverse index
    const paths = this.agentLocks.get(lock.holderId);
    if (paths) {
      paths.delete(normPath);
      if (paths.size === 0) this.agentLocks.delete(lock.holderId);
    }

    this.locks.delete(normPath);
  }

  private refreshTimeout(normPath: string): void {
    const lock = this.locks.get(normPath);
    if (!lock) return;
    clearTimeout(lock._timer);
    lock._timer = setTimeout(() => this.handleTimeout(normPath), this.timeoutMs);
    lock.grantedAt = Date.now();
  }

  private handleTimeout(normPath: string): void {
    const lock = this.locks.get(normPath);
    if (!lock) return;

    const holderId = lock.holderId;
    const holderName = lock.holderName;

    // Revoke
    this.removeLock(normPath);

    // Auto-grant to next waiter
    this.grantNextWaiter(normPath);

    this.onEvent?.({
      type: "timeout",
      path: normPath,
      holderId,
      holderName,
    });
  }

  private grantNextWaiter(normPath: string): LockRequest | null {
    const queue = this.waitQueue.get(normPath);
    if (!queue || queue.length === 0) return null;

    const next = queue.shift()!;
    if (queue.length === 0) this.waitQueue.delete(normPath);

    this.grantLock(next.requesterId, next.requesterName, normPath);

    // Notify that a queued agent was auto-granted the lock (fix #3)
    this.onEvent?.({
      type: "queue_granted",
      path: normPath,
      agentId: next.requesterId,
      agentName: next.requesterName,
    });

    return next;
  }
}
