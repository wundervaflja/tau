// Unified vault types — memories + knowledge notes stored as markdown files

export type VaultNoteType =
  | "memory"
  | "concept"
  | "pattern"
  | "project"
  | "reference"
  | "log"
  | "moc";

export type MemorySubtype = "fact" | "preference" | "decision" | "summary";

export type VaultScope = "global" | "workspace";

export interface VaultNoteFrontmatter {
  type: VaultNoteType;
  memoryType?: MemorySubtype; // only when type="memory"
  tags: string[];
  created: string; // ISO 8601
  updated: string; // ISO 8601
  source?: "manual" | "auto-extracted" | "agent-created" | "auto-summary"; // only when type="memory"
  usedCount?: number; // only when type="memory": reinforcement count
  lastUsedAt?: string; // only when type="memory": ISO 8601
  aliases?: string[];
}

export interface VaultNote {
  slug: string;
  scope: VaultScope;
  type: VaultNoteType;
  memoryType?: MemorySubtype;
  title: string;
  content: string; // markdown body (without frontmatter)
  frontmatter: VaultNoteFrontmatter;
  path: string; // absolute file path
  created: string;
  updated: string;
}

export interface VaultNoteListItem {
  slug: string;
  scope: VaultScope;
  type: VaultNoteType;
  memoryType?: MemorySubtype;
  title: string;
  tags: string[];
  preview: string; // first non-empty line
  updated: string;
  forwardLinks: string[];
  backlinks: string[];
}

export interface VaultSearchResult {
  slug: string;
  scope: VaultScope;
  title: string;
  type: VaultNoteType;
  memoryType?: MemorySubtype;
  matchLine: string;
  lineNumber: number;
}

export interface VaultGraphNode {
  slug: string;
  scope: VaultScope;
  type: VaultNoteType;
  title: string;
  forwardLinks: string[];
  backlinks: string[];
}

export interface VaultCreateOptions {
  title: string;
  type: VaultNoteType;
  memoryType?: MemorySubtype;
  tags?: string[];
  scope: VaultScope;
  content?: string; // markdown body
  source?: VaultNoteFrontmatter["source"];
  cwd?: string; // required for workspace scope
}

export interface VaultListOptions {
  type?: VaultNoteType;
  memoryType?: MemorySubtype;
  scope?: VaultScope; // if omitted, list from both scopes
  tags?: string[];
}

export interface VaultSearchOptions {
  scope?: VaultScope; // if omitted, search both scopes
  type?: VaultNoteType;
}
