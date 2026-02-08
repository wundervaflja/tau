/**
 * GAL (Global Agent Lock) — shared types for the file-lock-aware
 * agent orchestrator.
 */

// ── Lock types ────────────────────────────────────────────────────────

export interface FileLock {
  path: string;
  holderId: string;
  holderName: string;
  grantedAt: number;
  timeoutMs: number;
  purpose?: string;
}

export interface LockRequest {
  requesterId: string;
  requesterName: string;
  path: string;
  requestedAt: number;
}

export type LockClaimResult =
  | { granted: true; alreadyHeld?: boolean }
  | { granted: false; holder: string; holderName: string; queuePosition: number };

export interface LockReleaseResult {
  released: boolean;
  nextWaiter?: { id: string; name: string };
}

export interface LockCheckResult {
  available: boolean;
  holder?: string;
  holderName?: string;
  queueLength?: number;
}

// ── Lock events (emitted by FileLockTable → GalCoordinator) ──────────

export type LockEvent =
  | { type: "contention"; path: string; holderId: string; holderName: string; requesterId: string; requesterName: string }
  | { type: "timeout"; path: string; holderId: string; holderName: string }
  | { type: "deadlock"; cycle: string[] }
  | { type: "released"; path: string; nextWaiterId?: string; nextWaiterName?: string }
  | { type: "queue_granted"; path: string; agentId: string; agentName: string };

// ── Worker & status types ────────────────────────────────────────────

export interface GalWorkerInfo {
  id: string;
  name: string;
  taskId: string;
  taskText: string;
  locksHeld: string[];
  isStreaming: boolean;
  spawnedAt: number;
}

export interface GalLockInfo {
  path: string;
  holderId: string;
  holderName: string;
  grantedAt: number;
  queueLength: number;
}

export interface GalStatus {
  active: boolean;
  workerCount: number;
  lockCount: number;
  contentionCount: number;
}
