/**
 * Unified vault store — manages markdown notes (memories + knowledge) on disk.
 *
 * Notes are stored as .md files with YAML frontmatter in:
 *   ~/.tau/vault/           (global scope)
 *   <cwd>/vault/            (workspace scope)
 *
 * Subdirectories: memories/, concepts/, patterns/, projects/, references/, logs/, mocs/
 */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type {
  VaultNoteType,
  MemorySubtype,
  VaultScope,
  VaultNoteFrontmatter,
  VaultNote,
  VaultNoteListItem,
  VaultSearchResult,
  VaultGraphNode,
  VaultCreateOptions,
  VaultListOptions,
  VaultSearchOptions,
} from "./shared/vault-types";

const GLOBAL_VAULT_DIR = path.join(os.homedir(), ".tau", "vault");
const WORKSPACE_VAULT_DIR = "vault";

// ── Parsing utilities (pure, testable) ─────────────────────────────

/** Convert a note type to its subdirectory name. */
export function noteTypeToSubdir(type: VaultNoteType): string {
  const map: Record<VaultNoteType, string> = {
    memory: "memories",
    concept: "concepts",
    pattern: "patterns",
    project: "projects",
    reference: "references",
    log: "logs",
    moc: "mocs",
  };
  return map[type] || "misc";
}

/** Create a URL-safe slug from text. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80)
    .replace(/^-|-$/g, "");
}

/** Extract [[wikilinks]] from content. Returns slugs. */
export function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].trim());
  }
  return links;
}

/** Parse YAML frontmatter from markdown content. */
export function parseFrontmatter(content: string): { frontmatter: VaultNoteFrontmatter; body: string } {
  const defaultFm: VaultNoteFrontmatter = {
    type: "concept",
    tags: [],
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };

  if (!content.startsWith("---")) {
    return { frontmatter: defaultFm, body: content };
  }

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return { frontmatter: defaultFm, body: content };
  }

  const yamlBlock = content.slice(4, endIdx).trim();
  const body = content.slice(endIdx + 4).trim();
  const fm: Record<string, any> = {};

  for (const line of yamlBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value: any = line.slice(colonIdx + 1).trim();

    // Parse arrays: [item1, item2]
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim())
        .filter(Boolean);
    }
    // Parse numbers
    else if (/^\d+$/.test(value)) {
      value = parseInt(value, 10);
    }

    fm[key] = value;
  }

  return {
    frontmatter: {
      type: (fm.type as VaultNoteType) || "concept",
      memoryType: fm.memoryType as MemorySubtype | undefined,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      created: (fm.created as string) || new Date().toISOString(),
      updated: (fm.updated as string) || new Date().toISOString(),
      source: fm.source,
      usedCount: typeof fm.usedCount === "number" ? fm.usedCount : undefined,
      lastUsedAt: fm.lastUsedAt,
      aliases: Array.isArray(fm.aliases) ? fm.aliases : undefined,
    },
    body,
  };
}

/** Serialize frontmatter + body back to markdown string. */
export function serializeFrontmatter(fm: VaultNoteFrontmatter, body: string): string {
  const lines: string[] = ["---"];

  lines.push(`type: ${fm.type}`);
  if (fm.memoryType) lines.push(`memoryType: ${fm.memoryType}`);
  lines.push(`tags: [${fm.tags.join(", ")}]`);
  lines.push(`created: ${fm.created}`);
  lines.push(`updated: ${fm.updated}`);
  if (fm.source) lines.push(`source: ${fm.source}`);
  if (fm.usedCount !== undefined) lines.push(`usedCount: ${fm.usedCount}`);
  if (fm.lastUsedAt) lines.push(`lastUsedAt: ${fm.lastUsedAt}`);
  if (fm.aliases && fm.aliases.length > 0) lines.push(`aliases: [${fm.aliases.join(", ")}]`);

  lines.push("---");
  lines.push("");
  lines.push(body);

  return lines.join("\n");
}

// ── Path helpers ──────────────────────────────────────────────────────

export function getVaultDir(scope: VaultScope, cwd?: string): string {
  if (scope === "global") return GLOBAL_VAULT_DIR;
  if (!cwd) throw new Error("cwd is required for workspace scope");
  return path.join(cwd, WORKSPACE_VAULT_DIR);
}

export async function ensureVaultDirs(scope: VaultScope, cwd?: string): Promise<void> {
  const vaultDir = getVaultDir(scope, cwd);
  const subdirs = ["memories", "concepts", "patterns", "projects", "references", "logs", "mocs", "_archive"];
  await fs.mkdir(vaultDir, { recursive: true });
  for (const sub of subdirs) {
    await fs.mkdir(path.join(vaultDir, sub), { recursive: true });
  }
}

/** Extract title from markdown body (first # heading or first line). */
function extractTitle(body: string): string {
  const firstLine = body.split("\n").find((l) => l.trim().length > 0) ?? "";
  return firstLine.replace(/^#+\s*/, "").trim() || "Untitled";
}

/** Extract first non-heading, non-empty line as preview. */
function extractPreview(body: string): string {
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith("#")) {
      return trimmed.slice(0, 120);
    }
  }
  return "";
}

// ── CRUD ──────────────────────────────────────────────────────────────

export async function createVaultNote(opts: VaultCreateOptions): Promise<VaultNote> {
  const slug = slugify(opts.title) || `note-${Date.now()}`;
  const subdir = noteTypeToSubdir(opts.type);
  await ensureVaultDirs(opts.scope, opts.cwd);

  const vaultDir = getVaultDir(opts.scope, opts.cwd);
  const filePath = path.join(vaultDir, subdir, `${slug}.md`);

  const now = new Date().toISOString();
  const fm: VaultNoteFrontmatter = {
    type: opts.type,
    memoryType: opts.memoryType,
    tags: opts.tags || [],
    created: now,
    updated: now,
    source: opts.source,
    usedCount: opts.type === "memory" ? 0 : undefined,
    lastUsedAt: opts.type === "memory" ? now : undefined,
  };

  const body = opts.content
    ? `# ${opts.title}\n\n${opts.content}`
    : `# ${opts.title}\n`;

  const content = serializeFrontmatter(fm, body);
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);

  return {
    slug,
    scope: opts.scope,
    type: opts.type,
    memoryType: opts.memoryType,
    title: opts.title,
    content: body,
    frontmatter: fm,
    path: filePath,
    created: now,
    updated: now,
  };
}

/** Convenience: create a memory note in the memories/ subdir. */
export async function createMemoryNote(opts: {
  title: string;
  content?: string;
  memoryType: MemorySubtype;
  tags?: string[];
  scope: VaultScope;
  source?: VaultNoteFrontmatter["source"];
  cwd?: string;
}): Promise<VaultNote> {
  return createVaultNote({
    title: opts.title,
    type: "memory",
    memoryType: opts.memoryType,
    tags: opts.tags,
    scope: opts.scope,
    content: opts.content,
    source: opts.source,
    cwd: opts.cwd,
  });
}

export async function readVaultNote(
  slug: string,
  scope: VaultScope,
  cwd?: string,
): Promise<VaultNote | null> {
  const vaultDir = getVaultDir(scope, cwd);

  // Search across all subdirectories
  const subdirs = ["memories", "concepts", "patterns", "projects", "references", "logs", "mocs"];
  for (const sub of subdirs) {
    const filePath = path.join(vaultDir, sub, `${slug}.md`);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const { frontmatter, body } = parseFrontmatter(raw);
      return {
        slug,
        scope,
        type: frontmatter.type,
        memoryType: frontmatter.memoryType,
        title: extractTitle(body),
        content: body,
        frontmatter,
        path: filePath,
        created: frontmatter.created,
        updated: frontmatter.updated,
      };
    } catch {
      // Try next subdir
    }
  }
  return null;
}

export async function updateVaultNote(
  slug: string,
  scope: VaultScope,
  body: string,
  cwd?: string,
): Promise<VaultNote | null> {
  const existing = await readVaultNote(slug, scope, cwd);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updatedFm = { ...existing.frontmatter, updated: now };
  const content = serializeFrontmatter(updatedFm, body);

  const tmp = existing.path + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, existing.path);

  return {
    ...existing,
    content: body,
    frontmatter: updatedFm,
    updated: now,
  };
}

export async function deleteVaultNote(
  slug: string,
  scope: VaultScope,
  cwd?: string,
): Promise<boolean> {
  const existing = await readVaultNote(slug, scope, cwd);
  if (!existing) return false;
  await fs.unlink(existing.path);
  return true;
}

// ── List ──────────────────────────────────────────────────────────────

async function listNotesFromDir(
  vaultDir: string,
  scope: VaultScope,
): Promise<VaultNoteListItem[]> {
  const items: VaultNoteListItem[] = [];
  const subdirs = ["memories", "concepts", "patterns", "projects", "references", "logs", "mocs"];

  for (const sub of subdirs) {
    const dir = path.join(vaultDir, sub);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(/\.md$/, "");
      const filePath = path.join(dir, file);
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const { frontmatter, body } = parseFrontmatter(raw);
        items.push({
          slug,
          scope,
          type: frontmatter.type,
          memoryType: frontmatter.memoryType,
          title: extractTitle(body),
          tags: frontmatter.tags,
          preview: extractPreview(body),
          updated: frontmatter.updated,
          forwardLinks: extractWikilinks(body),
          backlinks: [], // populated by buildVaultGraph
        });
      } catch {
        // skip unreadable
      }
    }
  }

  items.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  return items;
}

export async function listVaultNotes(
  cwd: string,
  opts?: VaultListOptions,
): Promise<VaultNoteListItem[]> {
  let items: VaultNoteListItem[] = [];

  if (!opts?.scope || opts.scope === "global") {
    try {
      items.push(...(await listNotesFromDir(GLOBAL_VAULT_DIR, "global")));
    } catch {
      // vault dir doesn't exist yet
    }
  }

  if (!opts?.scope || opts.scope === "workspace") {
    try {
      items.push(...(await listNotesFromDir(path.join(cwd, WORKSPACE_VAULT_DIR), "workspace")));
    } catch {
      // vault dir doesn't exist yet
    }
  }

  // Apply filters
  if (opts?.type) {
    items = items.filter((i) => i.type === opts.type);
  }
  if (opts?.memoryType) {
    items = items.filter((i) => i.memoryType === opts.memoryType);
  }
  if (opts?.tags && opts.tags.length > 0) {
    const tagSet = new Set(opts.tags);
    items = items.filter((i) => i.tags.some((t) => tagSet.has(t)));
  }

  items.sort((a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime());
  return items;
}

/** List only memory-type vault notes from both scopes. */
export async function listMemoryNotes(cwd: string): Promise<VaultNoteListItem[]> {
  return listVaultNotes(cwd, { type: "memory" });
}

// ── Memory-specific operations ────────────────────────────────────────

/** Bump usedCount and lastUsedAt for a memory note. */
export async function reinforceMemoryNote(
  slug: string,
  scope: VaultScope,
  cwd?: string,
): Promise<boolean> {
  const existing = await readVaultNote(slug, scope, cwd);
  if (!existing) return false;

  const now = new Date().toISOString();
  const updatedFm: VaultNoteFrontmatter = {
    ...existing.frontmatter,
    updated: now,
    usedCount: (existing.frontmatter.usedCount || 0) + 1,
    lastUsedAt: now,
  };

  const content = serializeFrontmatter(updatedFm, existing.content);
  const tmp = existing.path + ".tmp";
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, existing.path);
  return true;
}

/** Archive memories unused for 90+ days with usedCount < 3. Preferences never decay. */
export async function decayMemoryNotes(cwd: string): Promise<{ archived: string[] }> {
  const memoryNotes = await listMemoryNotes(cwd);
  const now = Date.now();
  const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
  const archived: string[] = [];

  for (const note of memoryNotes) {
    // Preferences never decay
    if (note.memoryType === "preference") continue;

    // Read full note to get frontmatter details
    const full = await readVaultNote(note.slug, note.scope, cwd);
    if (!full) continue;

    const usedCount = full.frontmatter.usedCount || 0;
    if (usedCount >= 3) continue;

    const lastUsed = full.frontmatter.lastUsedAt
      ? new Date(full.frontmatter.lastUsedAt).getTime()
      : new Date(full.frontmatter.created).getTime();

    if (now - lastUsed > NINETY_DAYS_MS) {
      await archiveNote(note.slug, note.scope, cwd);
      archived.push(note.slug);
    }
  }

  return { archived };
}

// ── Search ────────────────────────────────────────────────────────────

export async function searchVault(
  query: string,
  cwd: string,
  opts?: VaultSearchOptions,
): Promise<VaultSearchResult[]> {
  const results: VaultSearchResult[] = [];
  const queryLower = query.toLowerCase();

  async function searchDir(vaultDir: string, scope: VaultScope): Promise<void> {
    const subdirs = ["memories", "concepts", "patterns", "projects", "references", "logs", "mocs"];
    for (const sub of subdirs) {
      const dir = path.join(vaultDir, sub);
      let files: string[];
      try {
        files = await fs.readdir(dir);
      } catch {
        continue;
      }

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const slug = file.replace(/\.md$/, "");
        const filePath = path.join(dir, file);
        try {
          const raw = await fs.readFile(filePath, "utf-8");
          const { frontmatter, body } = parseFrontmatter(raw);

          if (opts?.type && frontmatter.type !== opts.type) continue;

          const lines = body.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              results.push({
                slug,
                scope,
                title: extractTitle(body),
                type: frontmatter.type,
                memoryType: frontmatter.memoryType,
                matchLine: lines[i].trim(),
                lineNumber: i + 1,
              });
              break; // one result per note
            }
          }

          // Also match against slug and tags
          if (
            !results.some((r) => r.slug === slug && r.scope === scope) &&
            (slug.includes(queryLower) ||
              frontmatter.tags.some((t) => t.toLowerCase().includes(queryLower)))
          ) {
            results.push({
              slug,
              scope,
              title: extractTitle(body),
              type: frontmatter.type,
              memoryType: frontmatter.memoryType,
              matchLine: `[matched in slug/tags]`,
              lineNumber: 0,
            });
          }
        } catch {
          // skip unreadable
        }
      }
    }
  }

  if (!opts?.scope || opts.scope === "global") {
    await searchDir(GLOBAL_VAULT_DIR, "global");
  }
  if (!opts?.scope || opts.scope === "workspace") {
    await searchDir(path.join(cwd, WORKSPACE_VAULT_DIR), "workspace");
  }

  return results;
}

// ── Graph ─────────────────────────────────────────────────────────────

export async function buildVaultGraph(cwd: string): Promise<VaultGraphNode[]> {
  const allNotes = await listVaultNotes(cwd);

  // Build slug → node map
  const nodes = new Map<string, VaultGraphNode>();
  for (const note of allNotes) {
    nodes.set(note.slug, {
      slug: note.slug,
      scope: note.scope,
      type: note.type,
      title: note.title,
      forwardLinks: note.forwardLinks,
      backlinks: [],
    });
  }

  // Compute backlinks
  for (const node of nodes.values()) {
    for (const link of node.forwardLinks) {
      const target = nodes.get(link);
      if (target) {
        target.backlinks.push(node.slug);
      }
    }
  }

  return Array.from(nodes.values());
}

// ── Inbox ─────────────────────────────────────────────────────────────

export async function captureToInbox(
  content: string,
  scope: VaultScope,
  cwd?: string,
): Promise<void> {
  await ensureVaultDirs(scope, cwd);
  const vaultDir = getVaultDir(scope, cwd);
  const inboxPath = path.join(vaultDir, "_inbox.md");

  const timestamp = new Date().toISOString();
  const entry = `\n---\n**${timestamp}**\n${content}\n`;

  await fs.appendFile(inboxPath, entry, "utf-8");
}

// ── Archive ───────────────────────────────────────────────────────────

export async function archiveNote(
  slug: string,
  scope: VaultScope,
  cwd?: string,
): Promise<boolean> {
  const existing = await readVaultNote(slug, scope, cwd);
  if (!existing) return false;

  const vaultDir = getVaultDir(scope, cwd);
  const archiveDir = path.join(vaultDir, "_archive");
  await fs.mkdir(archiveDir, { recursive: true });

  const archivePath = path.join(archiveDir, `${slug}.md`);
  await fs.rename(existing.path, archivePath);
  return true;
}

export async function listArchivedNotes(cwd: string): Promise<VaultNoteListItem[]> {
  const items: VaultNoteListItem[] = [];

  async function readArchive(vaultDir: string, scope: VaultScope): Promise<void> {
    const archiveDir = path.join(vaultDir, "_archive");
    let files: string[];
    try {
      files = await fs.readdir(archiveDir);
    } catch {
      return;
    }

    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const slug = file.replace(/\.md$/, "");
      try {
        const raw = await fs.readFile(path.join(archiveDir, file), "utf-8");
        const { frontmatter, body } = parseFrontmatter(raw);
        items.push({
          slug,
          scope,
          type: frontmatter.type,
          memoryType: frontmatter.memoryType,
          title: extractTitle(body),
          tags: frontmatter.tags,
          preview: extractPreview(body),
          updated: frontmatter.updated,
          forwardLinks: extractWikilinks(body),
          backlinks: [],
        });
      } catch {
        // skip
      }
    }
  }

  await readArchive(GLOBAL_VAULT_DIR, "global");
  await readArchive(path.join(cwd, WORKSPACE_VAULT_DIR), "workspace");

  return items;
}

export async function restoreNote(
  slug: string,
  scope: VaultScope,
  cwd?: string,
): Promise<boolean> {
  const vaultDir = getVaultDir(scope, cwd);
  const archivePath = path.join(vaultDir, "_archive", `${slug}.md`);

  try {
    const raw = await fs.readFile(archivePath, "utf-8");
    const { frontmatter } = parseFrontmatter(raw);
    const subdir = noteTypeToSubdir(frontmatter.type);
    const targetPath = path.join(vaultDir, subdir, `${slug}.md`);

    await fs.mkdir(path.join(vaultDir, subdir), { recursive: true });
    await fs.rename(archivePath, targetPath);
    return true;
  } catch {
    return false;
  }
}
