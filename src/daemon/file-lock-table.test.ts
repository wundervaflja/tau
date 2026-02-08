import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { FileLockTable } from "./file-lock-table";

describe("FileLockTable", () => {
  let table: FileLockTable;
  let events: any[];

  beforeEach(() => {
    vi.useFakeTimers();
    table = new FileLockTable({ timeoutMs: 5000 });
    events = [];
    table.onEvent = (e) => events.push(e);
  });

  afterEach(() => {
    table.dispose();
    vi.useRealTimers();
  });

  // ── claim ───────────────────────────────────────────────────────────

  describe("claim", () => {
    it("grants lock on free file", () => {
      const result = table.claim("a1", "Agent1", "/foo/bar.ts");
      expect(result).toEqual({ granted: true });
      expect(table.size).toBe(1);
    });

    it("grants re-claim by same agent (refreshes timeout)", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      const result = table.claim("a1", "Agent1", "/foo/bar.ts");
      expect(result).toEqual({ granted: true, alreadyHeld: true });
      expect(table.size).toBe(1);
    });

    it("denies claim when held by another agent", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      const result = table.claim("a2", "Agent2", "/foo/bar.ts");
      expect(result).toEqual({
        granted: false,
        holder: "a1",
        holderName: "Agent1",
        queuePosition: 1,
      });
    });

    it("emits contention event on conflict", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("contention");
      expect(events[0].holderId).toBe("a1");
      expect(events[0].requesterId).toBe("a2");
    });

    it("does not double-queue same agent for same path", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      expect(table.getWaiters("/foo/bar.ts")).toHaveLength(1);
    });

    it("queues multiple agents in order", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      table.claim("a3", "Agent3", "/foo/bar.ts");
      const waiters = table.getWaiters("/foo/bar.ts");
      expect(waiters).toHaveLength(2);
      expect(waiters[0].requesterId).toBe("a2");
      expect(waiters[1].requesterId).toBe("a3");
    });
  });

  // ── release ─────────────────────────────────────────────────────────

  describe("release", () => {
    it("releases a held lock", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      const result = table.release("a1", "/foo/bar.ts");
      expect(result.released).toBe(true);
      expect(table.size).toBe(0);
    });

    it("returns false when releasing a lock not held", () => {
      const result = table.release("a1", "/foo/bar.ts");
      expect(result.released).toBe(false);
    });

    it("returns false when wrong agent tries to release", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      const result = table.release("a2", "/foo/bar.ts");
      expect(result.released).toBe(false);
      expect(table.size).toBe(1);
    });

    it("auto-grants to next waiter on release", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      const result = table.release("a1", "/foo/bar.ts");
      expect(result.released).toBe(true);
      expect(result.nextWaiter).toEqual({ id: "a2", name: "Agent2" });
      // Lock is now held by a2
      expect(table.size).toBe(1);
      expect(table.check("/foo/bar.ts")).toEqual({
        available: false,
        holder: "a2",
        holderName: "Agent2",
        queueLength: 0,
      });
    });

    it("emits released event", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      events.length = 0;
      table.release("a1", "/foo/bar.ts");
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("released");
    });
  });

  // ── check ───────────────────────────────────────────────────────────

  describe("check", () => {
    it("returns available for unlocked file", () => {
      expect(table.check("/foo/bar.ts")).toEqual({ available: true });
    });

    it("returns holder info for locked file", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      expect(table.check("/foo/bar.ts")).toEqual({
        available: false,
        holder: "a1",
        holderName: "Agent1",
        queueLength: 0,
      });
    });

    it("includes queue length", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      table.claim("a3", "Agent3", "/foo/bar.ts");
      const result = table.check("/foo/bar.ts");
      expect(result.queueLength).toBe(2);
    });
  });

  // ── timeout ─────────────────────────────────────────────────────────

  describe("timeout", () => {
    it("revokes lock after timeout", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      expect(table.size).toBe(1);

      vi.advanceTimersByTime(5000);

      expect(table.size).toBe(0);
      expect(events.some((e) => e.type === "timeout")).toBe(true);
    });

    it("auto-grants to waiter after timeout", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      events.length = 0;

      vi.advanceTimersByTime(5000);

      // a1's lock timed out, a2 should now hold it
      expect(table.check("/foo/bar.ts")).toEqual({
        available: false,
        holder: "a2",
        holderName: "Agent2",
        queueLength: 0,
      });
      expect(events.some((e) => e.type === "timeout")).toBe(true);
    });

    it("re-claim refreshes timeout", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      vi.advanceTimersByTime(3000);

      // Re-claim refreshes the timer
      table.claim("a1", "Agent1", "/foo/bar.ts");
      vi.advanceTimersByTime(3000);

      // Should still be locked (3000 + 3000 = 6000 > 5000, but timer was refreshed at 3000)
      expect(table.size).toBe(1);

      vi.advanceTimersByTime(2001);
      expect(table.size).toBe(0);
    });
  });

  // ── releaseAllForAgent ──────────────────────────────────────────────

  describe("releaseAllForAgent", () => {
    it("releases all locks for an agent", () => {
      table.claim("a1", "Agent1", "/foo/a.ts");
      table.claim("a1", "Agent1", "/foo/b.ts");
      table.claim("a2", "Agent2", "/foo/c.ts");

      const released = table.releaseAllForAgent("a1");
      expect(released).toHaveLength(2);
      expect(table.size).toBe(1); // only a2's lock remains
    });

    it("removes agent from wait queues", () => {
      table.claim("a1", "Agent1", "/foo/a.ts");
      table.claim("a2", "Agent2", "/foo/a.ts"); // a2 waits

      table.releaseAllForAgent("a2");
      expect(table.getWaiters("/foo/a.ts")).toHaveLength(0);
    });

    it("grants to next waiter when agent dies", () => {
      table.claim("a1", "Agent1", "/foo/a.ts");
      table.claim("a2", "Agent2", "/foo/a.ts");
      table.claim("a3", "Agent3", "/foo/a.ts");

      table.releaseAllForAgent("a1");
      // a2 should now hold the lock
      expect(table.check("/foo/a.ts").holder).toBe("a2");
      expect(table.getWaiters("/foo/a.ts")).toHaveLength(1);
    });
  });

  // ── revoke ──────────────────────────────────────────────────────────

  describe("revoke", () => {
    it("force-revokes a lock", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      const result = table.revoke("/foo/bar.ts");
      expect(result).toEqual({ revoked: true, holderId: "a1" });
      expect(table.size).toBe(0);
    });

    it("returns false for unlocked file", () => {
      expect(table.revoke("/foo/bar.ts")).toEqual({ revoked: false });
    });

    it("grants to next waiter after revoke", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts");
      table.claim("a2", "Agent2", "/foo/bar.ts");
      table.revoke("/foo/bar.ts");
      expect(table.check("/foo/bar.ts").holder).toBe("a2");
    });
  });

  // ── deadlock detection ──────────────────────────────────────────────

  describe("detectDeadlock", () => {
    it("detects simple A↔B deadlock", () => {
      // a1 holds file1, a2 holds file2
      table.claim("a1", "Agent1", "/file1");
      table.claim("a2", "Agent2", "/file2");
      // a1 wants file2, a2 wants file1
      table.claim("a1", "Agent1", "/file2");

      // Clear events so far, then trigger deadlock check
      events.length = 0;
      table.claim("a2", "Agent2", "/file1");

      // Should have emitted deadlock event
      const deadlockEvent = events.find((e) => e.type === "deadlock");
      expect(deadlockEvent).toBeDefined();
      expect(deadlockEvent.cycle).toContain("a1");
      expect(deadlockEvent.cycle).toContain("a2");
    });

    it("returns null when no deadlock", () => {
      table.claim("a1", "Agent1", "/file1");
      table.claim("a2", "Agent2", "/file1"); // a2 waits for a1, but no cycle
      expect(table.detectDeadlock()).toBeNull();
    });
  });

  // ── snapshot methods ────────────────────────────────────────────────

  describe("snapshots", () => {
    it("getAllLocks returns clean objects without timers", () => {
      table.claim("a1", "Agent1", "/foo/bar.ts", "editing");
      const locks = table.getAllLocks();
      expect(locks).toHaveLength(1);
      expect(locks[0].holderId).toBe("a1");
      expect(locks[0].purpose).toBe("editing");
      expect((locks[0] as any)._timer).toBeUndefined();
    });

    it("getLocksForAgent returns paths", () => {
      table.claim("a1", "Agent1", "/foo/a.ts");
      table.claim("a1", "Agent1", "/foo/b.ts");
      const paths = table.getLocksForAgent("a1");
      expect(paths).toHaveLength(2);
    });
  });
});
