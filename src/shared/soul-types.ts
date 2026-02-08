// Soul system types — SOUL.md personality file, bootstrap, and evolution

export interface SoulSection {
  name: string;
  content: string;
}

export interface SoulStatus {
  exists: boolean;
  needsBootstrap: boolean;
  path: string;
  sections: SoulSection[];
  lastModified: number;
}

export interface SoulProposal {
  id: string;
  section: string;
  action: "add" | "update" | "contradiction";
  currentEntry?: string;
  proposedEntry: string;
  evidence: string;
  sessionRef?: string;
}

export interface SoulProposalsFile {
  generated: string; // ISO 8601
  sessionsAnalyzed: number;
  proposals: SoulProposal[];
  reinforcements: string[];
  skipped: string[];
}

/** Checks whether SOUL.md content needs bootstrapping (has placeholder/empty sections). */
export function needsBootstrap(content: string): boolean {
  if (!content || !content.trim()) return true;
  const sections = parseSoulSections(content);
  // No sections at all — needs bootstrap
  if (sections.length === 0) return true;
  // Check if ALL sections are placeholders/empty — that means it's a template
  const allPlaceholder = sections.every((s) => {
    const body = s.content.trim();
    if (!body) return true;
    if (body.startsWith("[") && body.includes("discovered")) return true;
    if (body.startsWith("TODO")) return true;
    if (body === "...") return true;
    return false;
  });
  if (allPlaceholder) return true;
  // Has at least some real content — no bootstrap needed
  return false;
}

/** Parse SOUL.md content into sections. */
export function parseSoulSections(content: string): SoulSection[] {
  const sections: SoulSection[] = [];
  const sectionRegex = /^##\s+(.+)$/gm;
  let lastMatch: RegExpExecArray | null = null;
  let prevName = "";
  let prevStart = 0;

  while ((lastMatch = sectionRegex.exec(content)) !== null) {
    if (prevName) {
      sections.push({
        name: prevName,
        content: content.slice(prevStart, lastMatch.index).trim(),
      });
    }
    prevName = lastMatch[1].trim();
    prevStart = lastMatch.index + lastMatch[0].length;
  }

  if (prevName) {
    sections.push({
      name: prevName,
      content: content.slice(prevStart).trim(),
    });
  }

  return sections;
}
