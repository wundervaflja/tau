import type { AgentEvent, StatusInfo, ModelInfo, SessionInfo, CommandInfo, SubagentSpawnConfig, SubagentInfo, SubagentEvent, BusMessage, HistoryMessage, MemoryItem, SkillDefinition } from "./shared/types";
import { SubagentManager } from "./subagent-manager";
import {
  listSkills,
  saveSkill,
  deleteSkill,
  listApiKeys,
  getProjectContext,
  setProjectContext,
  incrementSessionCount,
  getSessionCount,
  resetEvolutionCounter,
} from "./stores";
import { readSoul, ensureSoulFile, getSoulStatus, readProposals, writeProposals, deleteProposals } from "./soul-store";
// parseSoulSections no longer needed — full SOUL content is injected directly
import {
  createMemoryNote,
  listMemoryNotes,
  reinforceMemoryNote,
  searchVault,
  createVaultNote,
  readVaultNote,
  updateVaultNote,
  captureToInbox,
  listVaultNotes,
} from "./vault-store";
import type { VaultScope, VaultNoteType, MemorySubtype } from "./shared/vault-types";

// Dynamic imports since the agent SDK is CommonJS/ESM and needs special handling in Electron main
let sdk: any = null;

async function loadPiSdk() {
  if (sdk) return sdk;
  sdk = await import("@mariozechner/pi-coding-agent");
  return sdk;
}

export class AgentManager {
  public cwd: string;
  private session: any = null;
  private authStorage: any = null;
  private modelRegistry: any = null;
  private onEvent: (event: AgentEvent) => void;
  private onSubagentEvent: ((evt: SubagentEvent) => void) | null = null;
  private onBusMessage: ((msg: BusMessage) => void) | null = null;
  private unsubscribe?: () => void;
  public subagentManager: SubagentManager | null = null;
  private _silent = false;
  private _soulNeedsBootstrap = false;

  /** When silent, agent events are suppressed (not sent to UI). Used for scheduled jobs. */
  setSilent(silent: boolean): void {
    this._silent = silent;
  }

  constructor(
    cwd: string,
    onEvent: (event: AgentEvent) => void,
    onSubagentEvent?: (evt: SubagentEvent) => void,
    onBusMessage?: (msg: BusMessage) => void,
  ) {
    this.cwd = cwd;
    // Wrap onEvent so _silent flag suppresses UI broadcasts
    this.onEvent = (event: AgentEvent) => {
      if (this._silent) {
        // Still log to console for debugging, but don't send to UI
        if (event.type === "error") {
          console.log(`[tau] [silent] error: ${(event.data as any)?.message}`);
        }
        return;
      }
      onEvent(event);
    };
    this.onSubagentEvent = onSubagentEvent ?? null;
    this.onBusMessage = onBusMessage ?? null;
  }

  async initialize() {
    const sdk = await loadPiSdk();
    const { createAgentSession, AuthStorage, ModelRegistry, SessionManager } = sdk;

    this.authStorage = new AuthStorage();

    // Apply any stored BYOK API keys before creating the model registry
    // so getAvailable() correctly reflects keys the user has configured.
    try {
      const storedKeys = await listApiKeys();
      for (const entry of storedKeys) {
        if (entry.key) {
          this.authStorage.setRuntimeApiKey(entry.provider, entry.key);
          console.log(`[tau] Applied stored API key for provider: ${entry.provider}`);
        }
      }
    } catch (err) {
      console.error("[tau] Failed to load stored API keys:", err);
    }

    this.modelRegistry = new ModelRegistry(this.authStorage);

    // Create subagent manager first so we can get custom tools
    this.subagentManager = new SubagentManager({
      cwd: this.cwd,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      onEvent: (evt) => this.onSubagentEvent?.(evt),
      onBusMessage: (msg) => {
        this.onBusMessage?.(msg);
        // If message targets "main", deliver to main session
        if (msg.toId === "main" && this.session) {
          this.subagentManager?.deliverToMainSession(this.session, msg);
        }
      },
      extraTools: this.buildSubagentExtraTools(),
    });

    const customTools = [
      ...this.subagentManager.buildMainTools(),
      ...this.buildMemoryAndSkillTools(),
      ...this.buildCanvasTools(),
    ];

    const { session } = await createAgentSession({
      cwd: this.cwd,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      sessionManager: SessionManager.create(this.cwd),
      customTools,
    });

    this.session = session;
    this.setupEventListeners();
    
    this.onEvent({
      type: "status",
      data: this.getStatus(),
    });

    // Ensure SOUL.md exists and check bootstrap need
    try {
      await ensureSoulFile();
      const soulStatus = await getSoulStatus();
      this._soulNeedsBootstrap = soulStatus.needsBootstrap;
      if (this._soulNeedsBootstrap) {
        console.log("[tau] SOUL.md needs bootstrap — will prompt on first message");
      }
    } catch (err) {
      console.error("[tau] Failed to check SOUL status:", err);
    }

    // Load workspace context into system prompt (note: memory will be injected before each new prompt)
    this.enrichSystemContext().catch(err => {
      console.error("[tau] Failed to enrich system context:", err);
    });

  }

  private setupEventListeners() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }

    this.unsubscribe = this.session.subscribe((event: any) => {
      switch (event.type) {
        case "message_update":
          if (event.assistantMessageEvent.type === "text_delta") {
            this.onEvent({
              type: "text_delta",
              data: { delta: event.assistantMessageEvent.delta },
            });
          } else if (event.assistantMessageEvent.type === "thinking_delta") {
            this.onEvent({
              type: "thinking_delta",
              data: { delta: event.assistantMessageEvent.delta },
            });
          }
          break;

        case "tool_execution_start":
          this.onEvent({
            type: "tool_start",
            data: {
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              input: event.input,
            },
          });
          break;

        case "tool_execution_update":
          this.onEvent({
            type: "tool_update",
            data: {
              toolCallId: event.toolCallId,
              output: event.output,
            },
          });
          break;

        case "tool_execution_end":
          this.onEvent({
            type: "tool_end",
            data: {
              toolCallId: event.toolCallId,
              isError: event.isError,
              result: event.result,
            },
          });
          break;

        case "message_start":
          this.onEvent({ type: "message_start", data: {} });
          break;

        case "message_end":
          this.onEvent({ type: "message_end", data: {} });
          break;

        case "agent_start":
          this.onEvent({ type: "agent_start", data: {} });
          break;

        case "agent_end":
          this.onEvent({
            type: "agent_end",
            data: { messages: event.messages },
          });
          this.onEvent({ type: "status", data: this.getStatus() });
          
          // LLM-powered: summarize conversation and extract meaningful facts
          this.summarizeAndExtractMemories(event.messages).catch(err => {
            console.error("[tau] Failed to summarize conversation:", err);
          });
          break;

        case "auto_compaction_start":
          this.onEvent({
            type: "compaction_start",
            data: { reason: event.reason },
          });
          break;

        case "auto_compaction_end":
          this.onEvent({
            type: "compaction_end",
            data: {
              aborted: event.aborted,
              summary: event.result?.summary,
              tokensBefore: event.result?.tokensBefore,
              errorMessage: event.errorMessage,
            },
          });
          break;
      }
    });
  }

  async prompt(text: string) {
    if (!this.session) throw new Error("Session not initialized");

    const trimmed = text.trim();

    // Handle builtin commands
    if (trimmed.startsWith("/")) {
      const result = await this.handleBuiltinCommand(trimmed);
      if (result.handled) {
        if (result.message) {
          this.onEvent({
            type: "command_result",
            data: { message: result.message },
          } as any);
        }
        return;
      }
    }

    // Build memory context (may be empty)
    let memoryContext = "";
    try {
      memoryContext = await this.buildMemoryContext();
    } catch (err) {
      console.error('[tau] Failed to build memory context:', err);
      memoryContext = "";
    }

    if (this.session.isStreaming) {
      // Streaming follow-up: do not inject memory context for followUp calls
      await this.session.followUp(text);
    } else {
      // New conversation turn: prepend memory context if available
      let promptText = text;
      if (memoryContext && memoryContext.trim().length > 0) {
        promptText = `[CONTEXT]\n${memoryContext}\n[/CONTEXT]\n\n${text}`;
      }

      // Inject soul bootstrap instructions if SOUL.md needs it
      if (this._soulNeedsBootstrap) {
        this._soulNeedsBootstrap = false; // Only inject once
        const bootstrapBlock = `[SOUL_BOOTSTRAP]
Your personality file (SOUL.md) needs to be set up. Before responding to the user's message, conduct a brief personality interview. Ask 5 questions ONE AT A TIME to learn about the user:
1. How should I address you? What's your name and preferred communication style?
2. What do you primarily use me for? (coding, writing, research, brainstorming, etc.)
3. Do you prefer concise answers or detailed explanations?
4. What's your technical level? (beginner, intermediate, expert)
5. Any pet peeves or strong preferences about how I should behave?

After each answer, ask the next question. After all 5 questions are answered, use the soul_update tool to write the SOUL.md content with the learned personality.
[/SOUL_BOOTSTRAP]

`;
        promptText = bootstrapBlock + promptText;
      }

      await this.session.prompt(promptText);
    }
  }

  private async handleBuiltinCommand(text: string): Promise<{ handled: boolean; message?: string }> {
    const cmd = text.split(/\s+/)[0].toLowerCase();
    const args = text.slice(cmd.length).trim();

    switch (cmd) {
      case "/new":
        await this.session.newSession();
        this.onEvent({ type: "status", data: this.getStatus() });
        return { handled: true, message: "Started new session." };

      case "/compact": {
        const result = await this.session.compact(args || undefined);
        // Send as special compaction event with the summary
        this.onEvent({
          type: "compaction_result",
          data: {
            summary: result.summary,
            tokensBefore: result.tokensBefore,
          },
        } as any);
        return { handled: true };
      }

      case "/model": {
        if (args) {
          // Try to find and set the model by search term
          if (!this.modelRegistry) return { handled: true, message: "No model registry." };
          const available = await this.modelRegistry.getAvailable();
          const match = available.find((m: any) =>
            m.id.toLowerCase().includes(args.toLowerCase()) ||
            (m.name && m.name.toLowerCase().includes(args.toLowerCase()))
          );
          if (match) {
            await this.session.setModel(match);
            this.onEvent({ type: "status", data: this.getStatus() });
            return { handled: true, message: `Switched to ${match.provider}/${match.id}` };
          }
          return { handled: true, message: `No model matching "${args}" found.` };
        }
        // No args — cycle model
        const cycled = await this.session.cycleModel();
        this.onEvent({ type: "status", data: this.getStatus() });
        if (cycled) {
          return { handled: true, message: `Model: ${cycled.model.provider}/${cycled.model.id} (thinking: ${cycled.thinkingLevel})` };
        }
        return { handled: true, message: "Only one model available." };
      }

      case "/session": {
        const stats = this.session.getSessionStats();
        const lines = [
          `Session: ${stats.sessionId}`,
          stats.sessionFile ? `File: ${stats.sessionFile}` : "In-memory session",
          `Messages: ${stats.userMessages} user, ${stats.assistantMessages} assistant`,
          `Tool calls: ${stats.toolCalls}`,
        ];
        return { handled: true, message: lines.join("\n") };
      }

      case "/copy": {
        const lastText = this.session.getLastAssistantText();
        if (lastText) {
          return { handled: true, message: "__COPY__" + lastText };
        }
        return { handled: true, message: "No assistant message to copy." };
      }

      case "/name": {
        if (args) {
          this.session.setSessionName(args);
          return { handled: true, message: `Session named: ${args}` };
        }
        return { handled: true, message: "Usage: /name <name>" };
      }

      case "/spawn": {
        if (!args) return { handled: true, message: "Usage: /spawn Task 1 | Task 2 | Task 3" };
        if (!this.subagentManager) return { handled: true, message: "Subagent system not initialized." };
        const tasks = args.split("|").map((t: string) => t.trim()).filter(Boolean);
        const configs: SubagentSpawnConfig[] = tasks.map((task: string) => ({
          name: task.slice(0, 40),
          task,
        }));
        try {
          const infos = await this.subagentManager.spawn(configs);
          const names = infos.map((i: SubagentInfo) => `@${i.name}`).join(", ");
          return { handled: true, message: `Spawned ${infos.length} agent(s): ${names}` };
        } catch (err: any) {
          return { handled: true, message: `Error: ${err.message}` };
        }
      }

      case "/memory": {
        const subcmd = args.split(/\s+/)[0];
        const rest = args.slice(subcmd.length).trim();
        
        if (subcmd === "list") {
          const memories = await this.listMemoriesForAgent();
          const formatted = memories.map(m => 
            `[${m.type}] ${m.content}${m.tags?.length ? ` (${m.tags.join(", ")})` : ""}`
          ).join("\n");
          return { handled: true, message: formatted || "No memories found." };
        }
        
        if (subcmd === "refresh") {
          await this.enrichSystemContext();
          return { handled: true, message: "Workspace context refreshed." };
        }
        
        return { handled: true, message: "Usage: /memory [list|refresh]" };
      }

      case "/refresh": {
        await this.refreshProactiveSystems();
        return { handled: true, message: "Proactive systems refreshed: context loaded, patterns detected." };
      }

      case "/export": {
        try {
          const filePath = await this.session.exportToHtml();
          return { handled: true, message: `Session exported to: ${filePath}` };
        } catch (err: any) {
          return { handled: true, message: `Export failed: ${err.message}` };
        }
      }

      case "/handoff": {
        // Send a handoff-generation prompt to the agent (text doesn't start
        // with "/" so it won't recurse back into handleBuiltinCommand).
        await this.prompt(
          "Generate a comprehensive handoff document for this conversation. " +
          "Include: 1) Context and background of what was discussed, " +
          "2) What was accomplished, 3) Key decisions made, " +
          "4) Current state of the work, 5) Remaining tasks or suggested next steps. " +
          "Format as clear markdown that can be shared with another person or agent " +
          "to continue this work."
        );
        return { handled: true };
      }

      case "/resume":
        // Return the signal; the renderer will open session selector
        return { handled: true, message: "__RESUME__" };

      case "/quit":
        return { handled: true, message: "__QUIT__" };

      default:
        // Not a builtin — pass through to session.prompt() which handles
        // extension commands, skills, and prompt templates
        return { handled: false };
    }
  }

  async recompact(customInstructions: string): Promise<void> {
    if (!this.session) return;

    // Signal UI that compaction is starting
    this.onEvent({ type: "compaction_start", data: { reason: "manual" } } as any);

    try {
      const result = await this.session.compact(customInstructions);
      this.onEvent({
        type: "compaction_end",
        data: {
          aborted: false,
          summary: result.summary,
          tokensBefore: result.tokensBefore,
        },
      } as any);
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      if (msg.includes("Already compacted") || msg.includes("Nothing to compact")) {
        this.onEvent({
          type: "compaction_end",
          data: { aborted: true, summary: "", tokensBefore: 0 },
        } as any);
        this.onEvent({ type: "info", data: { message: "Nothing to compact — session is already compacted." } } as any);
        return;
      }
      // Signal end even on error
      this.onEvent({
        type: "compaction_end",
        data: { aborted: true, summary: "", tokensBefore: 0 },
      } as any);
      throw err;
    }
  }

  // ── Session tree / fork / export helpers ─────────────────────────

  async getSessionTree(): Promise<import('./shared/types').SessionTreeNodeInfo[]> {
    if (!this.session) return [];
    try {
      const sm = this.session.sessionManager;
      const rawTree = sm.getTree();
      const leafId = sm.getLeafId();
      return this.serializeTree(rawTree, leafId);
    } catch (err) {
      console.error('[tau] getSessionTree error:', err);
      return [];
    }
  }

  private serializeTree(
    nodes: any[],
    leafId: string | null,
  ): import('./shared/types').SessionTreeNodeInfo[] {
    return nodes.map((node: any) => {
      const entry = node.entry;
      let text = '';
      let role: string | undefined;

      if (entry.type === 'message') {
        const msg = entry.message;
        role = msg.role;
        text = this.extractTextContent(msg.content).slice(0, 120);
      } else if (entry.type === 'compaction') {
        text = '[compaction]';
      } else if (entry.type === 'branch_summary') {
        text = `[branch summary]: ${(entry.summary || '').slice(0, 80)}`;
      } else if (entry.type === 'label') {
        text = `[label: ${entry.label || ''}]`;
      } else {
        text = `[${entry.type}]`;
      }

      return {
        id: entry.id,
        parentId: entry.parentId || null,
        entryType: entry.type,
        role,
        text,
        children: this.serializeTree(node.children, leafId),
        isActive: entry.id === leafId,
        label: node.label,
      };
    });
  }

  async navigateTree(
    targetId: string,
    opts?: { summarize?: boolean; customInstructions?: string },
  ): Promise<import('./shared/types').TreeNavigateResult> {
    if (!this.session) return { cancelled: true };
    try {
      const result = await this.session.navigateTree(targetId, {
        summarize: opts?.summarize,
        customInstructions: opts?.customInstructions,
      });
      // Refresh listeners after tree navigation (messages changed)
      this.setupEventListeners();
      this.onEvent({ type: "session_switched", data: {} } as any);
      this.onEvent({ type: "status", data: this.getStatus() });
      return {
        editorText: result.editorText,
        cancelled: result.cancelled,
        aborted: result.aborted,
      };
    } catch (err) {
      console.error('[tau] navigateTree error:', err);
      return { cancelled: true };
    }
  }

  async forkSession(
    entryId: string,
  ): Promise<import('./shared/types').ForkResult> {
    if (!this.session) return { selectedText: '', cancelled: true };
    try {
      const result = await this.session.fork(entryId);
      // Fork creates a new session — refresh listeners
      this.setupEventListeners();
      this.onEvent({ type: "session_switched", data: {} } as any);
      this.onEvent({ type: "status", data: this.getStatus() });
      return {
        selectedText: result.selectedText,
        cancelled: result.cancelled,
      };
    } catch (err) {
      console.error('[tau] forkSession error:', err);
      return { selectedText: '', cancelled: true };
    }
  }

  getUserMessagesForForking(): import('./shared/types').ForkableMessage[] {
    if (!this.session) return [];
    try {
      return this.session.getUserMessagesForForking();
    } catch (err) {
      console.error('[tau] getUserMessagesForForking error:', err);
      return [];
    }
  }

  getLastAssistantTextForCopy(): string | undefined {
    if (!this.session) return undefined;
    return this.session.getLastAssistantText();
  }

  async exportSessionToHtml(): Promise<string | null> {
    if (!this.session) return null;
    try {
      return await this.session.exportToHtml();
    } catch (err) {
      console.error('[tau] exportSessionToHtml error:', err);
      return null;
    }
  }

  async abort() {
    if (!this.session) return;
    await this.session.abort();
  }

  async newSession() {
    if (!this.session) return;
    await this.session.newSession();
    this.onEvent({ type: "status", data: this.getStatus() });

    // Increment session counter and check for soul evolution trigger
    try {
      const count = await incrementSessionCount();
      if (count % 10 === 0) {
        console.log(`[tau] Session count ${count} — triggering soul evolution check`);
        this.triggerSoulEvolution().catch(err => {
          console.error("[tau] Soul evolution failed:", err);
        });
      }
    } catch (err) {
      console.error("[tau] Failed to increment session count:", err);
    }
  }

  async switchSession(sessionPath: string) {
    if (!this.session) return;
    await this.session.switchSession(sessionPath);
    this.setupEventListeners();
    this.onEvent({ type: "session_switched", data: {} } as any);
    this.onEvent({ type: "status", data: this.getStatus() });
    
  }

  getStatus(): StatusInfo {
    return {
      isStreaming: this.session?.isStreaming ?? false,
      model: this.session?.model
        ? `${this.session.model.provider}/${this.session.model.id}`
        : undefined,
      thinkingLevel: this.session?.thinkingLevel,
      sessionId: this.session?.sessionId,
      cwd: this.cwd,
    };
  }

  async listSessions(): Promise<SessionInfo[]> {
    const sdk = await loadPiSdk();
    const sessions = await sdk.SessionManager.list(this.cwd);
    return sessions.map((s: any) => ({
      id: s.id,
      file: s.path,
      name: s.name,
      firstMessage: s.firstMessage || "New conversation",
      messageCount: s.messageCount,
      timestamp: s.modified?.getTime() || s.created?.getTime() || Date.now(),
      cwd: s.cwd || this.cwd,
    }));
  }

  async getSessionHistory(): Promise<import('./shared/types').HistoryMessage[]> {
    if (!this.session) return [];
    try {
      const sm = this.session.sessionManager;
      const entries = sm.getBranch();
      const history: import('./shared/types').HistoryMessage[] = [];

      // Collect tool results to merge with assistant messages
      const toolResults = new Map<string, { content: string; isError: boolean }>();

      for (const entry of entries) {
        // Include compaction entries in history
        if (entry.type === 'compaction') {
          history.push({
            role: 'compaction' as any,
            content: '',
            timestamp: entry.timestamp || 0,
            compaction: {
              summary: (entry as any).summary || '',
              tokensBefore: (entry as any).tokensBefore,
            },
          });
          continue;
        }

        if (entry.type !== 'message') continue;
        const msg = entry.message as any;

        if (msg.role === 'user') {
          const content = typeof msg.content === 'string'
            ? msg.content
            : (msg.content || [])
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');
          if (content) {
            history.push({
              role: 'user',
              content,
              timestamp: msg.timestamp || 0,
            });
          }
        } else if (msg.role === 'toolResult') {
          const resultText = typeof msg.content === 'string'
            ? msg.content
            : (msg.content || [])
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('\n');
          toolResults.set(msg.toolCallId, {
            content: resultText,
            isError: !!msg.isError,
          });
        } else if (msg.role === 'assistant') {
          let content = '';
          let thinking = '';
          const tools: import('./shared/types').HistoryToolCall[] = [];

          for (const part of msg.content || []) {
            if (part.type === 'text') {
              content += part.text;
            } else if (part.type === 'thinking') {
              thinking += part.thinking;
            } else if (part.type === 'toolCall') {
              const result = toolResults.get(part.id);
              tools.push({
                id: part.id,
                name: part.name,
                input: part.arguments,
                output: result?.content || '',
                isError: result?.isError || false,
              });
            }
          }

          history.push({
            role: 'assistant',
            content,
            thinking: thinking || undefined,
            tools: tools.length > 0 ? tools : undefined,
            timestamp: msg.timestamp || 0,
          });
        }
      }

      return history;
    } catch (err) {
      console.error('[tau] Failed to load session history:', err);
      return [];
    }
  }

  async listAllSessions(): Promise<SessionInfo[]> {
    const sdk = await loadPiSdk();
    const sessions = await sdk.SessionManager.listAll();
    return sessions.map((s: any) => ({
      id: s.id,
      file: s.path,
      name: s.name,
      firstMessage: s.firstMessage || "New conversation",
      messageCount: s.messageCount,
      timestamp: s.modified?.getTime() || s.created?.getTime() || Date.now(),
      cwd: s.cwd || "",
    }));
  }

  async renameSession(sessionPath: string, newName: string): Promise<void> {
    const sdk = await loadPiSdk();
    const sm = sdk.SessionManager.open(sessionPath);
    sm.appendSessionInfo(newName);
  }

  async listModels(): Promise<ModelInfo[]> {
    if (!this.modelRegistry) return [];
    try {
      const available = await this.modelRegistry.getAvailable();
      const currentModel = this.session?.model;
      return available.map((m: any) => ({
        provider: m.provider,
        id: m.id,
        name: m.name || m.id,
        isActive:
          currentModel?.provider === m.provider && currentModel?.id === m.id,
      }));
    } catch {
      return [];
    }
  }

  async setModel(provider: string, modelId: string) {
    if (!this.modelRegistry || !this.session) return;
    const model = this.modelRegistry.find(provider, modelId);
    if (model) {
      await this.session.setModel(model);
      this.onEvent({ type: "status", data: this.getStatus() });
    }
  }

  getCurrentModel() {
    const model = this.session?.model;
    if (!model) return null;
    return { provider: model.provider, id: model.id, name: model.name || model.id };
  }

  async cycleModel() {
    if (!this.session) return;
    const result = await this.session.cycleModel();
    this.onEvent({ type: "status", data: this.getStatus() });
    return result;
  }

  getThinkingLevel() {
    return this.session?.thinkingLevel ?? "off";
  }

  setThinkingLevel(level: string) {
    if (!this.session) return;
    this.session.setThinkingLevel(level);
    this.onEvent({ type: "status", data: this.getStatus() });
  }

  cycleThinkingLevel() {
    if (!this.session) return;
    const result = this.session.cycleThinkingLevel();
    this.onEvent({ type: "status", data: this.getStatus() });
    return result;
  }

  // Commands excluded from the slash-command autocomplete in the composer.
  // tree and fork are handled via dedicated UI (TreeNavigator / ForkSelector).
  private static EXCLUDED_COMMANDS = new Set<string>();

  // --- Standalone tools injected into all subagents (create_memory, list_memory, save_note) ---

  private buildSubagentExtraTools(): any[] {
    const cwd = this.cwd;
    const onEvent = (evt: any) => { try { this.onEvent(evt); } catch { /* ignore */ } };

    return [
      {
        name: "create_memory",
        label: "Create Memory",
        description: "Store important facts, preferences, decisions, or summaries as vault notes. Use proactively for anything worth remembering long-term.",
        parameters: {
          type: "object" as const,
          properties: {
            memoryType: { type: "string" as const, enum: ["fact", "preference", "decision", "summary"], description: "Type of memory" },
            title: { type: "string" as const, description: "Short title for the memory" },
            content: { type: "string" as const, description: "What should be remembered" },
            tags: { type: "array" as const, items: { type: "string" as const }, description: "Tags for categorization" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Where to store: global (across projects) or workspace (this project only). Defaults to workspace." },
          },
          required: ["memoryType", "title", "content"],
        },
        async execute(_toolCallId: string, params: { memoryType: string; title: string; content: string; tags?: string[]; scope?: string }) {
          try {
            const note = await createMemoryNote({
              title: params.title,
              content: params.content,
              memoryType: params.memoryType as MemorySubtype,
              tags: params.tags || [],
              scope: (params.scope as VaultScope) || "workspace",
              source: "agent-created",
              cwd,
            });
            onEvent({ type: "memory_created", data: { memory: note } });
            return { content: [{ type: "text" as const, text: `Memory created: ${params.title}` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },
      {
        name: "list_memory",
        label: "List Memories",
        description: "Recall stored memories from the vault. Filter by type.",
        parameters: {
          type: "object" as const,
          properties: {
            memoryType: { type: "string" as const, enum: ["fact", "preference", "decision", "summary"], description: "Filter by memory type" },
          },
        },
        async execute(_toolCallId: string, params: { memoryType?: string }) {
          try {
            const notes = await listMemoryNotes(cwd);
            let filtered = notes;
            if (params.memoryType) filtered = filtered.filter(n => n.memoryType === params.memoryType);
            const summary = filtered.slice(0, 20).map(n => `[${n.memoryType}] ${n.title}${n.preview ? ": " + n.preview : ""}`).join("\n");
            return { content: [{ type: "text" as const, text: summary || "No memories found." }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },
      {
        name: "vault_search",
        label: "Search Vault",
        description: "Search all vault notes (memories and knowledge) by keyword.",
        parameters: {
          type: "object" as const,
          properties: {
            query: { type: "string" as const, description: "Search query" },
          },
          required: ["query"],
        },
        async execute(_toolCallId: string, params: { query: string }) {
          try {
            const results = await searchVault(params.query, cwd);
            const summary = results.slice(0, 15).map(r => `[${r.type}${r.memoryType ? "/" + r.memoryType : ""}] ${r.title}: L${r.lineNumber} ${r.matchLine}`).join("\n");
            return { content: [{ type: "text" as const, text: summary || "No matches found." }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },
      {
        name: "vault_create",
        label: "Create Vault Note",
        description: "Create a knowledge note in the vault (concept, pattern, reference, etc.).",
        parameters: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const, description: "Note title" },
            content: { type: "string" as const, description: "Note content (markdown)" },
            type: { type: "string" as const, enum: ["concept", "pattern", "project", "reference", "log"], description: "Note type" },
            tags: { type: "array" as const, items: { type: "string" as const }, description: "Tags" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Scope. Defaults to workspace." },
          },
          required: ["title", "content", "type"],
        },
        async execute(_toolCallId: string, params: { title: string; content: string; type: string; tags?: string[]; scope?: string }) {
          try {
            const note = await createVaultNote({
              title: params.title,
              content: params.content,
              type: params.type as VaultNoteType,
              tags: params.tags || [],
              scope: (params.scope as VaultScope) || "workspace",
              cwd,
            });
            return { content: [{ type: "text" as const, text: `Note created: ${note.title} (${note.type})` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },
      {
        name: "vault_read",
        label: "Read Vault Note",
        description: "Read a vault note by slug.",
        parameters: {
          type: "object" as const,
          properties: {
            slug: { type: "string" as const, description: "Note slug" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Note scope" },
          },
          required: ["slug", "scope"],
        },
        async execute(_toolCallId: string, params: { slug: string; scope: string }) {
          try {
            const note = await readVaultNote(params.slug, params.scope as VaultScope, cwd);
            if (!note) return { content: [{ type: "text" as const, text: "Note not found." }] };
            return { content: [{ type: "text" as const, text: `# ${note.title}\n\n${note.content}` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },
      {
        name: "vault_capture",
        label: "Quick Capture to Inbox",
        description: "Quick capture a thought or note to the vault inbox for later processing.",
        parameters: {
          type: "object" as const,
          properties: {
            content: { type: "string" as const, description: "Content to capture" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Inbox scope. Defaults to workspace." },
          },
          required: ["content"],
        },
        async execute(_toolCallId: string, params: { content: string; scope?: string }) {
          try {
            await captureToInbox(params.content, (params.scope as VaultScope) || "workspace", cwd);
            return { content: [{ type: "text" as const, text: "Captured to inbox." }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },
      {
        name: "save_note",
        label: "Save Note to Apple Notes",
        description: "Save a note to Apple Notes. For ideas, plans, lists, digests, or any content worth capturing.",
        parameters: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const, description: "Note title" },
            content: { type: "string" as const, description: "Note content (HTML or plain text)" },
            folder: { type: "string" as const, description: "Apple Notes folder (optional)" },
          },
          required: ["title", "content"],
        },
        async execute(_toolCallId: string, params: { title: string; content: string; folder?: string }) {
          try {
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileAsync = promisify(execFile);
            const htmlBody = `<h1>${params.title}</h1>${params.content.replace(/\n/g, "<br>")}`;
            const escaped = htmlBody.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            let script: string;
            if (params.folder) {
              const fe = params.folder.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
              script = `tell application "Notes"\nset targetFolder to folder "${fe}" of default account\nmake new note at targetFolder with properties {body:"${escaped}"}\nreturn "ok"\nend tell`;
            } else {
              script = `tell application "Notes"\nmake new note with properties {body:"${escaped}"}\nreturn "ok"\nend tell`;
            }
            await execFileAsync("osascript", ["-e", script]);
            return { content: [{ type: "text" as const, text: `Note saved: "${params.title}"${params.folder ? ` in ${params.folder}` : ""}` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error saving note: ${err.message}` }] };
          }
        },
      },
    ];
  }

  // --- Memory and Skill Tools for Proactive Agent Behavior ---

  private buildMemoryAndSkillTools(): any[] {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias

    return [
      {
        name: "create_memory",
        label: "Create Memory",
        description: "Create a memory as a vault note to store important facts, preferences, decisions, or summaries. Use proactively when you discover important information, complete significant tasks, or notice patterns.",
        parameters: {
          type: "object" as const,
          properties: {
            memoryType: {
              type: "string" as const,
              enum: ["fact", "preference", "decision", "summary"],
              description: "Type of memory to create",
            },
            title: {
              type: "string" as const,
              description: "Short title for the memory",
            },
            content: {
              type: "string" as const,
              description: "The memory content - what should be remembered",
            },
            tags: {
              type: "array" as const,
              items: { type: "string" as const },
              description: "Optional tags for categorization",
            },
            scope: {
              type: "string" as const,
              enum: ["global", "workspace"],
              description: "Where to store: global (across projects) or workspace (this project). Defaults to workspace.",
            },
          },
          required: ["memoryType", "title", "content"],
        },
        async execute(
          _toolCallId: string,
          params: { memoryType: string; title: string; content: string; tags?: string[]; scope?: string }
        ) {
          try {
            const note = await createMemoryNote({
              title: params.title,
              content: params.content,
              memoryType: params.memoryType as MemorySubtype,
              tags: params.tags || [],
              scope: (params.scope as VaultScope) || "workspace",
              source: "agent-created",
              cwd: self.cwd,
            });

            try {
              self.onEvent({ type: 'memory_created', data: { memory: note } } as any);
            } catch { /* ignore */ }

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Memory created: ${params.title}`,
                },
              ],
              details: { slug: note.slug, scope: note.scope },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `Error creating memory: ${err.message}` }],
              details: {},
            };
          }
        },
      },

      {
        name: "list_memory",
        label: "List Memories",
        description: "List stored memories from the vault. Filter by type.",
        parameters: {
          type: "object" as const,
          properties: {
            memoryType: {
              type: "string" as const,
              enum: ["fact", "preference", "decision", "summary"],
              description: "Filter by memory type (optional)",
            },
          },
          required: [],
        },
        async execute(_toolCallId: string, params: { memoryType?: string }) {
          try {
            const notes = await listMemoryNotes(self.cwd);
            let filtered = notes;
            if (params.memoryType) {
              filtered = filtered.filter(n => n.memoryType === params.memoryType);
            }

            const formatted = filtered.slice(0, 20).map(n =>
              `[${n.memoryType}] ${n.title}${n.preview ? ": " + n.preview : ""}${n.tags?.length ? ` (tags: ${n.tags.join(", ")})` : ""}`
            ).join("\n\n");

            return {
              content: [
                {
                  type: "text" as const,
                  text: formatted || "No matching memories found.",
                },
              ],
              details: { count: filtered.length },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `Error listing memories: ${err.message}` }],
              details: {},
            };
          }
        },
      },

      {
        name: "memory_reinforce",
        label: "Reinforce Memory",
        description: "Bump the usage count of a memory to keep it from decaying. Use when a memory is actively relevant.",
        parameters: {
          type: "object" as const,
          properties: {
            slug: { type: "string" as const, description: "Memory note slug" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Memory scope" },
          },
          required: ["slug", "scope"],
        },
        async execute(_toolCallId: string, params: { slug: string; scope: string }) {
          try {
            await reinforceMemoryNote(params.slug, params.scope as VaultScope, self.cwd);
            return { content: [{ type: "text" as const, text: `Memory reinforced: ${params.slug}` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "vault_search",
        label: "Search Vault",
        description: "Search all vault notes (memories and knowledge) by keyword.",
        parameters: {
          type: "object" as const,
          properties: {
            query: { type: "string" as const, description: "Search query" },
          },
          required: ["query"],
        },
        async execute(_toolCallId: string, params: { query: string }) {
          try {
            const results = await searchVault(params.query, self.cwd);
            const summary = results.slice(0, 15).map(r =>
              `[${r.type}${r.memoryType ? "/" + r.memoryType : ""}] ${r.title}: L${r.lineNumber} ${r.matchLine}`
            ).join("\n");
            return {
              content: [{ type: "text" as const, text: summary || "No matches found." }],
              details: { count: results.length },
            };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "vault_create",
        label: "Create Vault Note",
        description: "Create a knowledge note in the vault (concept, pattern, reference, etc.).",
        parameters: {
          type: "object" as const,
          properties: {
            title: { type: "string" as const, description: "Note title" },
            content: { type: "string" as const, description: "Note content (markdown)" },
            type: { type: "string" as const, enum: ["concept", "pattern", "project", "reference", "log"], description: "Note type" },
            tags: { type: "array" as const, items: { type: "string" as const }, description: "Tags" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Scope. Defaults to workspace." },
          },
          required: ["title", "content", "type"],
        },
        async execute(_toolCallId: string, params: { title: string; content: string; type: string; tags?: string[]; scope?: string }) {
          try {
            const note = await createVaultNote({
              title: params.title,
              content: params.content,
              type: params.type as VaultNoteType,
              tags: params.tags || [],
              scope: (params.scope as VaultScope) || "workspace",
              cwd: self.cwd,
            });
            return { content: [{ type: "text" as const, text: `Note created: ${note.title} (${note.type})` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "vault_read",
        label: "Read Vault Note",
        description: "Read a vault note by slug.",
        parameters: {
          type: "object" as const,
          properties: {
            slug: { type: "string" as const, description: "Note slug" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Note scope" },
          },
          required: ["slug", "scope"],
        },
        async execute(_toolCallId: string, params: { slug: string; scope: string }) {
          try {
            const note = await readVaultNote(params.slug, params.scope as VaultScope, self.cwd);
            if (!note) return { content: [{ type: "text" as const, text: "Note not found." }] };
            return { content: [{ type: "text" as const, text: `# ${note.title}\n\n${note.content}` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "vault_update",
        label: "Update Vault Note",
        description: "Update the body of an existing vault note.",
        parameters: {
          type: "object" as const,
          properties: {
            slug: { type: "string" as const, description: "Note slug" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Note scope" },
            body: { type: "string" as const, description: "New note body (markdown, without frontmatter)" },
          },
          required: ["slug", "scope", "body"],
        },
        async execute(_toolCallId: string, params: { slug: string; scope: string; body: string }) {
          try {
            await updateVaultNote(params.slug, params.scope as VaultScope, params.body, self.cwd);
            return { content: [{ type: "text" as const, text: `Note updated: ${params.slug}` }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "vault_capture",
        label: "Quick Capture to Inbox",
        description: "Quick capture a thought or note to the vault inbox for later processing.",
        parameters: {
          type: "object" as const,
          properties: {
            content: { type: "string" as const, description: "Content to capture" },
            scope: { type: "string" as const, enum: ["global", "workspace"], description: "Inbox scope. Defaults to workspace." },
          },
          required: ["content"],
        },
        async execute(_toolCallId: string, params: { content: string; scope?: string }) {
          try {
            await captureToInbox(params.content, (params.scope as VaultScope) || "workspace", self.cwd);
            return { content: [{ type: "text" as const, text: "Captured to inbox." }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "soul_status",
        label: "Soul Status",
        description: "Check SOUL.md status: whether it exists, needs bootstrap, or has pending proposals.",
        parameters: { type: "object" as const, properties: {}, required: [] },
        async execute() {
          try {
            const status = await getSoulStatus();
            const proposals = await readProposals();
            const pendingCount = proposals?.proposals?.length || 0;
            return {
              content: [{
                type: "text" as const,
                text: `SOUL status: exists=${status.exists}, needsBootstrap=${status.needsBootstrap}, sections=${status.sections.length}, pendingProposals=${pendingCount}`,
              }],
            };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "soul_update",
        label: "Update SOUL.md",
        description: "Write/update the SOUL.md personality file content.",
        parameters: {
          type: "object" as const,
          properties: {
            content: { type: "string" as const, description: "Full SOUL.md content (markdown)" },
          },
          required: ["content"],
        },
        async execute(_toolCallId: string, params: { content: string }) {
          try {
            const { writeSoul } = await import("./soul-store");
            await writeSoul(params.content);
            return { content: [{ type: "text" as const, text: "SOUL.md updated successfully." }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "set_project_context",
        label: "Set Project Context",
        description: "Save workspace-specific context (summary, tech stack, conventions) for persistent project awareness.",
        parameters: {
          type: "object" as const,
          properties: {
            summary: { type: "string" as const, description: "Brief project summary" },
            techStack: { type: "string" as const, description: "Tech stack description" },
            conventions: { type: "string" as const, description: "Coding conventions and patterns" },
            keyFiles: { type: "string" as const, description: "Key files and their purposes" },
          },
          required: ["summary"],
        },
        async execute(_toolCallId: string, params: { summary: string; techStack?: string; conventions?: string; keyFiles?: string }) {
          try {
            await setProjectContext({
              workspace: self.cwd,
              summary: params.summary,
              techStack: params.techStack,
              conventions: params.conventions,
              keyFiles: params.keyFiles,
              updatedAt: Date.now(),
            });
            return { content: [{ type: "text" as const, text: "Project context saved." }] };
          } catch (err: any) {
            return { content: [{ type: "text" as const, text: `Error: ${err.message}` }] };
          }
        },
      },

      {
        name: "create_skill",
        label: "Create Skill",
        description: "Create a reusable skill from a successful workflow or pattern.",
        parameters: {
          type: "object" as const,
          properties: {
            name: { type: "string" as const, description: "Name for the skill" },
            prompt: { type: "string" as const, description: "The skill prompt/instructions" },
            description: { type: "string" as const, description: "Optional description" },
          },
          required: ["name", "prompt"],
        },
        async execute(
          _toolCallId: string,
          params: { name: string; prompt: string; description?: string }
        ) {
          try {
            const skill: SkillDefinition = {
              id: "",
              name: params.name,
              description: params.description || `Auto-created skill: ${params.name}`,
              prompt: params.prompt,
              permissions: {
                filesystem: [self.cwd],
                commands: [],
                network: false,
              },
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };

            const saved = await self.createSkillFromAgent(skill);
            return {
              content: [{
                type: "text" as const,
                text: `Skill created: ${params.name}. You can now run it with /skill ${params.name} or from the skills panel.`,
              }],
              details: { skillId: saved.id },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `Error creating skill: ${err.message}` }],
              details: {},
            };
          }
        },
      },


    ];
  }

  private buildCanvasTools(): any[] {
    const self = this; // eslint-disable-line @typescript-eslint/no-this-alias

    return [
      {
        name: "render_canvas",
        label: "Render Canvas",
        description: `Render interactive UI on the Canvas view. Use this when the user needs structured input (forms, selections), data display (tables, cards), or any visual interface that's better than plain text. The Canvas shows your components as a real interactive UI.

Available component types:
- text: Display text (variants: title, subtitle, body, caption, code)
- input: Text input field (types: text, number, email, url, date, time)
- textarea: Multi-line text input
- select: Dropdown selector with options
- checkbox: Toggle checkbox
- button: Action button (variants: primary, secondary, danger) — requires "action" string
- table: Data table with columns and rows (can be selectable)
- image: Display an image by URL
- mermaid: Render a Mermaid diagram (erDiagram, flowchart, sequenceDiagram, classDiagram, gantt, pie, etc.). Pass { type: "mermaid", id: "...", code: "erDiagram\\n  User ||--o{ Order : places" }
- divider: Visual separator
- row: Horizontal layout container for child components
- card: Grouped container with optional title

When a user clicks a button, you'll receive a message with the action name and all current form values. Use this to process their input.`,
        parameters: {
          type: "object" as const,
          properties: {
            id: {
              type: "string" as const,
              description: "Unique canvas ID (use same ID to update existing canvas)",
            },
            title: {
              type: "string" as const,
              description: "Optional title shown at the top of the canvas",
            },
            components: {
              type: "array" as const,
              description: "Array of UI components to render",
              items: {
                type: "object" as const,
                properties: {
                  type: { type: "string" as const },
                  id: { type: "string" as const },
                },
                required: ["type", "id"],
              },
            },
          },
          required: ["id", "components"],
        },
        async execute(
          _toolCallId: string,
          params: { id: string; title?: string; components: any[] },
        ) {
          try {
            const spec = {
              id: params.id,
              title: params.title,
              components: params.components,
            };

            // Emit canvas_update event to the renderer
            self.onEvent({
              type: "canvas_update",
              data: spec,
            });

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Canvas "${params.title || params.id}" rendered with ${params.components.length} component(s). The user can now interact with it.`,
                },
              ],
              details: { canvasId: params.id },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `Error rendering canvas: ${err.message}` }],
              details: {},
            };
          }
        },
      },

      {
        name: "save_note",
        label: "Save Note to Apple Notes",
        description: "Save a note to Apple Notes. Use this when the user wants to capture information, take notes, or save content from a canvas form. Notes are saved to the user's Apple Notes app.",
        parameters: {
          type: "object" as const,
          properties: {
            title: {
              type: "string" as const,
              description: "Note title",
            },
            content: {
              type: "string" as const,
              description: "Note content / body text (can include HTML for formatting)",
            },
            folder: {
              type: "string" as const,
              description: "Apple Notes folder name to save in (optional, defaults to default folder)",
            },
          },
          required: ["title", "content"],
        },
        async execute(
          _toolCallId: string,
          params: { title: string; content: string; folder?: string },
        ) {
          try {
            const { execFile } = await import("node:child_process");
            const { promisify } = await import("node:util");
            const execFileAsync = promisify(execFile);

            // Build HTML body — Apple Notes uses HTML
            const htmlBody = `<h1>${params.title}</h1>${params.content.replace(/\n/g, "<br>")}`;

            // Escape for AppleScript
            const escaped = htmlBody.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

            let script: string;
            if (params.folder) {
              const folderEscaped = params.folder.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
              script = `
tell application "Notes"
  set targetFolder to folder "${folderEscaped}" of default account
  make new note at targetFolder with properties {body:"${escaped}"}
  return "ok"
end tell`;
            } else {
              script = `
tell application "Notes"
  make new note with properties {body:"${escaped}"}
  return "ok"
end tell`;
            }

            await execFileAsync("osascript", ["-e", script]);

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Note saved to Apple Notes: "${params.title}"${params.folder ? ` in folder "${params.folder}"` : ""}`,
                },
              ],
              details: { title: params.title, folder: params.folder },
            };
          } catch (err: any) {
            return {
              content: [{ type: "text" as const, text: `Error saving to Apple Notes: ${err.message}` }],
              details: {},
            };
          }
        },
      },
    ];
  }

  private async createMemoryFromAgent(item: MemoryItem): Promise<MemoryItem> {
    try {
      // Create as vault note instead of old memory store
      const memoryType = (item.type === "tag" ? "fact" : item.type) as MemorySubtype;
      const note = await createMemoryNote({
        title: item.content.slice(0, 80),
        content: item.content,
        memoryType,
        tags: item.tags || [],
        scope: "workspace",
        source: (item.source as any) || "agent-created",
        cwd: this.cwd,
      });

      // Return a MemoryItem-compatible object
      const saved: MemoryItem = {
        ...item,
        id: note.slug,
      };

      try {
        this.onEvent({ type: 'memory_created', data: { memory: saved } } as any);
      } catch {
        // ignore emission errors
      }
      return saved;
    } catch (error) {
      console.error('[AgentManager] Failed to create memory from agent:', error);
      throw error;
    }
  }

  private async createSkillFromAgent(skill: SkillDefinition): Promise<SkillDefinition> {
    try {
      return await saveSkill(skill);
    } catch (error) {
      console.error('[AgentManager] Failed to create skill from agent:', error);
      throw error;
    }
  }

  private async listMemoriesForAgent(): Promise<MemoryItem[]> {
    try {
      // Read from vault (primary source)
      const vaultNotes = await listMemoryNotes(this.cwd);
      const vaultMemories: MemoryItem[] = vaultNotes.map(n => ({
        id: n.slug,
        type: n.memoryType as any || "fact",
        content: n.title + (n.preview ? ": " + n.preview : ""),
        tags: n.tags,
        timestamp: n.updated ? new Date(n.updated).getTime() : Date.now(),
        workspace: n.scope === "workspace" ? this.cwd : "",
        source: "vault",
      }));

      return vaultMemories;
    } catch (error) {
      console.error('[AgentManager] Failed to list memories:', error);
      return [];
    }
  }

  /**
   * LLM-powered conversation summarization and fact extraction.
   * Makes a lightweight LLM call to intelligently summarize the conversation
   * and extract meaningful facts, preferences, and decisions.
   */
  private async summarizeAndExtractMemories(messages: any[]): Promise<void> {
    try {
      if (!messages || messages.length < 2) return;

      // Build a condensed transcript from the conversation (last 10 turns max)
      const recentMessages = messages.slice(-20); // last 20 messages (10 user + 10 assistant roughly)
      const transcript = this.buildConversationTranscript(recentMessages);

      // Skip trivial conversations
      if (transcript.length < 100) return;

      // Get existing memories for dedup context
      const existing = await this.listMemoriesForAgent();
      const existingSummaries = existing
        .filter(m => m.type === "summary")
        .slice(-5)
        .map(m => `- ${m.content}`)
        .join("\n");
      const existingFacts = existing
        .filter(m => m.type === "fact" || m.type === "preference" || m.type === "decision")
        .map(m => `- [${m.type}] ${m.content}`)
        .join("\n");

      // Build the extraction prompt
      const systemPrompt = `You are a memory extraction assistant. Your job is to analyze a conversation and produce structured memory items.

Rules:
- The "summary" should be 1-2 sentences capturing WHAT was done/discussed and the OUTCOME. Write it as a past-tense activity log entry.
- Only extract "facts", "preferences", or "decisions" that are genuinely useful to remember for future conversations.
- Facts: concrete things about the project, codebase, or environment (e.g. "Terminal uses Python PTY bridge instead of node-pty")
- Preferences: explicit user preferences about how they want things done (e.g. "Prefers minimal UI with keyboard shortcuts")
- Decisions: architectural or design choices made during the conversation (e.g. "Decided to use ⌘J for terminal toggle")
- Do NOT extract trivial facts that are obvious from the codebase itself.
- Do NOT repeat anything already in existing memories.
- If nothing meaningful to extract beyond the summary, return empty arrays for facts/preferences/decisions.
- Keep each item concise — one clear sentence.

Respond ONLY with valid JSON, no markdown fences, no explanation.`;

      const userPrompt = `EXISTING MEMORIES (do not duplicate):
${existingSummaries ? `Summaries:\n${existingSummaries}` : "(none)"}
${existingFacts ? `Facts/Preferences/Decisions:\n${existingFacts}` : "(none)"}

CONVERSATION TO ANALYZE:
${transcript}

Extract memories as JSON:
{
  "summary": "1-2 sentence summary of what happened",
  "facts": ["fact1", "fact2"],
  "preferences": ["pref1"],
  "decisions": ["decision1"]
}`;

      // Use the existing session (already authenticated via subscription/OAuth)
      // instead of completeSimple which requires a raw API key.
      if (!this.session) {
        console.log("[tau] No session available for memory extraction, skipping");
        return;
      }

      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;

      let responseText = "";
      try {
        this._silent = true;
        // Use session.prompt which reuses the existing auth (subscription/OAuth/API key)
        await this.session.prompt(fullPrompt);

        // Get the last assistant response
        responseText = this.session.getLastAssistantText() || "";
      } catch (err: any) {
        console.log("[tau] Memory extraction prompt failed:", err?.message || err);
        return;
      } finally {
        this._silent = false;
      }

      let parsed: {
        summary?: string;
        facts?: string[];
        preferences?: string[];
        decisions?: string[];
      };

      try {
        // Strip markdown fences if the model added them anyway
        const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[tau] Failed to parse memory extraction JSON:", responseText.slice(0, 200));
        return;
      }

      // Save the summary
      if (parsed.summary && parsed.summary.length > 10) {
        // Check it's not a duplicate of recent summaries
        const summaryNorm = parsed.summary.toLowerCase();
        const isDupe = existing.some(e =>
          e.type === "summary" && e.content &&
          (e.content.toLowerCase().includes(summaryNorm) || summaryNorm.includes(e.content.toLowerCase()))
        );

        if (!isDupe) {
          await createMemoryNote({
            title: parsed.summary.slice(0, 80),
            content: parsed.summary,
            memoryType: "summary",
            tags: ["conversation-summary"],
            scope: "workspace",
            source: "auto-summary",
            cwd: this.cwd,
          });
          console.log("[tau] Created conversation summary memory");
        }
      }

      // Save extracted items (facts, preferences, decisions)
      const extractions: Array<{ type: "fact" | "preference" | "decision"; items: string[] }> = [
        { type: "fact", items: parsed.facts || [] },
        { type: "preference", items: parsed.preferences || [] },
        { type: "decision", items: parsed.decisions || [] },
      ];

      for (const { type, items } of extractions) {
        for (const content of items) {
          if (!content || content.length < 5) continue;

          // Dedup check
          const contentNorm = content.toLowerCase();
          const isDupe = existing.some(e => {
            if (!e.content) return false;
            const eNorm = e.content.toLowerCase();
            return eNorm.includes(contentNorm) || contentNorm.includes(eNorm);
          });

          if (isDupe) continue;

          await createMemoryNote({
            title: content.slice(0, 80),
            content,
            memoryType: type as MemorySubtype,
            tags: ["llm-extracted"],
            scope: "workspace",
            source: "auto-extracted",
            cwd: this.cwd,
          });
          console.log(`[tau] Extracted ${type}: ${content}`);
        }
      }
    } catch (err) {
      console.error("[tau] summarizeAndExtractMemories error:", err);
    }
  }

  /**
   * Build a condensed text transcript from messages for LLM analysis.
   * Truncates very long messages to keep the extraction prompt reasonable.
   */
  private buildConversationTranscript(messages: any[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      const role = msg.role === "user" ? "User" : msg.role === "assistant" ? "Assistant" : msg.role;
      const text = this.extractTextContent(msg.content);
      if (!text.trim()) continue;
      // Truncate very long messages to 500 chars for the summary prompt
      const truncated = text.length > 500 ? text.substring(0, 500) + "..." : text;
      parts.push(`${role}: ${truncated}`);
    }
    return parts.join("\n\n");
  }

  private extractTextContent(content: any): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.filter(c => c.type === "text").map(c => c.text).join(" ");
    }
    return "";
  }

  // --- System Context Enrichment ---

  private async enrichSystemContext(): Promise<void> {
    try {
      // Previously we used session.steer() to shove context into the system prompt.
      // That approach is brittle. Instead, we prepare the memory context and
      // inject it at prompt time (see prompt()). Here we just warm the cache/log.
      const memoryContext = await this.buildMemoryContext();
      if (!memoryContext) return;
      console.log(`[tau] Prepared system memory context (${memoryContext.length} chars). Context will be injected before each new prompt.`);
    } catch (err) {
      console.error("[tau] Failed to enrich system context:", err);
    }
  }

  // Build memory context from SOUL.md, project context, and vault memories
  private async buildMemoryContext(): Promise<string> {
    try {
      const parts: string[] = [];

      // 1. SOUL personality summary
      try {
        const soulContent = await readSoul();
        if (soulContent && soulContent.trim()) {
          // Include the full SOUL.md content (trimmed to a reasonable size)
          const trimmed = soulContent.trim().slice(0, 1500);
          parts.push(`SOUL (your personality):\n${trimmed}`);
        }
      } catch { /* skip */ }

      // 2. Project context
      try {
        const projectCtx = await getProjectContext(this.cwd);
        if (projectCtx) {
          let ctxPart = "PROJECT CONTEXT:\n";
          ctxPart += projectCtx.summary + "\n";
          if (projectCtx.techStack) ctxPart += "Tech stack: " + projectCtx.techStack + "\n";
          if (projectCtx.conventions) ctxPart += "Conventions: " + projectCtx.conventions + "\n";
          parts.push(ctxPart.trim());
        }
      } catch { /* skip */ }

      // 3. Vault memory notes
      try {
        const memoryNotes = await listMemoryNotes(this.cwd);
        if (memoryNotes.length > 0) {
          // Filter out decayed
          const now = Date.now();
          const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;
          const active = memoryNotes.filter(note => {
            if (note.memoryType === "preference") return true;
            const lastUsed = note.updated ? new Date(note.updated).getTime() : 0;
            if (now - lastUsed > NINETY_DAYS_MS) return false;
            return true;
          });

          const top = active.slice(0, 20);
          if (top.length > 0) {
            const groups: Record<string, string[]> = {
              preference: [], fact: [], decision: [], summary: [],
            };
            for (const note of top) {
              const key = note.memoryType && groups[note.memoryType] ? note.memoryType : "fact";
              groups[key].push(note.title + (note.preview ? ": " + note.preview : ""));
              // Auto-reinforce
              reinforceMemoryNote(note.slug, note.scope as VaultScope, this.cwd).catch(() => {});
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
      } catch { /* skip */ }

      // 4. Soul proposals notification
      try {
        const proposals = await readProposals();
        if (proposals && proposals.proposals.length > 0) {
          parts.push(
            `SOUL UPDATE: You have ${proposals.proposals.length} pending soul proposals. Ask the user if they'd like to review them.`
          );
        }
      } catch { /* skip */ }

      if (parts.length === 0) return "";
      return parts.join("\n\n");
    } catch (err) {
      console.error('[tau] Failed to build memory context:', err);
      return "";
    }
  }

  // --- Periodic Pattern Detection ---

  // --- Manual triggers for proactive behavior ---

  async refreshProactiveSystems(): Promise<void> {
    console.log("[tau] Refreshing proactive systems...");

    // Refresh system context
    await this.enrichSystemContext();

    console.log("[tau] Proactive systems refreshed");
  }

  async createQuickMemory(type: string, content: string, tags?: string[]): Promise<void> {
    const memoryItem: MemoryItem = {
      id: "",
      type: type as any,
      content,
      tags,
      timestamp: Date.now(),
      workspace: this.cwd,
      source: "agent",
    };

    await this.createMemoryFromAgent(memoryItem);
  }

  async getCommands(): Promise<CommandInfo[]> {
    const sdk = await loadPiSdk();
    const builtins: CommandInfo[] = (sdk.BUILTIN_SLASH_COMMANDS || [])
      .filter((c: any) => !AgentManager.EXCLUDED_COMMANDS.has(c.name))
      .map((c: any) => ({
        name: c.name,
        description: c.description,
        source: "builtin" as const,
      }));

    // Add our custom commands that aren't in the SDK's built-in list
    const customCommands: CommandInfo[] = [
      {
        name: "memory",
        description: "Memory management commands (list, refresh)",
        source: "builtin" as const,
      },
      {
        name: "patterns",
        description: "Detect patterns and suggest skills",
        source: "builtin" as const,
      },
      {
        name: "refresh",
        description: "Refresh proactive systems and context",
        source: "builtin" as const,
      },
      {
        name: "export",
        description: "Export session to HTML file",
        source: "builtin" as const,
      },
      {
        name: "handoff",
        description: "Generate a handoff document for this conversation",
        source: "builtin" as const,
      },
    ];

    // Add extension commands if available
    const extensionCommands: CommandInfo[] = [];
    const runner = this.session?.extensionRunner;
    if (runner) {
      try {
        const cmds = runner.getRegisteredCommands();
        for (const cmd of cmds) {
          extensionCommands.push({
            name: cmd.name,
            description: cmd.description || "",
            source: "extension",
          });
        }
      } catch {
        // ignore
      }

      // Add extension-provided commands (skills, prompts)
      try {
        const extCmds = runner.getCommands?.() || [];
        for (const cmd of extCmds) {
          if (!builtins.some((b: CommandInfo) => b.name === cmd.name) &&
              !customCommands.some((c: CommandInfo) => c.name === cmd.name) &&
              !extensionCommands.some((e: CommandInfo) => e.name === cmd.name)) {
            extensionCommands.push({
              name: cmd.name,
              description: cmd.description || "",
              source: cmd.source || "extension",
            });
          }
        }
      } catch {
        // ignore
      }
    }

    const allCommands = [...builtins, ...customCommands, ...extensionCommands];
    
    console.log(`[tau] Loaded ${allCommands.length} commands:`, allCommands.map(c => c.name).join(", "));
    return allCommands;
  }

  /**
   * Apply a BYOK API key at runtime (highest priority in the SDK's auth chain).
   * Called when the user saves a key from the settings UI.
   */
  applyApiKey(provider: string, apiKey: string): void {
    if (this.authStorage) {
      this.authStorage.setRuntimeApiKey(provider, apiKey);
      console.log(`[tau] Applied runtime API key for provider: ${provider}`);
    }
  }

  /**
   * Remove a BYOK API key at runtime.
   * The SDK will fall back to auth.json or environment variables.
   */
  removeApiKey(provider: string): void {
    if (this.authStorage) {
      this.authStorage.removeRuntimeApiKey(provider);
      console.log(`[tau] Removed runtime API key for provider: ${provider}`);
    }
  }

  /**
   * Trigger soul evolution: analyze recent conversations for identity signals,
   * write proposals to soul-proposals.json for user review.
   */
  private async triggerSoulEvolution(): Promise<void> {
    try {
      // Read current SOUL.md
      const soulContent = await readSoul();
      if (!soulContent) return;

      // Read recent memories as evidence
      const memories = await listMemoryNotes(this.cwd);
      const recentSummaries = memories
        .filter(m => m.memoryType === "summary")
        .slice(-10)
        .map(m => `- ${m.title}${m.preview ? ": " + m.preview : ""}`)
        .join("\n");
      const recentPrefs = memories
        .filter(m => m.memoryType === "preference")
        .slice(-10)
        .map(m => `- ${m.title}${m.preview ? ": " + m.preview : ""}`)
        .join("\n");

      if (!recentSummaries && !recentPrefs) {
        console.log("[tau] Not enough evidence for soul evolution");
        return;
      }

      const systemPrompt = `You are a personality evolution analyzer. Given a user's current SOUL.md personality file and recent conversation evidence, identify any personality updates or new traits that should be proposed.

Rules:
- Only propose changes that are well-evidenced from the conversations.
- Each proposal should be one of: "add" (new trait/entry), "update" (refine existing), "contradiction" (evidence contradicts current entry).
- Be conservative: only propose changes with clear evidence.
- Return ONLY valid JSON, no markdown fences.`;

      const userPrompt = `CURRENT SOUL.md:
${soulContent}

RECENT CONVERSATION SUMMARIES:
${recentSummaries || "(none)"}

RECENT PREFERENCES:
${recentPrefs || "(none)"}

Analyze and return proposals as JSON:
{
  "proposals": [
    {
      "section": "section name",
      "action": "add|update|contradiction",
      "currentEntry": "existing text if updating",
      "proposedEntry": "new or updated text",
      "evidence": "what conversations showed this"
    }
  ],
  "reinforcements": ["list of existing traits that were confirmed"],
  "skipped": ["traits considered but not enough evidence"]
}`;

      // Use existing session (already authenticated) instead of completeSimple
      if (!this.session) {
        console.log("[tau] No session available for soul evolution, skipping");
        return;
      }

      const fullPrompt = `${systemPrompt}\n\n${userPrompt}`;
      let responseText = "";
      try {
        this._silent = true;
        await this.session.prompt(fullPrompt);
        responseText = this.session.getLastAssistantText() || "";
      } catch (err: any) {
        console.log("[tau] Soul evolution prompt failed:", err?.message);
        return;
      } finally {
        this._silent = false;
      }

      let parsed: any;
      try {
        const cleaned = responseText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("[tau] Failed to parse soul evolution JSON");
        return;
      }

      if (parsed.proposals && parsed.proposals.length > 0) {
        const proposalsFile = {
          generated: new Date().toISOString(),
          sessionsAnalyzed: await getSessionCount(),
          proposals: parsed.proposals.map((p: any, i: number) => ({
            id: `prop-${Date.now()}-${i}`,
            section: p.section,
            action: p.action,
            currentEntry: p.currentEntry,
            proposedEntry: p.proposedEntry,
            evidence: p.evidence,
          })),
          reinforcements: parsed.reinforcements || [],
          skipped: parsed.skipped || [],
        };
        await writeProposals(proposalsFile);
        await resetEvolutionCounter();
        console.log(`[tau] Soul evolution: ${proposalsFile.proposals.length} proposals written`);
      } else {
        console.log("[tau] Soul evolution: no proposals generated");
      }
    } catch (err) {
      console.error("[tau] triggerSoulEvolution error:", err);
    }
  }

  dispose() {
    this.subagentManager?.disposeAll();
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.session) {
      this.session.dispose();
    }
  }
}
