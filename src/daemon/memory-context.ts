/**
 * Shared helper for building memory context strings.
 *
 * Reads from SOUL.md, project context, and unified vault (memory notes).
 * Used by handlers.ts and task-watcher.ts when injecting context
 * into agent and subagent prompts.
 */
import { readSoul, readProposals } from "../soul-store";
import { listMemoryNotes, reinforceMemoryNote } from "../vault-store";
import { getProjectContext } from "../stores";
import { parseSoulSections } from "../shared/soul-types";

/**
 * Build a formatted memory context string for the given workspace.
 * Returns an empty string if no relevant context exists or on error.
 */
export async function buildMemoryContext(cwd: string): Promise<string> {
  try {
    const parts: string[] = [];

    // 1. SOUL personality summary
    try {
      const soulContent = await readSoul();
      if (soulContent) {
        const sections = parseSoulSections(soulContent);
        const whoIAm = sections.find((s) => s.name === "Who I Am")?.content;
        const voice = sections.find((s) => s.name === "Voice")?.content;
        if (whoIAm || voice) {
          let soulPart = "SOUL (your personality):\n";
          if (whoIAm) soulPart += whoIAm.slice(0, 300) + "\n";
          if (voice) soulPart += "Voice: " + voice.slice(0, 200) + "\n";
          parts.push(soulPart.trim());
        }
      }
    } catch {
      // Skip soul context if unavailable
    }

    // 2. Project context
    try {
      const projectCtx = await getProjectContext(cwd);
      if (projectCtx) {
        let ctxPart = "PROJECT CONTEXT:\n";
        ctxPart += projectCtx.summary + "\n";
        if (projectCtx.techStack) ctxPart += "Tech stack: " + projectCtx.techStack + "\n";
        if (projectCtx.conventions) ctxPart += "Conventions: " + projectCtx.conventions + "\n";
        parts.push(ctxPart.trim());
      }
    } catch {
      // Skip project context if unavailable
    }

    // 3. Vault memory notes
    try {
      const memoryNotes = await listMemoryNotes(cwd);
      if (memoryNotes.length > 0) {
        // Filter out decayed: skip non-preferences unused >90d with usedCount < 3
        const now = Date.now();
        const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
        const active = memoryNotes.filter((note) => {
          if (note.memoryType === "preference") return true;
          const lastUsed = note.updated
            ? new Date(note.updated).getTime()
            : 0;
          if (now - lastUsed > NINETY_DAYS_MS) return false;
          return true;
        });

        // Take top 20 sorted by updated desc
        const top = active.slice(0, 20);

        if (top.length > 0) {
          // Group by memoryType
          const groups: Record<string, string[]> = {
            preference: [], fact: [], decision: [], summary: [],
          };
          for (const note of top) {
            const key = note.memoryType && groups[note.memoryType] ? note.memoryType : "fact";
            groups[key].push(note.title + (note.preview ? ": " + note.preview : ""));

            // Auto-reinforce: bump usedCount for memories included in context
            reinforceMemoryNote(note.slug, note.scope, cwd).catch(() => {});
          }

          let memPart = "MEMORY:\n";
          const sectionDefs: [string, string][] = [
            ["preference", "Preferences"],
            ["fact", "Facts"],
            ["decision", "Decisions"],
            ["summary", "Recent activity"],
          ];
          for (const [key, label] of sectionDefs) {
            if (groups[key].length > 0) {
              memPart += `${label}:\n`;
              for (const item of groups[key]) memPart += `- ${item}\n`;
            }
          }
          parts.push(memPart.trim());
        }
      }
    } catch {
      // Skip memory notes if unavailable
    }

    // 4. Soul proposals notification
    try {
      const proposals = await readProposals();
      if (proposals && proposals.proposals.length > 0) {
        parts.push(
          `SOUL UPDATE: You have ${proposals.proposals.length} pending soul proposals. Ask the user if they'd like to review them.`
        );
      }
    } catch {
      // Skip proposals if unavailable
    }

    if (parts.length === 0) return "";
    return parts.join("\n\n");
  } catch {
    return "";
  }
}
