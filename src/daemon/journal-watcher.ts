/**
 * JournalWatcher — watches journal/ directory for changes and extracts
 * memories from new paragraphs.
 *
 * Uses `fs.watch` with debounce (like TaskWatcher). On change, diffs
 * the file against a cached snapshot to find new paragraphs, then sends
 * them to the LLM for memory extraction.
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import type { AgentHost } from "./agent-host";
import { buildMemoryContext } from "./memory-context";

const DEBOUNCE_MS = 1500; // longer than TaskWatcher — give user time to finish typing
const JOURNAL_DIR = "journal";

export class JournalWatcher {
  private watcher: fs.FSWatcher | null = null;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private cwd: string;
  private host: AgentHost;

  /** Cached file contents — used to detect new paragraphs via diff. */
  private snapshots = new Map<string, string>();

  /** Files currently being processed — prevent re-entrant extraction. */
  private processing = new Set<string>();

  constructor(cwd: string, host: AgentHost) {
    this.cwd = cwd;
    this.host = host;
  }

  // ── Public API ──────────────────────────────────────────────────────

  async start(): Promise<void> {
    this.stop();
    const dir = path.join(this.cwd, JOURNAL_DIR);

    // Seed snapshots from existing files so we don't process old content
    await this.seedSnapshots(dir);

    try {
      this.watcher = fs.watch(dir, { persistent: false }, (_event, filename) => {
        if (filename && filename.endsWith(".md")) {
          this.scheduleProcess(filename);
        }
      });
      this.watcher.on("error", () => {
        // Directory may not exist yet — watch parent for its creation
        this.stop();
        this.watchForDirectoryCreation();
      });
      console.log("[daemon] JournalWatcher: watching", dir);
    } catch {
      // Directory doesn't exist — watch for its creation
      this.watchForDirectoryCreation();
    }
  }

  stop(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  setCwd(cwd: string): void {
    this.cwd = cwd;
    this.snapshots.clear();
    this.processing.clear();
    this.start();
  }

  // ── Internal: directory creation watch ─────────────────────────────

  private watchForDirectoryCreation(): void {
    try {
      const dirWatcher = fs.watch(this.cwd, { persistent: false }, (_event, filename) => {
        if (filename === JOURNAL_DIR) {
          console.log("[daemon] JournalWatcher: journal/ appeared — starting watch");
          dirWatcher.close();
          this.start();
        }
      });
      dirWatcher.on("error", () => dirWatcher.close());
    } catch {
      // cwd doesn't exist — nothing to do
    }
  }

  // ── Internal: snapshot seeding ─────────────────────────────────────

  private async seedSnapshots(dir: string): Promise<void> {
    try {
      const files = await fsp.readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        try {
          const content = await fsp.readFile(path.join(dir, file), "utf-8");
          this.snapshots.set(file, content);
        } catch {
          // skip unreadable
        }
      }
    } catch {
      // dir doesn't exist yet
    }
  }

  // ── Internal: change detection & processing ────────────────────────

  private scheduleProcess(filename: string): void {
    const existing = this.debounceTimers.get(filename);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      filename,
      setTimeout(() => {
        this.debounceTimers.delete(filename);
        this.processFile(filename).catch((err) => {
          console.error(`[daemon] JournalWatcher: error processing ${filename}:`, err);
        });
      }, DEBOUNCE_MS),
    );
  }

  private async processFile(filename: string): Promise<void> {
    if (this.processing.has(filename)) return;
    this.processing.add(filename);

    try {
      const filePath = path.join(this.cwd, JOURNAL_DIR, filename);
      let newContent: string;
      try {
        newContent = await fsp.readFile(filePath, "utf-8");
      } catch {
        // File was deleted — remove snapshot
        this.snapshots.delete(filename);
        return;
      }

      const oldContent = this.snapshots.get(filename) ?? "";
      this.snapshots.set(filename, newContent);

      // Find new paragraphs
      const newParagraphs = extractNewParagraphs(oldContent, newContent);
      if (newParagraphs.length === 0) return;

      // Send to LLM for memory extraction
      const agent = this.host.getAgentManager();
      if (!agent) {
        console.log("[daemon] JournalWatcher: agent not ready, skipping");
        return;
      }

      const cwd = this.host.getCwd() || process.cwd();
      let memoryContext = "";
      try {
        memoryContext = await buildMemoryContext(cwd);
      } catch {
        // proceed without
      }

      const prompt = [
        memoryContext ? `[CONTEXT]\n${memoryContext}\n[/CONTEXT]\n` : "",
        "You are processing new journal entries. The user just wrote the following in their journal.",
        `Source file: journal/${filename}`,
        "",
        "---",
        newParagraphs.join("\n\n"),
        "---",
        "",
        "Extract any meaningful information from these paragraphs and create memories using create_memory.",
        "Focus on:",
        "- Facts worth remembering (preferences, decisions, technical findings, people, project details)",
        "- Decisions made and their reasoning",
        "- Preferences expressed",
        "",
        "Rules:",
        "- Only create memories for genuinely useful information. Skip filler, venting, or stream-of-consciousness.",
        "- If there's nothing worth memorizing, do nothing. Don't force it.",
        "- Keep memory titles short and searchable.",
        "- Don't create duplicates of things already in your memory context above.",
        "- Do NOT respond to the user or produce any chat output. Just create memories silently.",
      ]
        .filter(Boolean)
        .join("\n");

      console.log(
        `[daemon] JournalWatcher: processing ${newParagraphs.length} new paragraph(s) from ${filename}`,
      );

      try {
        agent.setSilent(true);
        await agent.prompt(prompt);
      } finally {
        agent.setSilent(false);
      }
    } finally {
      this.processing.delete(filename);
    }
  }
}

// ── Paragraph diffing ───────────────────────────────────────────────────

/**
 * Split content into paragraphs (blocks separated by blank lines).
 * Returns paragraphs that appear in `newContent` but not in `oldContent`.
 */
function extractNewParagraphs(oldContent: string, newContent: string): string[] {
  const oldParas = toParagraphs(oldContent);
  const newParas = toParagraphs(newContent);

  const oldSet = new Set(oldParas.map((p) => p.trim()));

  return newParas.filter((p) => {
    const trimmed = p.trim();
    // Skip empty, headings-only, or already-known paragraphs
    if (!trimmed) return false;
    if (trimmed.startsWith("#") && !trimmed.includes("\n")) return false;
    return !oldSet.has(trimmed);
  });
}

function toParagraphs(content: string): string[] {
  return content.split(/\n\s*\n/).filter((p) => p.trim().length > 0);
}
