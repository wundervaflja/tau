import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared/ipc-channels';
import type { AgentEvent } from './shared/types';

/**
 * Subscribe to an IPC push channel. Returns an unsubscribe function.
 * Multiple subscribers can coexist without clobbering each other.
 */
function subscribe<T>(channel: string, transform: (event: any, ...args: any[]) => T, cb: (data: T) => void): () => void {
  const handler = (...args: any[]) => cb(transform(...args));
  ipcRenderer.on(channel, handler);
  return () => { ipcRenderer.removeListener(channel, handler); };
}

const bridge = {
  prompt: (text: string) => ipcRenderer.invoke(IPC.AGENT_PROMPT, text),
  abort: () => ipcRenderer.invoke(IPC.AGENT_ABORT),
  newSession: () => ipcRenderer.invoke(IPC.AGENT_NEW_SESSION),
  getStatus: () => ipcRenderer.invoke(IPC.AGENT_STATUS),
  onAgentEvent: (cb: (event: AgentEvent) => void) =>
    subscribe(IPC.AGENT_EVENT, (_: any, event: AgentEvent) => event, cb),
  deleteSession: (file: string) => ipcRenderer.invoke(IPC.SESSION_DELETE, file),
  deleteSessionFolder: (files: string[]) => ipcRenderer.invoke(IPC.SESSION_DELETE_FOLDER, files),
  recompact: (instructions: string) => ipcRenderer.invoke(IPC.SESSION_RECOMPACT, instructions),
  listSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST),
  getSessionHistory: () => ipcRenderer.invoke(IPC.SESSION_HISTORY),
  listAllSessions: () => ipcRenderer.invoke(IPC.SESSION_LIST_ALL),
  switchSession: (path: string) => ipcRenderer.invoke(IPC.SESSION_SWITCH, path),
  renameSession: (path: string, newName: string) => ipcRenderer.invoke(IPC.SESSION_RENAME, path, newName),
  getSessionTree: () => ipcRenderer.invoke(IPC.SESSION_GET_TREE),
  navigateTree: (targetId: string, opts?: { summarize?: boolean; customInstructions?: string }) =>
    ipcRenderer.invoke(IPC.SESSION_NAVIGATE_TREE, targetId, opts),
  forkSession: (entryId: string) => ipcRenderer.invoke(IPC.SESSION_FORK, entryId),
  getForkMessages: () => ipcRenderer.invoke(IPC.SESSION_GET_FORK_MESSAGES),
  getLastAssistantText: () => ipcRenderer.invoke(IPC.SESSION_LAST_ASSISTANT_TEXT),
  exportSessionHtml: () => ipcRenderer.invoke(IPC.SESSION_EXPORT_HTML),
  listModels: () => ipcRenderer.invoke(IPC.MODEL_LIST),
  setModel: (provider: string, id: string) => ipcRenderer.invoke(IPC.MODEL_SET, provider, id),
  getCurrentModel: () => ipcRenderer.invoke(IPC.MODEL_CURRENT),
  cycleModel: () => ipcRenderer.invoke(IPC.MODEL_CYCLE),
  getThinkingLevel: () => ipcRenderer.invoke(IPC.THINKING_GET),
  setThinkingLevel: (level: string) => ipcRenderer.invoke(IPC.THINKING_SET, level),
  cycleThinkingLevel: () => ipcRenderer.invoke(IPC.THINKING_CYCLE),
  listCommands: () => ipcRenderer.invoke(IPC.COMMAND_LIST),

  // Subagents
  spawnSubagents: (configs: any[]) => ipcRenderer.invoke(IPC.SUBAGENT_SPAWN, configs),
  subagentPrompt: (id: string, text: string) => ipcRenderer.invoke(IPC.SUBAGENT_PROMPT, id, text),
  subagentAbort: (id: string) => ipcRenderer.invoke(IPC.SUBAGENT_ABORT, id),
  closeSubagent: (id: string) => ipcRenderer.invoke(IPC.SUBAGENT_CLOSE, id),
  listSubagents: () => ipcRenderer.invoke(IPC.SUBAGENT_LIST),
  subagentHistory: (id: string) => ipcRenderer.invoke(IPC.SUBAGENT_HISTORY, id),
  sendAgentMessage: (fromId: string, toId: string, text: string) => ipcRenderer.invoke(IPC.SUBAGENT_MESSAGE, fromId, toId, text),
  getBusHistory: () => ipcRenderer.invoke(IPC.SUBAGENT_BUS_HISTORY),
  onSubagentEvent: (cb: (evt: any) => void) =>
    subscribe(IPC.SUBAGENT_EVENT, (_: any, evt: any) => evt, cb),

  gitStatus: () => ipcRenderer.invoke(IPC.GIT_STATUS),
  gitBranches: () => ipcRenderer.invoke(IPC.GIT_BRANCHES),
  gitCheckout: (target: string, isFile = false) => ipcRenderer.invoke(IPC.GIT_CHECKOUT, target, isFile),
  gitCheckoutNew: (name: string) => ipcRenderer.invoke(IPC.GIT_CHECKOUT_NEW, name),
  gitStage: (file: string) => ipcRenderer.invoke(IPC.GIT_STAGE, file),
  gitUnstage: (file: string) => ipcRenderer.invoke(IPC.GIT_UNSTAGE, file),
  gitStageAll: () => ipcRenderer.invoke(IPC.GIT_STAGE_ALL),
  gitDiscard: (file: string) => ipcRenderer.invoke(IPC.GIT_DISCARD, file),
  gitDiff: (file: string, staged: boolean) => ipcRenderer.invoke(IPC.GIT_DIFF, file, staged),
  onGitChanged: (cb: () => void) =>
    subscribe(IPC.GIT_CHANGED, () => undefined, () => cb()),
  openDirectory: (dir: string) => ipcRenderer.invoke(IPC.APP_OPEN_DIR, dir),
  getCwd: () => ipcRenderer.invoke(IPC.APP_GET_CWD),
  listFiles: (query?: string) => ipcRenderer.invoke(IPC.FILES_LIST, query ?? ""),
  symbolsSearch: (query?: string, file?: string) => ipcRenderer.invoke(IPC.SYMBOLS_SEARCH, query ?? "", file ?? null),
  symbolRead: (file: string, line: number) => ipcRenderer.invoke(IPC.SYMBOL_READ, file, line),
  selectDirectory: () => ipcRenderer.invoke(IPC.APP_SELECT_DIR),
  getTheme: () => ipcRenderer.invoke(IPC.APP_GET_THEME),
  setTheme: (theme: "system" | "light" | "dark") => ipcRenderer.invoke(IPC.APP_SET_THEME, theme),
  onThemeChange: (cb: (theme: string) => void) =>
    subscribe(IPC.APP_GET_THEME, (_: any, theme: string) => theme, cb),

  // Memory
  memoryList: () => ipcRenderer.invoke(IPC.MEMORY_LIST),
  memoryAdd: (item: any) => ipcRenderer.invoke(IPC.MEMORY_ADD, item),
  memoryDelete: (id: string) => ipcRenderer.invoke(IPC.MEMORY_DELETE, id),

  // Notes
  notesList: () => ipcRenderer.invoke(IPC.NOTES_LIST),
  notesAdd: (item: any) => ipcRenderer.invoke(IPC.NOTES_ADD, item),
  notesDelete: (id: string) => ipcRenderer.invoke(IPC.NOTES_DELETE, id),

  // Journal
  journalList: () => ipcRenderer.invoke(IPC.JOURNAL_LIST),
  journalRead: (name: string) => ipcRenderer.invoke(IPC.JOURNAL_READ, name),
  journalSave: (name: string, content: string) => ipcRenderer.invoke(IPC.JOURNAL_SAVE, name, content),
  journalCreate: (name?: string) => ipcRenderer.invoke(IPC.JOURNAL_CREATE, name),
  journalCreateLink: (title: string) => ipcRenderer.invoke(IPC.JOURNAL_CREATE_LINK, title),
  journalDelete: (name: string) => ipcRenderer.invoke(IPC.JOURNAL_DELETE, name),
  journalProcessBlock: (text: string, entryName: string) => ipcRenderer.invoke(IPC.JOURNAL_PROCESS_BLOCK, text, entryName),

  // Skills
  skillList: () => ipcRenderer.invoke(IPC.SKILL_LIST),
  skillSave: (skill: any) => ipcRenderer.invoke(IPC.SKILL_SAVE, skill),
  skillDelete: (id: string) => ipcRenderer.invoke(IPC.SKILL_DELETE, id),
  skillRun: (id: string, input?: any) => ipcRenderer.invoke(IPC.SKILL_RUN, id, input),

  // Heartbeat
  heartbeatStatus: () => ipcRenderer.invoke(IPC.HEARTBEAT_STATUS),
  heartbeatSetInterval: (ms: number) => ipcRenderer.invoke(IPC.HEARTBEAT_SET_INTERVAL, ms),
  heartbeatSetEnabled: (enabled: boolean) => ipcRenderer.invoke(IPC.HEARTBEAT_SET_ENABLED, enabled),

  // Telemetry
  telemetryAdd: (entry: any) => ipcRenderer.invoke(IPC.TELEMETRY_ADD, entry),

  // Agent-initiated memory/skill creation
  memoryCreateFromAgent: (item: any) => ipcRenderer.invoke(IPC.MEMORY_CREATE_FROM_AGENT, item),
  skillCreateFromAgent: (skill: any) => ipcRenderer.invoke(IPC.SKILL_CREATE_FROM_AGENT, skill),

  // Proactive behavior triggers
  refreshProactive: () => ipcRenderer.invoke(IPC.AGENT_REFRESH_PROACTIVE),

  // Workspace
  workspaceGetState: (folderPath?: string) => ipcRenderer.invoke(IPC.WORKSPACE_GET_STATE, folderPath),
  workspaceListRecent: () => ipcRenderer.invoke(IPC.WORKSPACE_LIST_RECENT),
  workspaceSetPersona: (folderPath: string, persona: string | null) => ipcRenderer.invoke(IPC.WORKSPACE_SET_PERSONA, folderPath, persona),
  workspaceUpdateConfig: (folderPath: string, patch: any) => ipcRenderer.invoke(IPC.WORKSPACE_UPDATE_CONFIG, folderPath, patch),
  workspaceOpen: (folderPath: string) => ipcRenderer.invoke(IPC.WORKSPACE_OPEN, folderPath),

  // App config
  appGetConfig: () => ipcRenderer.invoke(IPC.APP_GET_CONFIG),
  appSetDefaultPersona: (persona: string) => ipcRenderer.invoke(IPC.APP_SET_DEFAULT_PERSONA, persona),

  // Tasks
  tasksLoad: () => ipcRenderer.invoke(IPC.TASKS_LOAD),
  tasksSave: (tasks: any[]) => ipcRenderer.invoke(IPC.TASKS_SAVE, tasks),
  onTasksChanged: (cb: (tasks: any[]) => void) =>
    subscribe(IPC.TASKS_CHANGED, (_: any, tasks: any[]) => tasks, cb),

  // API Keys (BYOK)
  apiKeysList: () => ipcRenderer.invoke(IPC.API_KEYS_LIST),
  apiKeysSet: (provider: string, key: string, label: string) => ipcRenderer.invoke(IPC.API_KEYS_SET, provider, key, label),
  apiKeysDelete: (provider: string) => ipcRenderer.invoke(IPC.API_KEYS_DELETE, provider),
  apiKeysProviders: () => ipcRenderer.invoke(IPC.API_KEYS_PROVIDERS),

  // Soul
  soulStatus: () => ipcRenderer.invoke(IPC.SOUL_STATUS),
  soulRead: () => ipcRenderer.invoke(IPC.SOUL_READ),
  soulWrite: (content: string) => ipcRenderer.invoke(IPC.SOUL_WRITE, content),
  soulProposalsRead: () => ipcRenderer.invoke(IPC.SOUL_PROPOSALS_READ),
  soulProposalsClear: () => ipcRenderer.invoke(IPC.SOUL_PROPOSALS_CLEAR),

  // Vault (unified: memories + knowledge)
  vaultList: (opts?: any) => ipcRenderer.invoke(IPC.VAULT_LIST, opts),
  vaultRead: (slug: string, scope: string) => ipcRenderer.invoke(IPC.VAULT_READ, slug, scope),
  vaultCreate: (opts: any) => ipcRenderer.invoke(IPC.VAULT_CREATE, opts),
  vaultUpdate: (slug: string, scope: string, body: string) => ipcRenderer.invoke(IPC.VAULT_UPDATE, slug, scope, body),
  vaultDelete: (slug: string, scope: string) => ipcRenderer.invoke(IPC.VAULT_DELETE, slug, scope),
  vaultSearch: (query: string, opts?: any) => ipcRenderer.invoke(IPC.VAULT_SEARCH, query, opts),
  vaultCapture: (content: string, scope: string) => ipcRenderer.invoke(IPC.VAULT_CAPTURE, content, scope),
  vaultGraph: () => ipcRenderer.invoke(IPC.VAULT_GRAPH),
  vaultReinforce: (slug: string, scope: string) => ipcRenderer.invoke(IPC.VAULT_REINFORCE, slug, scope),
  vaultDecayRun: () => ipcRenderer.invoke(IPC.VAULT_DECAY_RUN),
  vaultArchiveList: () => ipcRenderer.invoke(IPC.VAULT_ARCHIVE_LIST),
  vaultRestore: (slug: string, scope: string) => ipcRenderer.invoke(IPC.VAULT_RESTORE, slug, scope),

  // Project Context
  projectCtxGet: (workspace: string) => ipcRenderer.invoke(IPC.PROJECT_CTX_GET, workspace),
  projectCtxSet: (ctx: any) => ipcRenderer.invoke(IPC.PROJECT_CTX_SET, ctx),
  projectCtxList: () => ipcRenderer.invoke(IPC.PROJECT_CTX_LIST),

  // Terminal (PTY)
  ptyCreate: (cwd: string, cols: number, rows: number) => ipcRenderer.invoke(IPC.PTY_CREATE, cwd, cols, rows),
  ptyWrite: (id: string, data: string) => ipcRenderer.invoke(IPC.PTY_WRITE, id, data),
  ptyResize: (id: string, cols: number, rows: number) => ipcRenderer.invoke(IPC.PTY_RESIZE, id, cols, rows),
  ptyClose: (id: string) => ipcRenderer.invoke(IPC.PTY_CLOSE, id),
  onPtyData: (cb: (id: string, data: string) => void) => {
    const handler = (_e: any, payload: { id: string; data: string }) => cb(payload.id, payload.data);
    ipcRenderer.on(IPC.PTY_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_DATA, handler);
  },
  onPtyExit: (cb: (id: string, exitCode: number) => void) => {
    const handler = (_e: any, payload: { id: string; exitCode: number }) => cb(payload.id, payload.exitCode);
    ipcRenderer.on(IPC.PTY_EXIT, handler);
    return () => ipcRenderer.removeListener(IPC.PTY_EXIT, handler);
  },
};

export type TauBridge = typeof bridge;
/** @deprecated Use TauBridge instead */
export type PiBridge = TauBridge;
contextBridge.exposeInMainWorld('tauBridge', bridge);
