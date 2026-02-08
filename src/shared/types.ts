// Types shared between main and renderer processes

export interface AgentEvent {
  type:
    | "text_delta"
    | "thinking_delta"
    | "tool_start"
    | "tool_update"
    | "tool_end"
    | "message_start"
    | "message_end"
    | "agent_start"
    | "agent_end"
    | "memory_created" // emitted when agent auto-creates a memory
    | "canvas_update"   // emitted when agent renders/updates canvas UI
    | "error"
    | "status"
    | "command_result"
    | "compaction_start"
    | "compaction_end"
    | "session_switched";
  data: any;
}

export interface SessionInfo {
  id: string;
  file: string;
  name?: string;
  firstMessage: string;
  messageCount: number;
  timestamp: number;
  cwd: string;
}

export interface ModelInfo {
  provider: string;
  id: string;
  name: string;
  isActive: boolean;
}

export interface StatusInfo {
  isStreaming: boolean;
  model?: string;
  thinkingLevel?: string;
  sessionId?: string;
  cwd: string;
}

export interface CommandInfo {
  name: string;
  description: string;
  source: "builtin" | "extension" | "prompt" | "skill";
}

// Session tree / fork types for /tree and /fork commands

export interface SessionTreeNodeInfo {
  id: string;
  parentId: string | null;
  entryType: string; // 'message', 'compaction', 'branch_summary', etc.
  role?: string; // 'user', 'assistant', 'toolResult' (only for message entries)
  text: string; // preview text
  children: SessionTreeNodeInfo[];
  isActive: boolean; // is this the current leaf?
  label?: string;
}

export interface ForkableMessage {
  entryId: string;
  text: string;
}

export interface TreeNavigateResult {
  editorText?: string;
  cancelled: boolean;
  aborted?: boolean;
}

export interface ForkResult {
  selectedText: string;
  cancelled: boolean;
}

export interface HistoryToolCall {
  id: string;
  name: string;
  input?: any;
  output?: string;
  isError?: boolean;
}

export interface HistoryMessage {
  role: "user" | "assistant" | "compaction";
  content: string;
  thinking?: string;
  tools?: HistoryToolCall[];
  timestamp: number;
  compaction?: {
    summary: string;
    tokensBefore?: number;
  };
}

// --- Subagent types ---

export interface SubagentSpawnConfig {
  name: string;
  task: string;
  model?: string;        // "provider/model-id"
  thinkingLevel?: string;
  persistent?: boolean;
  /** If false, the spawned agent will not receive the spawn_agents tool. */
  canSpawn?: boolean;
}

export interface SubagentInfo {
  id: string;
  name: string;
  model?: string;
  isStreaming: boolean;
  messageCount: number;
  createdAt: number;
}

export interface SubagentEvent {
  subagentId: string;
  event: AgentEvent;
}

export interface BusMessage {
  from: string;      // agent name
  fromId: string;    // agent id ("main" for main session)
  to: string;        // agent name or "*"
  toId: string;      // agent id or "*"
  content: string;
  timestamp: number;
}

// --- Git types ---

export interface GitFileStatus {
  file: string;
  status: "M" | "A" | "D" | "R" | "C" | "U" | "?";
  staged: boolean;
}

export interface GitStatusResult {
  isRepo: boolean;
  branch: string;
  files: GitFileStatus[];
  ahead: number;
  behind: number;
}

export interface GitBranchInfo {
  current: string;
  branches: string[];
}

// --- Memory types ---

// --- Notes ---

export interface NoteItem {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  timestamp: number;
}

export type MemoryType = "summary" | "fact" | "preference" | "decision" | "tag";

export interface MemoryItem {
  id: string;
  type: MemoryType;
  content: string;
  tags?: string[];
  timestamp: number;
  source?: "manual" | "auto-extracted" | "agent-created" | "auto-summary";  // NEW
  workspace?: string;
}

// --- Skills ---

export interface SkillPermissions {
  filesystem?: string[]; // allowed path roots
  network?: boolean;
  commands?: string[]; // allowed commands
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  permissions: SkillPermissions;
  createdAt: number;
  updatedAt: number;
}

// --- Heartbeat ---

export interface HeartbeatState {
  enabled: boolean;
  intervalMs: number;
  lastCheckAt: number | null;
  nextCheckAt: number | null;
  checkCount: number;
}

// --- Telemetry ---

export interface TelemetryEntry {
  id: string;
  timestamp: number;
  kind: string;
  success: boolean;
  durationMs?: number;
  error?: string;
  meta?: Record<string, any>;
}

// --- Project Context ---

export interface ProjectContext {
  workspace: string;
  summary: string;
  techStack?: string;
  conventions?: string;
  keyFiles?: string;
  updatedAt: number;
}

// --- API Keys (BYOK) ---

/** Known provider IDs that the tau SDK supports */
export type ProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "groq"
  | "xai"
  | "mistral"
  | "openrouter"
  | "cerebras";

export interface ApiKeyEntry {
  provider: ProviderId;
  key: string;
  /** User-friendly label, e.g. "Anthropic" */
  label: string;
  updatedAt: number;
}

/** Provider metadata for UI display */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  /** The environment variable name the SDK checks */
  envVar: string;
  placeholder: string;
}
