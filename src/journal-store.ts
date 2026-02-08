/**
 * Journal store — manages markdown files in <cwd>/journal/ folder.
 *
 * Each journal entry is a .md file. Daily entries use YYYY-MM-DD.md naming.
 * Linked pages use slugified names.
 */
import fs from "node:fs/promises";
import path from "node:path";

const JOURNAL_DIR = "journal";

export interface JournalEntry {
  /** Filename without extension */
  name: string;
  /** Full file path */
  path: string;
  /** Markdown content */
  content: string;
  /** Last modified timestamp */
  modified: number;
  /** Created timestamp (from filename for daily, or birthtime) */
  created: number;
}

export interface JournalListItem {
  name: string;
  path: string;
  modified: number;
  created: number;
  /** First non-empty line as preview */
  preview: string;
}

async function ensureJournalDir(cwd: string): Promise<string> {
  const dir = path.join(cwd, JOURNAL_DIR);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60)
    .replace(/^-|-$/g, "");
}

function todayFilename(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function listJournalEntries(cwd: string): Promise<JournalListItem[]> {
  const dir = await ensureJournalDir(cwd);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const entries: JournalListItem[] = [];
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const name = file.replace(/\.md$/, "");
    const fullPath = path.join(dir, file);
    try {
      const stat = await fs.stat(fullPath);
      const content = await fs.readFile(fullPath, "utf-8");
      const firstLine = content.split("\n").find((l) => l.trim().length > 0) ?? "";
      entries.push({
        name,
        path: fullPath,
        modified: stat.mtimeMs,
        created: stat.birthtimeMs,
        preview: firstLine.replace(/^#+\s*/, "").slice(0, 100),
      });
    } catch {
      // skip unreadable files
    }
  }

  // Sort newest first
  entries.sort((a, b) => b.modified - a.modified);
  return entries;
}

export async function readJournalEntry(cwd: string, name: string): Promise<JournalEntry | null> {
  const dir = await ensureJournalDir(cwd);
  const fullPath = path.join(dir, `${name}.md`);
  try {
    const content = await fs.readFile(fullPath, "utf-8");
    const stat = await fs.stat(fullPath);
    return {
      name,
      path: fullPath,
      content,
      modified: stat.mtimeMs,
      created: stat.birthtimeMs,
    };
  } catch {
    return null;
  }
}

export async function saveJournalEntry(cwd: string, name: string, content: string): Promise<void> {
  const dir = await ensureJournalDir(cwd);
  const fullPath = path.join(dir, `${name}.md`);
  const tmp = fullPath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, fullPath);
}

export async function createJournalEntry(
  cwd: string,
  name?: string,
): Promise<JournalEntry> {
  const entryName = name || todayFilename();
  const dir = await ensureJournalDir(cwd);
  const fullPath = path.join(dir, `${entryName}.md`);

  // Don't overwrite existing
  try {
    const existing = await fs.readFile(fullPath, "utf-8");
    const stat = await fs.stat(fullPath);
    return { name: entryName, path: fullPath, content: existing, modified: stat.mtimeMs, created: stat.birthtimeMs };
  } catch {
    // Create new
    const header = `# ${entryName}\n\n`;
    await fs.writeFile(fullPath, header, "utf-8");
    const stat = await fs.stat(fullPath);
    return { name: entryName, path: fullPath, content: header, modified: stat.mtimeMs, created: stat.birthtimeMs };
  }
}

export async function createLinkedPage(cwd: string, title: string): Promise<JournalEntry> {
  const name = slugify(title) || `page-${Date.now()}`;
  return createJournalEntry(cwd, name);
}

export async function deleteJournalEntry(cwd: string, name: string): Promise<void> {
  const dir = await ensureJournalDir(cwd);
  const fullPath = path.join(dir, `${name}.md`);
  await fs.unlink(fullPath);
}
