/**
 * RPC method handlers for the tau-daemon.
 *
 * Defines all RPC methods as plain function params/returns
 * (no Electron IPC dependency).
 */
import fs from "node:fs/promises";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { RPC, NOTIFY } from "./protocol";

const execAsync = promisify(exec);
import type { AgentHost } from "./agent-host";
import type { DaemonServer } from "./server";
import type { RpcHandler } from "./server";
import type { Heartbeat } from "./heartbeat";
import type { ExtensionHost } from "./extension-host";
import {
  addNote,
  addTelemetry,
  deleteNote,
  deleteSkill,
  listNotes,
  listSkills,
  saveSkill,
  listApiKeys,
  setApiKey,
  deleteApiKey,
  getProjectContext,
  setProjectContext,
  listProjectContexts,
} from "../stores";
import type { ProviderId, ProviderInfo } from "../shared/types";
import {
  getAppConfig,
  getWorkspaceState,
  getRecentWorkspaces,
  setWorkspacePersona,
  setDefaultPersona,
  touchWorkspace,
  updateWorkspaceConfig,
} from "../workspace-store";
import { loadTasks, saveTasks } from "../task-store";
import {
  listJournalEntries,
  readJournalEntry,
  saveJournalEntry,
  createJournalEntry,
  createLinkedPage,
  deleteJournalEntry,
} from "../journal-store";
import type { PersonaId } from "../shared/workspace-types";
import { buildMemoryContext } from "./memory-context";
import {
  getSoulStatus,
  readSoul,
  writeSoul,
  readProposals,
  deleteProposals,
} from "../soul-store";
import {
  listVaultNotes,
  readVaultNote,
  createVaultNote,
  updateVaultNote,
  deleteVaultNote,
  searchVault,
  captureToInbox,
  buildVaultGraph,
  reinforceMemoryNote,
  decayMemoryNotes,
  listArchivedNotes,
  restoreNote,
  listMemoryNotes,
  createMemoryNote,
} from "../vault-store";

// ── Task save state (race-condition prevention) ──

const lastKnownTaskStatus = new Map<string, string>();
let taskSaveQueue: Promise<void> = Promise.resolve();

// ── Handler builder ─────────────────────────────────────────────────

export function buildHandlers(
  host: AgentHost,
  server: DaemonServer,
  heartbeat?: Heartbeat,
  extensionHost?: ExtensionHost,
): Record<string, RpcHandler> {
  const am = () => host.getAgentManager();
  const gm = () => host.getGitManager();

  /** Wait for agent to be ready, then return it (may still be null if init failed). */
  const waitForAgent = async () => {
    await host.ready;
    return am();
  };

  return {
    // ── Agent ──────────────────────────────────────────────────────
    [RPC.AGENT_PROMPT]: async (params) => {
      const agent = await waitForAgent();
      if (!agent) return { error: "Agent not initialized" };
      try {
        await agent.prompt(params?.[0] ?? params?.text);
        return { ok: true };
      } catch (err: any) {
        return { error: err.message };
      }
    },
    [RPC.AGENT_ABORT]: () => am()?.abort(),
    [RPC.AGENT_NEW_SESSION]: () => am()?.newSession(),
    [RPC.AGENT_STATUS]: () =>
      am()?.getStatus() ?? { isStreaming: false, cwd: process.cwd() },

    // ── Sessions ───────────────────────────────────────────────────
    [RPC.SESSION_DELETE]: async (params) => {
      try { await fs.rm(params?.[0] ?? params?.file); } catch { /* ignore */ }
    },
    [RPC.SESSION_DELETE_FOLDER]: async (params) => {
      const files = params?.[0] ?? params?.files ?? [];
      for (const f of files) {
        try { await fs.rm(f); } catch { /* ignore */ }
      }
    },
    [RPC.SESSION_RECOMPACT]: (params) =>
      am()?.recompact(params?.[0] ?? params?.instructions),
    [RPC.SESSION_LIST]: () => am()?.listSessions() ?? [],
    [RPC.SESSION_HISTORY]: () => am()?.getSessionHistory() ?? [],
    [RPC.SESSION_LIST_ALL]: () => am()?.listAllSessions() ?? [],
    [RPC.SESSION_SWITCH]: (params) =>
      am()?.switchSession(params?.[0] ?? params?.path),
    [RPC.SESSION_RENAME]: (params) =>
      am()?.renameSession(params?.[0] ?? params?.path, params?.[1] ?? params?.newName),
    [RPC.SESSION_GET_TREE]: () => am()?.getSessionTree() ?? [],
    [RPC.SESSION_NAVIGATE_TREE]: (params) =>
      am()?.navigateTree(params?.[0] ?? params?.targetId, params?.[1] ?? params?.opts),
    [RPC.SESSION_FORK]: (params) =>
      am()?.forkSession(params?.[0] ?? params?.entryId) ?? { selectedText: "", cancelled: true },
    [RPC.SESSION_GET_FORK_MESSAGES]: () =>
      am()?.getUserMessagesForForking() ?? [],
    [RPC.SESSION_LAST_ASSISTANT_TEXT]: () =>
      am()?.getLastAssistantTextForCopy() ?? null,
    [RPC.SESSION_EXPORT_HTML]: () =>
      am()?.exportSessionToHtml() ?? null,

    // ── Models ─────────────────────────────────────────────────────
    [RPC.MODEL_LIST]: () => am()?.listModels() ?? [],
    [RPC.MODEL_SET]: (params) =>
      am()?.setModel(params?.[0] ?? params?.provider, params?.[1] ?? params?.id),
    [RPC.MODEL_CURRENT]: () => am()?.getCurrentModel(),
    [RPC.MODEL_CYCLE]: () => am()?.cycleModel(),

    // ── Thinking ───────────────────────────────────────────────────
    [RPC.THINKING_GET]: () => am()?.getThinkingLevel() ?? "off",
    [RPC.THINKING_SET]: (params) =>
      am()?.setThinkingLevel(params?.[0] ?? params?.level),
    [RPC.THINKING_CYCLE]: () => am()?.cycleThinkingLevel(),

    // ── Commands ───────────────────────────────────────────────────
    [RPC.COMMAND_LIST]: () => am()?.getCommands() ?? [],

    // ── App ────────────────────────────────────────────────────────
    [RPC.APP_GET_CWD]: () => am()?.cwd ?? process.cwd(),
    [RPC.APP_OPEN_DIR]: async (params) => {
      const dir = params?.[0] ?? params?.dir;
      await host.setupAgent(dir);
      return dir;
    },

    // ── Memory (backed by vault) ───────────────────────────────────
    [RPC.MEMORY_LIST]: async () => {
      const cwd = am()?.cwd ?? process.cwd();
      const notes = await listMemoryNotes(cwd);
      return notes.map((n) => ({
        id: n.slug,
        type: (n.memoryType as any) || "fact",
        content: n.title + (n.preview ? ": " + n.preview : ""),
        tags: n.tags,
        timestamp: n.updated ? new Date(n.updated).getTime() : Date.now(),
        workspace: n.scope === "workspace" ? cwd : "",
        source: "vault" as any,
      }));
    },
    [RPC.MEMORY_ADD]: async (params) => {
      const item = params?.[0] ?? params;
      const cwd = am()?.cwd ?? process.cwd();
      const memoryType = ((item.type === "tag" ? "fact" : item.type) || "fact") as any;
      const note = await createMemoryNote({
        title: item.content?.slice(0, 80) || "Memory",
        content: item.content,
        memoryType,
        tags: item.tags || [],
        scope: "global",
        source: item.source || "manual",
        cwd,
      });
      return { ...item, id: note.slug };
    },
    [RPC.MEMORY_DELETE]: async (params) => {
      const id = params?.[0] ?? params?.id;
      const cwd = am()?.cwd ?? process.cwd();
      const deleted = await deleteVaultNote(id, "global", cwd);
      if (!deleted) await deleteVaultNote(id, "workspace", cwd);
    },

    // ── Notes ──────────────────────────────────────────────────────
    [RPC.NOTES_LIST]: () => listNotes(),
    [RPC.NOTES_ADD]: (params) => addNote(params?.[0] ?? params),
    [RPC.NOTES_DELETE]: (params) => deleteNote(params?.[0] ?? params?.id),

    // ── Journal ────────────────────────────────────────────────────
    [RPC.JOURNAL_LIST]: () => {
      const cwd = am()?.cwd ?? process.cwd();
      return listJournalEntries(cwd);
    },
    [RPC.JOURNAL_READ]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return readJournalEntry(cwd, params?.[0] ?? params?.name);
    },
    [RPC.JOURNAL_SAVE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      const name = params?.[0] ?? params?.name;
      const content = params?.[1] ?? params?.content;
      return saveJournalEntry(cwd, name, content);
    },
    [RPC.JOURNAL_CREATE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return createJournalEntry(cwd, params?.[0] ?? params?.name);
    },
    [RPC.JOURNAL_CREATE_LINK]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return createLinkedPage(cwd, params?.[0] ?? params?.title);
    },
    [RPC.JOURNAL_DELETE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return deleteJournalEntry(cwd, params?.[0] ?? params?.name);
    },
    [RPC.JOURNAL_PROCESS_BLOCK]: async (params) => {
      // Spawn a Consigliere subagent — proactive personal chief of staff
      const text = params?.[0] ?? params?.text;
      const entryName = params?.[1] ?? params?.entryName;
      const cwd = am()?.cwd ?? process.cwd();
      const sm = am()?.subagentManager;
      if (!sm || !text) return { ok: false };

      const today = new Date().toISOString().slice(0, 10);

      const task = `You are the user's personal Consigliere — a proactive chief of staff who reads between the lines, connects dots, and takes action.

Today is ${today}. The user wrote this in their journal entry "${entryName}":

"${text}"

The journal folder is at "${cwd}/journal/" — you can read previous entries there for context.
The tasks file is at "${cwd}/tasks.md".

Analyze this deeply and ACT on everything you find. You have full authority to use all tools.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 1. TASKS & COMMITMENTS → tasks.md

Read "${cwd}/tasks.md" first, then append new tasks under "## Todo" as "- [ ] <description>".

Detect BOTH explicit and implicit:
- Explicit: #task, #todo tags
- Implicit: "I should...", "need to...", "don't forget...", "promised X...", "deadline is...", "have to...", "plan to..."
- Follow-ups: "Waiting on John's reply" → "- [ ] Follow up with John if no reply by [date+3 days]"
- "Sent the proposal" → "- [ ] Check if proposal was received"
- Meeting prep: "Meeting with Sarah Thursday" → "- [ ] Prepare for meeting with Sarah"

Do NOT create duplicates — check existing tasks first.

## 2. CALENDAR EVENTS → Apple Calendar

For meetings, appointments, flights, deadlines — create calendar events:
\`\`\`bash
osascript -e '
tell application "Calendar"
  tell calendar "Home"
    make new event with properties {summary:"<title>", start date:date "<date string>", end date:date "<date string>"}
  end tell
end tell'
\`\`\`
Date format: "Friday, February 13, 2026 at 2:00:00 PM"

Detect: "meeting with X on Thursday", "flight at 6pm", "dentist appointment March 3", "deadline Friday", "call at 2pm".
For all-day events, use start of day to end of day.

## 3. REMINDERS → Apple Reminders

For time-sensitive items the user might forget:
\`\`\`bash
osascript -e 'tell application "Reminders" to make new reminder with properties {name:"<text>"}'
\`\`\`

With due date:
\`\`\`bash
osascript -e 'tell application "Reminders" to make new reminder with properties {name:"<text>", due date:date "Friday, February 13, 2026 at 9:00:00 AM"}'
\`\`\`

Detect: #reminder tags, deadlines, "tomorrow I need to...", "by Friday", "don't forget to..."
Auto-create follow-up reminders: "Waiting on X" → reminder in 3 days, "Sent invoice" → reminder in 7 days.

## 4. APPLE NOTES → save_note tool

For longer-form ideas, plans, lists, or structured content — save to Apple Notes using the save_note tool.
Detect: #note tag, project plans, brainstorms, lists of ideas, multi-paragraph thoughts.
Clean up and format nicely with HTML before saving.

## 5. MEMORIES → create_memory tool

Save to long-term memory for facts worth remembering:
- People: names, roles, relationships ("John is the CTO of Acme")
- Decisions: "Decided to use Postgres instead of MySQL"
- Preferences: "I prefer morning meetings"
- Goals: "Want to launch by March"
- Important dates: birthdays, anniversaries, deadlines
- Project context: what's being worked on, tech stack, status

Tag richly: ["people", "john", "acme"], ["project", "launch", "deadline"], ["personal", "health"], ["mood", "energy"].

## 6. CROSS-ENTRY ANALYSIS

Read recent journal entries from "${cwd}/journal/" to connect dots:
- Detect recurring themes: "You've mentioned being tired multiple times this week" → memory tagged ["pattern", "health", "energy"]
- Link people across entries: "John was mentioned in 3 entries this week about the Acme project" → memory
- Track project momentum: "Project X has been mentioned daily — consider creating a dedicated project plan" → save_note
- Spot contradictions: "On Monday you said deadline is Friday, but today you wrote next week"

Only read the last 5 entries max — don't over-analyze.

## 7. MOOD & ENERGY TRACKING

Detect emotional state and energy levels from language:
- Positive: "excited", "great progress", "feeling good", "productive day"
- Negative: "exhausted", "frustrated", "stuck", "overwhelmed", "stressed"
- Neutral: factual statements, plans

Save as memory: create_memory with type "fact", tagged ["journal", "mood", "${today}"] or ["journal", "energy", "${today}"].
Example: "User felt frustrated about slow progress on the API refactor on ${today}"

## 8. DAILY DIGEST (when processing last block of the day)

If the entry seems complete (substantial content, end-of-day reflections), save an Apple Note as a daily digest:
- Title: "Daily Digest — ${today}"
- Content: Summary of what was accomplished, open items, mood, and tomorrow's priorities
- Use save_note tool with folder "Tau Digests"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## RULES
- Be DECISIVE — act first, the user trusts you.
- Don't ask questions — infer and execute.
- Don't create duplicates — check tasks.md and recent entries before acting.
- Don't act on past/completed events — only forward-looking.
- If the text is truly trivial (single word, greeting, etc.) — do nothing.
- Use bash for osascript commands. Use read/write for file operations.
- Multiple actions from one block is GOOD — extract everything.`;

      try {
        const results = await sm.spawn([{ name: `journal:consigliere`, task }]);
        return { ok: true, subagentId: results[0]?.id };
      } catch (err: any) {
        console.error("[journal] Failed to spawn consigliere:", err);
        return { ok: false, error: err.message };
      }
    },

    // ── Git ────────────────────────────────────────────────────────
    // All git handlers must gracefully handle non-git directories
    [RPC.GIT_STATUS]: async () => {
      try { return await gm()?.getStatus() ?? { isRepo: false, branch: "", files: [], ahead: 0, behind: 0 }; }
      catch { return { isRepo: false, branch: "", files: [], ahead: 0, behind: 0 }; }
    },
    [RPC.GIT_BRANCHES]: async () => {
      try { return await gm()?.getBranches() ?? { current: "", branches: [] }; }
      catch { return { current: "", branches: [] }; }
    },
    [RPC.GIT_CHECKOUT]: (params) =>
      gm()?.checkout(params?.[0], params?.[1]),
    [RPC.GIT_CHECKOUT_NEW]: (params) =>
      gm()?.checkoutNewBranch(params?.[0] ?? params?.name),
    [RPC.GIT_STAGE]: (params) => gm()?.stageFile(params?.[0] ?? params?.file),
    [RPC.GIT_UNSTAGE]: (params) => gm()?.unstageFile(params?.[0] ?? params?.file),
    [RPC.GIT_STAGE_ALL]: () => gm()?.stageAll(),
    [RPC.GIT_DISCARD]: (params) => gm()?.discardFile(params?.[0] ?? params?.file),
    [RPC.GIT_DIFF]: (params) =>
      gm()?.getDiff(params?.[0] ?? params?.file, params?.[1] ?? params?.staged),

    // ── Files ──────────────────────────────────────────────────────
    [RPC.FILES_LIST]: async (params) => {
      const query = (params?.[0] ?? "").toLowerCase();
      const cwd = am()?.cwd ?? process.cwd();
      try {
        let files: string[];
        try {
          // Try git ls-files first (respects .gitignore)
          const { stdout } = await execAsync("git ls-files --cached --others --exclude-standard", {
            cwd, timeout: 5000, maxBuffer: 1024 * 1024,
          });
          files = stdout.split("\n").filter(Boolean);
        } catch {
          // Fallback: basic find (exclude common dirs)
          const { stdout } = await execAsync(
            'find . -type f -not -path "./node_modules/*" -not -path "./.git/*" -not -path "./dist/*" -not -path "./__pycache__/*" -not -path "./venv/*" | head -5000',
            { cwd, timeout: 5000, maxBuffer: 1024 * 1024 },
          );
          files = stdout.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
        }
        if (query) {
          files = files.filter((f) => f.toLowerCase().includes(query));
        }
        return files.slice(0, 100);
      } catch (err: any) {
        console.error("[daemon] files.list error:", err.message);
        return [];
      }
    },

    // ── Symbols ─────────────────────────────────────────────────
    [RPC.SYMBOLS_SEARCH]: async (params) => {
      const query = (params?.[0] ?? "").toLowerCase();
      const file = params?.[1] ?? null; // optional: limit to specific file
      const cwd = am()?.cwd ?? process.cwd();
      try {
        // Regex patterns for TS/JS/Python symbols
        const patterns = [
          "^\\s*(export\\s+)?(async\\s+)?function\\s+\\w+",
          "^\\s*(export\\s+)?(default\\s+)?class\\s+\\w+",
          "^\\s*(export\\s+)?(type|interface)\\s+\\w+",
          "^\\s*(export\\s+)?const\\s+\\w+\\s*=",
          "^\\s*(export\\s+)?enum\\s+\\w+",
          "^\\s*(private|protected|public|static|async)\\s+\\w+\\s*[(<]",
          "^\\s*def\\s+\\w+",
          "^\\s*class\\s+\\w+",
        ];
        const pattern = patterns.join("|");
        const fileGlob = file
          ? `"${file}"`
          : '--glob "*.ts" --glob "*.tsx" --glob "*.js" --glob "*.jsx" --glob "*.py" --glob "*.rs"';

        const cmd = `rg -n --no-heading ${fileGlob} -e '${pattern}' 2>/dev/null | head -500`;
        const { stdout: out } = await execAsync(cmd, { cwd, timeout: 5000, maxBuffer: 1024 * 1024 });

        const results: { name: string; kind: string; file: string; line: number }[] = [];
        for (const raw of out.split("\n").filter(Boolean)) {
          const match = raw.match(/^([^:]+):(\d+):(.+)$/);
          if (!match) continue;
          const [, filePath, lineStr, content] = match;
          const line = parseInt(lineStr, 10);
          const trimmed = content.trim();

          // Extract symbol name and kind
          let name = "";
          let kind = "symbol";
          const fnMatch = trimmed.match(/(?:async\s+)?function\s+(\w+)/);
          const classMatch = trimmed.match(/class\s+(\w+)/);
          const ifaceMatch = trimmed.match(/(?:type|interface)\s+(\w+)/);
          const constMatch = trimmed.match(/(?:export\s+)?const\s+(\w+)/);
          const enumMatch = trimmed.match(/enum\s+(\w+)/);
          const methodMatch = trimmed.match(/(?:private|protected|public|static|async)\s+(\w+)\s*[(<]/);
          const pyFnMatch = trimmed.match(/def\s+(\w+)/);

          if (fnMatch) { name = fnMatch[1]; kind = "function"; }
          else if (classMatch) { name = classMatch[1]; kind = "class"; }
          else if (ifaceMatch) { name = ifaceMatch[1]; kind = trimmed.includes("interface") ? "interface" : "type"; }
          else if (enumMatch) { name = enumMatch[1]; kind = "enum"; }
          else if (constMatch) { name = constMatch[1]; kind = "const"; }
          else if (methodMatch) { name = methodMatch[1]; kind = "method"; }
          else if (pyFnMatch) { name = pyFnMatch[1]; kind = "function"; }
          else continue;

          results.push({ name, kind, file: filePath, line });
        }

        // Filter by query
        if (query) {
          return results.filter((r) =>
            r.name.toLowerCase().includes(query) ||
            r.file.toLowerCase().includes(query)
          ).slice(0, 50);
        }
        return results.slice(0, 50);
      } catch (err: any) {
        console.error("[daemon] symbols.search error:", err.message);
        return [];
      }
    },

    [RPC.SYMBOL_READ]: async (params) => {
      const file = params?.[0];
      const line = params?.[1];
      if (!file || !line) return { error: "file and line required" };
      const cwd = am()?.cwd ?? process.cwd();
      try {
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const fullPath = path.resolve(cwd, file);
        const content = await fs.readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const startLine = Math.max(0, line - 1);

        // Find the end of the symbol (next symbol at same/lower indent, or max 50 lines)
        const baseIndent = (lines[startLine]?.match(/^\s*/)?.[0] ?? "").length;
        let endLine = Math.min(lines.length, startLine + 50);
        for (let i = startLine + 1; i < endLine; i++) {
          const l = lines[i];
          if (!l || l.trim() === "") continue;
          const indent = (l.match(/^\s*/)?.[0] ?? "").length;
          // New symbol at same or lower indent level
          if (indent <= baseIndent && /^\s*(export\s+)?(async\s+)?(function|class|interface|type|const|enum|def\s)/.test(l)) {
            endLine = i;
            break;
          }
        }

        const snippet = lines.slice(startLine, endLine).join("\n");
        return { file, line, endLine, snippet };
      } catch (err: any) {
        return { error: err.message };
      }
    },

    // ── Subagents ──────────────────────────────────────────────────
    [RPC.SUBAGENT_SPAWN]: (params) =>
      am()?.subagentManager?.spawn(params?.[0] ?? params?.configs) ?? [],
    [RPC.SUBAGENT_PROMPT]: async (params) => {
      const sm = am()?.subagentManager;
      if (!sm) return { error: "Not initialized" };
      try {
        await sm.prompt(params?.[0], params?.[1]);
        return { ok: true };
      } catch (err: any) {
        return { error: err.message };
      }
    },
    [RPC.SUBAGENT_ABORT]: (params) =>
      am()?.subagentManager?.abort(params?.[0] ?? params?.id),
    [RPC.SUBAGENT_CLOSE]: (params) =>
      am()?.subagentManager?.close(params?.[0] ?? params?.id),
    [RPC.SUBAGENT_LIST]: () => am()?.subagentManager?.listAll() ?? [],
    [RPC.SUBAGENT_HISTORY]: (params) =>
      am()?.subagentManager?.getHistory(params?.[0] ?? params?.id) ?? [],
    [RPC.SUBAGENT_MESSAGE]: (params) =>
      am()?.subagentManager?.sendAgentMessage(params?.[0], params?.[1], params?.[2]) ?? "Not initialized",
    [RPC.SUBAGENT_BUS_HISTORY]: () =>
      am()?.subagentManager?.getBusHistory() ?? [],

    // ── Skills ─────────────────────────────────────────────────────
    [RPC.SKILL_LIST]: () => listSkills(),
    [RPC.SKILL_SAVE]: (params) => saveSkill(params?.[0] ?? params),
    [RPC.SKILL_DELETE]: (params) => deleteSkill(params?.[0] ?? params?.id),
    [RPC.SKILL_RUN]: async (params) => {
      const agent = am();
      if (!agent) return { error: "Agent not initialized" };
      const skills = await listSkills();
      const skill = skills.find((s) => s.id === (params?.[0] ?? params?.id));
      if (!skill) return { error: "Skill not found" };
      await agent.prompt(skill.prompt);
      return { ok: true };
    },
    // ── Heartbeat ─────────────────────────────────────────────────
    [RPC.HEARTBEAT_STATUS]: () => heartbeat?.getStatus() ?? null,
    [RPC.HEARTBEAT_SET_INTERVAL]: (params) =>
      heartbeat?.setInterval(params?.[0] ?? params?.ms),
    [RPC.HEARTBEAT_SET_ENABLED]: (params) =>
      heartbeat?.setEnabled(params?.[0] ?? params?.enabled),

    // ── Extensions ──────────────────────────────────────────────────
    [RPC.EXT_LIST]: () => extensionHost?.list() ?? [],
    [RPC.EXT_RELOAD]: async () => {
      await extensionHost?.reload();
      return { ok: true };
    },
    [RPC.EXT_TOOLS]: () => extensionHost?.getTools() ?? [],
    [RPC.EXT_CALL_TOOL]: async (params) => {
      if (!extensionHost) throw new Error("Extension host not available");
      const name = params?.[0] ?? params?.name;
      const toolParams = params?.[1] ?? params?.params ?? {};
      return extensionHost.callTool(name, toolParams);
    },

    // ── Telemetry ───────────────────────────────────────────────────
    [RPC.TELEMETRY_ADD]: (params) => addTelemetry(params?.[0] ?? params),

    // ── Agent-initiated ────────────────────────────────────────────
    [RPC.MEMORY_CREATE_FROM_AGENT]: async (params) => {
      const item = params?.[0] ?? params;
      const cwd = am()?.cwd ?? process.cwd();
      const memoryType = ((item.type === "tag" ? "fact" : item.type) || "fact") as any;
      const note = await createMemoryNote({
        title: item.content?.slice(0, 80) || "Memory",
        content: item.content,
        memoryType,
        tags: item.tags || [],
        scope: "global",
        source: item.source || "agent-created",
        cwd,
      });
      return { ...item, id: note.slug };
    },
    [RPC.SKILL_CREATE_FROM_AGENT]: (params) =>
      saveSkill(params?.[0] ?? params),

    // ── Proactive ──────────────────────────────────────────────────
    [RPC.AGENT_REFRESH_PROACTIVE]: async () => {
      const agent = am();
      if (!agent) return { error: "Agent not initialized" };
      await agent.refreshProactiveSystems();
      return { ok: true };
    },

    // ── Workspace ──────────────────────────────────────────────────
    [RPC.WORKSPACE_GET_STATE]: (params) =>
      getWorkspaceState(params?.[0] ?? params?.folderPath ?? am()?.cwd ?? ""),
    [RPC.WORKSPACE_LIST_RECENT]: () => getRecentWorkspaces(),
    [RPC.WORKSPACE_SET_PERSONA]: (params) =>
      setWorkspacePersona(params?.[0], params?.[1] as PersonaId | null),
    [RPC.WORKSPACE_UPDATE_CONFIG]: (params) =>
      updateWorkspaceConfig(params?.[0], (config) => ({ ...config, ...(params?.[1] ?? {}) })),
    [RPC.WORKSPACE_OPEN]: async (params) => {
      const folderPath = params?.[0] ?? params?.folderPath;
      await touchWorkspace(folderPath);
      await host.setupAgent(folderPath);
      return getWorkspaceState(folderPath);
    },

    // ── App Config ─────────────────────────────────────────────────
    [RPC.APP_GET_CONFIG]: () => getAppConfig(),
    [RPC.APP_SET_DEFAULT_PERSONA]: (params) =>
      setDefaultPersona((params?.[0] ?? params?.persona) as PersonaId),

    // ── Tasks ──────────────────────────────────────────────────────
    [RPC.TASKS_LOAD]: async () => {
      await host.ready;
      const cwd = am()?.cwd ?? process.cwd();
      const tasks = await loadTasks(cwd);
      lastKnownTaskStatus.clear();
      for (const t of tasks) lastKnownTaskStatus.set(t.id, t.status);
      return tasks;
    },
    [RPC.TASKS_SAVE]: (params) => {
      const incomingTasks = params?.[0] ?? params;
      taskSaveQueue = taskSaveQueue
        .then(() => handleTaskSave(host, server, incomingTasks))
        .catch((err) => console.error("[daemon] task save queue error:", err));
      return taskSaveQueue;
    },

    // ── API Keys (BYOK) ──────────────────────────────────────────
    [RPC.API_KEYS_LIST]: () => listApiKeys(),
    [RPC.API_KEYS_PROVIDERS]: (): ProviderInfo[] => [
      { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY", placeholder: "sk-ant-..." },
      { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY", placeholder: "sk-..." },
      { id: "google", label: "Google (Gemini)", envVar: "GEMINI_API_KEY", placeholder: "AI..." },
      { id: "groq", label: "Groq", envVar: "GROQ_API_KEY", placeholder: "gsk_..." },
      { id: "xai", label: "xAI (Grok)", envVar: "XAI_API_KEY", placeholder: "xai-..." },
      { id: "mistral", label: "Mistral", envVar: "MISTRAL_API_KEY", placeholder: "..." },
      { id: "openrouter", label: "OpenRouter", envVar: "OPENROUTER_API_KEY", placeholder: "sk-or-..." },
      { id: "cerebras", label: "Cerebras", envVar: "CEREBRAS_API_KEY", placeholder: "csk-..." },
    ],
    [RPC.API_KEYS_SET]: async (params) => {
      const provider = (params?.[0] ?? params?.provider) as ProviderId;
      const key = params?.[1] ?? params?.key;
      const label = params?.[2] ?? params?.label;
      const entry = await setApiKey(provider, key, label);
      // Apply the key to the agent's auth storage immediately
      const agent = am();
      if (agent) {
        agent.applyApiKey(provider, key);
      }
      return entry;
    },
    [RPC.API_KEYS_DELETE]: async (params) => {
      const provider = (params?.[0] ?? params?.provider) as ProviderId;
      await deleteApiKey(provider);
      // Remove the runtime key from the agent's auth storage
      const agent = am();
      if (agent) {
        agent.removeApiKey(provider);
      }
    },

    // ── Soul ──────────────────────────────────────────────────────
    [RPC.SOUL_STATUS]: () => getSoulStatus(),
    [RPC.SOUL_READ]: () => readSoul(),
    [RPC.SOUL_WRITE]: (params) => writeSoul(params?.[0] ?? params?.content),
    [RPC.SOUL_PROPOSALS_READ]: () => readProposals(),
    [RPC.SOUL_PROPOSALS_CLEAR]: () => deleteProposals(),

    // ── Vault (unified: memories + knowledge) ────────────────────
    [RPC.VAULT_LIST]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return listVaultNotes(cwd, params?.[0] ?? params);
    },
    [RPC.VAULT_READ]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return readVaultNote(params?.[0] ?? params?.slug, params?.[1] ?? params?.scope, cwd);
    },
    [RPC.VAULT_CREATE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      const opts = params?.[0] ?? params;
      return createVaultNote({ ...opts, cwd });
    },
    [RPC.VAULT_UPDATE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return updateVaultNote(
        params?.[0] ?? params?.slug,
        params?.[1] ?? params?.scope,
        params?.[2] ?? params?.body,
        cwd,
      );
    },
    [RPC.VAULT_DELETE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return deleteVaultNote(params?.[0] ?? params?.slug, params?.[1] ?? params?.scope, cwd);
    },
    [RPC.VAULT_SEARCH]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return searchVault(params?.[0] ?? params?.query, cwd, params?.[1] ?? params?.opts);
    },
    [RPC.VAULT_CAPTURE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return captureToInbox(params?.[0] ?? params?.content, params?.[1] ?? params?.scope, cwd);
    },
    [RPC.VAULT_GRAPH]: () => {
      const cwd = am()?.cwd ?? process.cwd();
      return buildVaultGraph(cwd);
    },
    [RPC.VAULT_REINFORCE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return reinforceMemoryNote(params?.[0] ?? params?.slug, params?.[1] ?? params?.scope, cwd);
    },
    [RPC.VAULT_DECAY_RUN]: () => {
      const cwd = am()?.cwd ?? process.cwd();
      return decayMemoryNotes(cwd);
    },
    [RPC.VAULT_ARCHIVE_LIST]: () => {
      const cwd = am()?.cwd ?? process.cwd();
      return listArchivedNotes(cwd);
    },
    [RPC.VAULT_RESTORE]: (params) => {
      const cwd = am()?.cwd ?? process.cwd();
      return restoreNote(params?.[0] ?? params?.slug, params?.[1] ?? params?.scope, cwd);
    },

    // ── Project Context ──────────────────────────────────────────
    [RPC.PROJECT_CTX_GET]: (params) =>
      getProjectContext(params?.[0] ?? params?.workspace ?? am()?.cwd ?? ""),
    [RPC.PROJECT_CTX_SET]: (params) =>
      setProjectContext(params?.[0] ?? params),
    [RPC.PROJECT_CTX_LIST]: () => listProjectContexts(),

    // ── GAL (Global Agent Lock) ─────────────────────────────────────
    [RPC.GAL_STATUS]: () => host.getGalCoordinator()?.getStatus() ?? { active: false, workerCount: 0, lockCount: 0, contentionCount: 0 },
    [RPC.GAL_LOCKS]: () => host.getGalCoordinator()?.getLocks() ?? [],

    // ── Daemon-specific ────────────────────────────────────────────
    [RPC.DAEMON_HEALTH]: () => ({
      ok: true,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      version: "1.0.0",
    }),
    [RPC.DAEMON_RECOVER]: async (params) => {
      // Return full state snapshot for client recovery
      const status = am()?.getStatus() ?? { isStreaming: false, cwd: process.cwd() };
      const history = (await am()?.getSessionHistory()) ?? [];
      const subagents = am()?.subagentManager?.listAll() ?? [];
      return {
        status,
        history,
        subagents,
        bufferedEvents: [],
        fullRecoveryRequired: true,
      };
    },
  };
}

// ── Task save logic ──────────────────────────────────────────────

async function handleTaskSave(
  host: AgentHost,
  server: DaemonServer,
  incomingTasks: any[],
): Promise<void> {
  // Wait for agent to be ready before checking subagentManager.
  // Without this, early saves race with setupAgent() and sm is always null.
  await host.ready;

  const agent = host.getAgentManager();
  const cwd = agent?.cwd ?? process.cwd();

  console.log(`[daemon] handleTaskSave: ${incomingTasks.length} task(s), cwd=${cwd}`);

  // Clear orphaned subagentIds — tasks assigned to subagents from a previous
  // daemon session that no longer exist.  This makes them eligible for re-spawn.
  const sm = agent?.subagentManager;
  for (const t of incomingTasks) {
    if (t.subagentId && t.status !== "done") {
      const alive = sm ? sm.listAll().some((s: any) => s.id === t.subagentId) : false;
      if (!alive) {
        console.log(`[daemon] Clearing orphaned subagentId "${t.subagentId}" from task "${t.text.slice(0, 40)}"`);
        delete t.subagentId;
        // Reset status tracking so the task is treated as a fresh todo transition
        lastKnownTaskStatus.delete(t.id);
      }
    }
  }

  const newTodoTasks = incomingTasks.filter(
    (t: any) => t.status === "todo" && !t.subagentId && lastKnownTaskStatus.get(t.id) !== "todo",
  );

  if (newTodoTasks.length > 0) {
    console.log(`[daemon] handleTaskSave: ${newTodoTasks.length} new todo task(s) detected:`,
      newTodoTasks.map((t: any) => `"${t.text}" (id=${t.id}, prevStatus=${lastKnownTaskStatus.get(t.id) ?? "unknown"})`));
  }

  for (const t of incomingTasks) lastKnownTaskStatus.set(t.id, t.status);

  if (newTodoTasks.length > 0 && !sm) {
    console.warn(`[daemon] handleTaskSave: ${newTodoTasks.length} todo task(s) but subagentManager is ${sm === null ? "null" : "undefined"} (agent=${agent ? "exists" : "null"})`);
  }

  if (newTodoTasks.length > 0 && sm) {
    console.log(`[daemon] ${newTodoTasks.length} task(s) moved to todo — spawning subagents`);

    let memoryContext = "";
    try {
      memoryContext = await buildMemoryContext(cwd);
    } catch { /* proceed without context */ }

    // Use the currently active model/thinking for subagent spawns
    const status = agent?.getStatus();
    const spawnModel = status?.model as string | undefined;
    const spawnThinking = status?.thinkingLevel as string | undefined;

    // Delegate to GAL coordinator if available, otherwise fall back to direct spawn
    const gal = host.getGalCoordinator();
    if (gal) {
      console.log("[daemon] Delegating to GAL coordinator");
      try {
        await gal.submitTasks(newTodoTasks, memoryContext, spawnModel, spawnThinking);
        // GAL's submitTasks sets subagentId and status on each task
        for (const task of newTodoTasks) {
          lastKnownTaskStatus.set(task.id, task.status);
        }
      } catch (err) {
        console.error("[daemon] GAL submission failed, falling back to direct spawn:", err);
        await directSpawnTasks(sm, newTodoTasks, memoryContext, lastKnownTaskStatus, spawnModel, spawnThinking);
      }
    } else {
      await directSpawnTasks(sm, newTodoTasks, memoryContext, lastKnownTaskStatus, spawnModel, spawnThinking);
    }
  }

  await saveTasks(cwd, incomingTasks);

  if (newTodoTasks.length > 0) {
    server.broadcast(NOTIFY.TASKS_CHANGED, incomingTasks);
  }
}

/** Fallback: direct spawn without GAL coordination. */
async function directSpawnTasks(
  sm: any,
  newTodoTasks: any[],
  memoryContext: string,
  statusMap: Map<string, string>,
  spawnModel?: string,
  spawnThinking?: string,
): Promise<void> {
  for (const task of newTodoTasks) {
    try {
      let prompt = task.text;
      if (memoryContext) {
        prompt = `[CONTEXT]\n${memoryContext}\n[/CONTEXT]\n\n${task.text}`;
      }

      const config: any = {
        name: task.text.slice(0, 40),
        task: prompt,
        canSpawn: false,
      };
      if (spawnModel) config.model = spawnModel;
      if (spawnThinking) config.thinkingLevel = spawnThinking;

      const results = await sm.spawn([config]);

      if (results.length > 0) {
        task.subagentId = results[0].id;
        task.status = "in-progress";
        task.done = false;
        statusMap.set(task.id, "in-progress");
      }
    } catch (err) {
      console.error(`[daemon] Failed to spawn subagent for task "${task.text}":`, err);
    }
  }
}
