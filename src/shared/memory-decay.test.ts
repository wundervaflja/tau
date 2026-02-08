import { describe, it, expect } from "vitest";
import type { VaultNoteFrontmatter } from "./vault-types";

/**
 * Tests for the memory decay algorithm logic.
 * The actual decay runs in vault-store.ts (decayMemoryNotes),
 * but we test the decision logic here as pure functions.
 */

/** Determines if a memory note should be archived (decayed). */
function shouldDecay(
  fm: VaultNoteFrontmatter,
  nowMs: number,
): boolean {
  // Preferences never decay
  if (fm.memoryType === "preference") return false;

  const usedCount = fm.usedCount || 0;
  if (usedCount >= 3) return false;

  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const lastUsed = fm.lastUsedAt
    ? new Date(fm.lastUsedAt).getTime()
    : new Date(fm.created).getTime();

  return nowMs - lastUsed > NINETY_DAYS_MS;
}

const NOW = new Date("2026-06-01T00:00:00Z").getTime();

describe("memory decay logic", () => {
  it("preferences never decay regardless of age or usage", () => {
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "preference",
      tags: [],
      created: "2025-01-01T00:00:00Z", // over a year old
      updated: "2025-01-01T00:00:00Z",
      usedCount: 0,
      lastUsedAt: "2025-01-01T00:00:00Z",
    };
    expect(shouldDecay(fm, NOW)).toBe(false);
  });

  it("facts unused for >90 days with usedCount < 3 should decay", () => {
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "fact",
      tags: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-01-01T00:00:00Z",
      usedCount: 1,
      lastUsedAt: "2026-01-01T00:00:00Z", // ~150 days ago from NOW
    };
    expect(shouldDecay(fm, NOW)).toBe(true);
  });

  it("facts with usedCount >= 3 do not decay even if old", () => {
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "fact",
      tags: [],
      created: "2025-01-01T00:00:00Z",
      updated: "2025-01-01T00:00:00Z",
      usedCount: 3,
      lastUsedAt: "2025-01-01T00:00:00Z",
    };
    expect(shouldDecay(fm, NOW)).toBe(false);
  });

  it("recently used facts do not decay", () => {
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "fact",
      tags: [],
      created: "2026-01-01T00:00:00Z",
      updated: "2026-05-20T00:00:00Z",
      usedCount: 1,
      lastUsedAt: "2026-05-20T00:00:00Z", // ~12 days ago from NOW
    };
    expect(shouldDecay(fm, NOW)).toBe(false);
  });

  it("decisions unused for >90 days with low count should decay", () => {
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "decision",
      tags: [],
      created: "2025-12-01T00:00:00Z",
      updated: "2025-12-01T00:00:00Z",
      usedCount: 2,
      lastUsedAt: "2025-12-01T00:00:00Z", // ~182 days ago
    };
    expect(shouldDecay(fm, NOW)).toBe(true);
  });

  it("defaults to created date when lastUsedAt is missing", () => {
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "fact",
      tags: [],
      created: "2025-01-01T00:00:00Z",
      updated: "2025-01-01T00:00:00Z",
      usedCount: 0,
      // lastUsedAt intentionally omitted
    };
    expect(shouldDecay(fm, NOW)).toBe(true);
  });

  it("defaults usedCount to 0 when missing", () => {
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "summary",
      tags: [],
      created: "2025-01-01T00:00:00Z",
      updated: "2025-01-01T00:00:00Z",
      // usedCount intentionally omitted
      lastUsedAt: "2025-01-01T00:00:00Z",
    };
    expect(shouldDecay(fm, NOW)).toBe(true);
  });

  it("reinforcement bumps should prevent decay", () => {
    // Simulate a note that was created long ago but recently reinforced
    const fm: VaultNoteFrontmatter = {
      type: "memory",
      memoryType: "fact",
      tags: [],
      created: "2025-01-01T00:00:00Z",
      updated: "2026-05-25T00:00:00Z",
      usedCount: 1,
      lastUsedAt: "2026-05-25T00:00:00Z", // ~7 days ago
    };
    expect(shouldDecay(fm, NOW)).toBe(false);
  });
});
