/**
 * Soul store — manages ~/.tau/SOUL.md personality file.
 *
 * Handles reading, writing, bootstrap detection, and proposal management.
 * Follows the same filesystem-based pattern as journal-store.ts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  needsBootstrap,
  parseSoulSections,
  type SoulStatus,
  type SoulProposalsFile,
} from "./shared/soul-types";

const TAU_DIR = path.join(os.homedir(), ".tau");
const SOUL_FILENAME = "SOUL.md";
const PROPOSALS_FILENAME = "soul-proposals.json";

// ── Path helpers ──────────────────────────────────────────────────────

export function getSoulPath(): string {
  return path.join(TAU_DIR, SOUL_FILENAME);
}

function getProposalsPath(): string {
  return path.join(TAU_DIR, PROPOSALS_FILENAME);
}

async function ensureTauDir(): Promise<void> {
  await fs.mkdir(TAU_DIR, { recursive: true });
}

// ── SOUL template ─────────────────────────────────────────────────────

export function getSoulTemplate(): string {
  return `# SOUL

## Who I Am
[To be discovered through conversation]

## Voice
[To be discovered through conversation]

## Values
[To be discovered through conversation]

## Working Style
[To be discovered through conversation]

## Boundaries
[To be discovered through conversation]
`;
}

// ── CRUD operations ───────────────────────────────────────────────────

export async function readSoul(): Promise<string> {
  try {
    return await fs.readFile(getSoulPath(), "utf-8");
  } catch {
    return "";
  }
}

export async function writeSoul(content: string): Promise<void> {
  await ensureTauDir();
  const soulPath = getSoulPath();
  const tmp = soulPath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, soulPath);
}

export async function ensureSoulFile(): Promise<void> {
  await ensureTauDir();
  try {
    await fs.access(getSoulPath());
  } catch {
    // File doesn't exist, create from template
    await writeSoul(getSoulTemplate());
  }
}

// ── Status ────────────────────────────────────────────────────────────

export async function getSoulStatus(): Promise<SoulStatus> {
  const soulPath = getSoulPath();
  let exists = false;
  let lastModified = 0;
  let content = "";

  try {
    content = await fs.readFile(soulPath, "utf-8");
    const stat = await fs.stat(soulPath);
    exists = true;
    lastModified = stat.mtimeMs;
  } catch {
    // File doesn't exist
  }

  return {
    exists,
    needsBootstrap: !exists || needsBootstrap(content),
    path: soulPath,
    sections: exists ? parseSoulSections(content) : [],
    lastModified,
  };
}

// ── Proposals ─────────────────────────────────────────────────────────

export async function readProposals(): Promise<SoulProposalsFile | null> {
  try {
    const raw = await fs.readFile(getProposalsPath(), "utf-8");
    return JSON.parse(raw) as SoulProposalsFile;
  } catch {
    return null;
  }
}

export async function writeProposals(proposals: SoulProposalsFile): Promise<void> {
  await ensureTauDir();
  const proposalsPath = getProposalsPath();
  const tmp = proposalsPath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(proposals, null, 2), "utf-8");
  await fs.rename(tmp, proposalsPath);
}

export async function deleteProposals(): Promise<void> {
  try {
    await fs.unlink(getProposalsPath());
  } catch {
    // File doesn't exist, that's fine
  }
}
