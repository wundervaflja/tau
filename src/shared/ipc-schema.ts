/**
 * Single source of truth for all IPC channels, RPC methods, and push/notification mappings.
 *
 * Every channel is defined ONCE here. The exported constants (IPC, RPC, NOTIFY,
 * IPC_TO_RPC, NOTIFY_TO_IPC, PUSH_CHANNELS) are all derived from this schema.
 *
 * To add a new channel:
 *   1. Add an entry to the appropriate section of SCHEMA below.
 *   2. Everything else (IPC constants, RPC constants, mappings) is auto-generated.
 */

// ── Schema definition ──────────────────────────────────────────────────

interface ChannelDef {
  /** Constant key used in code, e.g. "AGENT_PROMPT" */
  key: string;
  /** Electron IPC channel name, e.g. "agent:prompt" */
  ipc: string;
  /** Daemon RPC method name, e.g. "agent.prompt" */
  rpc: string;
}

interface PushChannelDef {
  /** Electron IPC channel name */
  ipc: string;
  /** Daemon notification method (if proxied through daemon) */
  notify?: string;
}

// ── Request/response channels ──────────────────────────────────────────
// These use ipcRenderer.invoke() / ipcMain.handle()

const REQUEST_CHANNELS: ChannelDef[] = [
  // Agent
  { key: "AGENT_PROMPT",          ipc: "agent:prompt",              rpc: "agent.prompt" },
  { key: "AGENT_ABORT",           ipc: "agent:abort",               rpc: "agent.abort" },
  { key: "AGENT_NEW_SESSION",     ipc: "agent:new-session",         rpc: "agent.newSession" },
  { key: "AGENT_STATUS",          ipc: "agent:status",              rpc: "agent.status" },

  // Sessions
  { key: "SESSION_RECOMPACT",     ipc: "session:recompact",         rpc: "session.recompact" },
  { key: "SESSION_DELETE",        ipc: "session:delete",            rpc: "session.delete" },
  { key: "SESSION_DELETE_FOLDER", ipc: "session:delete-folder",     rpc: "session.deleteFolder" },
  { key: "SESSION_LIST",          ipc: "session:list",              rpc: "session.list" },
  { key: "SESSION_HISTORY",       ipc: "session:history",           rpc: "session.history" },
  { key: "SESSION_LIST_ALL",      ipc: "session:list-all",          rpc: "session.listAll" },
  { key: "SESSION_SWITCH",        ipc: "session:switch",            rpc: "session.switch" },
  { key: "SESSION_RENAME",        ipc: "session:rename",            rpc: "session.rename" },
  { key: "SESSION_GET_TREE",      ipc: "session:get-tree",          rpc: "session.getTree" },
  { key: "SESSION_NAVIGATE_TREE", ipc: "session:navigate-tree",     rpc: "session.navigateTree" },
  { key: "SESSION_FORK",          ipc: "session:fork",              rpc: "session.fork" },
  { key: "SESSION_GET_FORK_MESSAGES", ipc: "session:get-fork-messages", rpc: "session.getForkMessages" },
  { key: "SESSION_LAST_ASSISTANT_TEXT", ipc: "session:last-assistant-text", rpc: "session.lastAssistantText" },
  { key: "SESSION_EXPORT_HTML",   ipc: "session:export-html",       rpc: "session.exportHtml" },

  // Models
  { key: "MODEL_LIST",            ipc: "model:list",                rpc: "model.list" },
  { key: "MODEL_SET",             ipc: "model:set",                 rpc: "model.set" },
  { key: "MODEL_CURRENT",         ipc: "model:current",             rpc: "model.current" },
  { key: "MODEL_CYCLE",           ipc: "model:cycle",               rpc: "model.cycle" },

  // Thinking
  { key: "THINKING_GET",          ipc: "thinking:get",              rpc: "thinking.get" },
  { key: "THINKING_SET",          ipc: "thinking:set",              rpc: "thinking.set" },
  { key: "THINKING_CYCLE",        ipc: "thinking:cycle",            rpc: "thinking.cycle" },

  // Subagents
  { key: "SUBAGENT_SPAWN",        ipc: "subagent:spawn",            rpc: "subagent.spawn" },
  { key: "SUBAGENT_PROMPT",       ipc: "subagent:prompt",           rpc: "subagent.prompt" },
  { key: "SUBAGENT_ABORT",        ipc: "subagent:abort",            rpc: "subagent.abort" },
  { key: "SUBAGENT_CLOSE",        ipc: "subagent:close",            rpc: "subagent.close" },
  { key: "SUBAGENT_LIST",         ipc: "subagent:list",             rpc: "subagent.list" },
  { key: "SUBAGENT_HISTORY",      ipc: "subagent:history",          rpc: "subagent.history" },
  { key: "SUBAGENT_MESSAGE",      ipc: "subagent:message",          rpc: "subagent.message" },
  { key: "SUBAGENT_BUS_HISTORY",  ipc: "subagent:bus-history",      rpc: "subagent.busHistory" },

  // Commands
  { key: "COMMAND_LIST",           ipc: "command:list",             rpc: "command.list" },

  // Git
  { key: "GIT_STATUS",            ipc: "git:status",                rpc: "git.status" },
  { key: "GIT_BRANCHES",          ipc: "git:branches",              rpc: "git.branches" },
  { key: "GIT_CHECKOUT",          ipc: "git:checkout",              rpc: "git.checkout" },
  { key: "GIT_CHECKOUT_NEW",      ipc: "git:checkout-new",          rpc: "git.checkoutNew" },
  { key: "GIT_STAGE",             ipc: "git:stage",                 rpc: "git.stage" },
  { key: "GIT_UNSTAGE",           ipc: "git:unstage",               rpc: "git.unstage" },
  { key: "GIT_STAGE_ALL",         ipc: "git:stage-all",             rpc: "git.stageAll" },
  { key: "GIT_DISCARD",           ipc: "git:discard",               rpc: "git.discard" },
  { key: "GIT_DIFF",              ipc: "git:diff",                  rpc: "git.diff" },
  { key: "FILES_LIST",            ipc: "files:list",                rpc: "files.list" },
  { key: "SYMBOLS_SEARCH",        ipc: "symbols:search",            rpc: "symbols.search" },
  { key: "SYMBOL_READ",           ipc: "symbol:read",               rpc: "symbol.read" },

  // App / Workspace
  { key: "APP_GET_CWD",           ipc: "app:get-cwd",              rpc: "app.getCwd" },
  { key: "APP_SELECT_DIR",        ipc: "app:select-dir",           rpc: "app.selectDir" },
  { key: "APP_OPEN_DIR",          ipc: "app:open-dir",             rpc: "app.openDir" },
  { key: "APP_GET_THEME",         ipc: "app:get-theme",            rpc: "app.getTheme" },
  { key: "APP_SET_THEME",         ipc: "app:set-theme",            rpc: "app.setTheme" },

  // Memory
  { key: "MEMORY_LIST",           ipc: "memory:list",              rpc: "memory.list" },
  { key: "MEMORY_ADD",            ipc: "memory:add",               rpc: "memory.add" },
  { key: "MEMORY_DELETE",         ipc: "memory:delete",            rpc: "memory.delete" },

  // Notes
  { key: "NOTES_LIST",            ipc: "notes:list",               rpc: "notes.list" },
  { key: "NOTES_ADD",             ipc: "notes:add",                rpc: "notes.add" },
  { key: "NOTES_DELETE",          ipc: "notes:delete",             rpc: "notes.delete" },

  // Journal
  { key: "JOURNAL_LIST",          ipc: "journal:list",             rpc: "journal.list" },
  { key: "JOURNAL_READ",          ipc: "journal:read",             rpc: "journal.read" },
  { key: "JOURNAL_SAVE",          ipc: "journal:save",             rpc: "journal.save" },
  { key: "JOURNAL_CREATE",        ipc: "journal:create",           rpc: "journal.create" },
  { key: "JOURNAL_CREATE_LINK",   ipc: "journal:create-link",      rpc: "journal.createLink" },
  { key: "JOURNAL_DELETE",        ipc: "journal:delete",           rpc: "journal.delete" },
  { key: "JOURNAL_PROCESS_BLOCK", ipc: "journal:process-block",    rpc: "journal.processBlock" },

  // Skills
  { key: "SKILL_LIST",            ipc: "skill:list",               rpc: "skill.list" },
  { key: "SKILL_SAVE",            ipc: "skill:save",               rpc: "skill.save" },
  { key: "SKILL_DELETE",          ipc: "skill:delete",             rpc: "skill.delete" },
  { key: "SKILL_RUN",             ipc: "skill:run",                rpc: "skill.run" },

  // Heartbeat
  { key: "HEARTBEAT_STATUS",      ipc: "heartbeat:status",         rpc: "heartbeat.status" },
  { key: "HEARTBEAT_SET_INTERVAL", ipc: "heartbeat:set-interval",  rpc: "heartbeat.setInterval" },
  { key: "HEARTBEAT_SET_ENABLED", ipc: "heartbeat:set-enabled",    rpc: "heartbeat.setEnabled" },

  // Telemetry
  { key: "TELEMETRY_ADD",         ipc: "telemetry:add",            rpc: "telemetry.add" },

  // Agent-initiated
  { key: "MEMORY_CREATE_FROM_AGENT",    ipc: "memory:create-from-agent",    rpc: "memory.createFromAgent" },
  { key: "SKILL_CREATE_FROM_AGENT",     ipc: "skill:create-from-agent",     rpc: "skill.createFromAgent" },

  // Proactive
  { key: "AGENT_REFRESH_PROACTIVE", ipc: "agent:refresh-proactive", rpc: "agent.refreshProactive" },

  // Workspace
  { key: "WORKSPACE_GET_STATE",    ipc: "workspace:get-state",     rpc: "workspace.getState" },
  { key: "WORKSPACE_LIST_RECENT",  ipc: "workspace:list-recent",   rpc: "workspace.listRecent" },
  { key: "WORKSPACE_SET_PERSONA",  ipc: "workspace:set-persona",   rpc: "workspace.setPersona" },
  { key: "WORKSPACE_UPDATE_CONFIG", ipc: "workspace:update-config", rpc: "workspace.updateConfig" },
  { key: "WORKSPACE_OPEN",        ipc: "workspace:open",           rpc: "workspace.open" },

  // App Config
  { key: "APP_GET_CONFIG",         ipc: "app:get-config",          rpc: "app.getConfig" },
  { key: "APP_SET_DEFAULT_PERSONA", ipc: "app:set-default-persona", rpc: "app.setDefaultPersona" },

  // Tasks
  { key: "TASKS_LOAD",            ipc: "tasks:load",               rpc: "tasks.load" },
  { key: "TASKS_SAVE",            ipc: "tasks:save",               rpc: "tasks.save" },

  // API Keys (BYOK)
  { key: "API_KEYS_LIST",         ipc: "api-keys:list",            rpc: "apiKeys.list" },
  { key: "API_KEYS_SET",          ipc: "api-keys:set",             rpc: "apiKeys.set" },
  { key: "API_KEYS_DELETE",       ipc: "api-keys:delete",          rpc: "apiKeys.delete" },
  { key: "API_KEYS_PROVIDERS",    ipc: "api-keys:providers",       rpc: "apiKeys.providers" },

  // Soul
  { key: "SOUL_STATUS",           ipc: "soul:status",              rpc: "soul.status" },
  { key: "SOUL_READ",             ipc: "soul:read",                rpc: "soul.read" },
  { key: "SOUL_WRITE",            ipc: "soul:write",               rpc: "soul.write" },
  { key: "SOUL_PROPOSALS_READ",   ipc: "soul:proposals-read",      rpc: "soul.proposalsRead" },
  { key: "SOUL_PROPOSALS_CLEAR",  ipc: "soul:proposals-clear",     rpc: "soul.proposalsClear" },

  // Vault (unified: memories + knowledge)
  { key: "VAULT_LIST",            ipc: "vault:list",               rpc: "vault.list" },
  { key: "VAULT_READ",            ipc: "vault:read",               rpc: "vault.read" },
  { key: "VAULT_CREATE",          ipc: "vault:create",             rpc: "vault.create" },
  { key: "VAULT_UPDATE",          ipc: "vault:update",             rpc: "vault.update" },
  { key: "VAULT_DELETE",          ipc: "vault:delete",             rpc: "vault.delete" },
  { key: "VAULT_SEARCH",          ipc: "vault:search",             rpc: "vault.search" },
  { key: "VAULT_CAPTURE",         ipc: "vault:capture",            rpc: "vault.capture" },
  { key: "VAULT_GRAPH",           ipc: "vault:graph",              rpc: "vault.graph" },
  { key: "VAULT_REINFORCE",       ipc: "vault:reinforce",          rpc: "vault.reinforce" },
  { key: "VAULT_DECAY_RUN",       ipc: "vault:decay-run",          rpc: "vault.decayRun" },
  { key: "VAULT_ARCHIVE_LIST",    ipc: "vault:archive-list",       rpc: "vault.archiveList" },
  { key: "VAULT_RESTORE",         ipc: "vault:restore",            rpc: "vault.restore" },

  // Project Context
  { key: "PROJECT_CTX_GET",       ipc: "project-ctx:get",          rpc: "projectCtx.get" },
  { key: "PROJECT_CTX_SET",       ipc: "project-ctx:set",          rpc: "projectCtx.set" },
  { key: "PROJECT_CTX_LIST",      ipc: "project-ctx:list",         rpc: "projectCtx.list" },
];

// ── Push/notification channels ─────────────────────────────────────────
// These use ipcRenderer.on() for events pushed from main/daemon.

const PUSH_CHANNEL_DEFS: PushChannelDef[] = [
  // Daemon-pushed notifications (proxied through main process)
  { ipc: "agent:event",     notify: "daemon.agent.event" },
  { ipc: "subagent:event",  notify: "daemon.subagent.event" },
  { ipc: "git:changed",     notify: "daemon.git.changed" },
  { ipc: "tasks:changed",   notify: "daemon.tasks.changed" },
  // Electron-native push (not from daemon)
  { ipc: "app:get-theme" },
  // PTY channels (handled in Electron main, not proxied to daemon)
  { ipc: "pty:create" },
  { ipc: "pty:write" },
  { ipc: "pty:resize" },
  { ipc: "pty:close" },
  { ipc: "pty:data" },
  { ipc: "pty:exit" },
];

// ── Daemon-only RPC methods (no IPC equivalent) ────────────────────────

const DAEMON_ONLY_RPC = {
  GAL_STATUS: "gal.status",
  GAL_LOCKS: "gal.locks",
  DAEMON_HEALTH: "daemon.health",
  DAEMON_SHUTDOWN: "daemon.shutdown",
  DAEMON_RECOVER: "daemon.recover",
} as const;

// ── Daemon-only notification methods ───────────────────────────────────

const DAEMON_ONLY_NOTIFY = {
  HEARTBEAT: "daemon.heartbeat",
  GAL_EVENT: "daemon.gal.event",
} as const;

// ── Generated constants ────────────────────────────────────────────────

/** IPC channel constants (Electron IPC channel names). */
export const IPC = Object.fromEntries([
  ...REQUEST_CHANNELS.map((c) => [c.key, c.ipc]),
  // Push channels that also appear as IPC constants
  ...PUSH_CHANNEL_DEFS.map((p) => {
    // Derive key from ipc: "agent:event" → "AGENT_EVENT", "pty:data" → "PTY_DATA"
    const key = p.ipc.replace(/[-:]/g, "_").toUpperCase();
    return [key, p.ipc];
  }),
]) as Record<string, string>;

/** Daemon RPC method constants. */
export const RPC = {
  ...Object.fromEntries(REQUEST_CHANNELS.map((c) => [c.key, c.rpc])),
  ...DAEMON_ONLY_RPC,
} as Record<string, string>;

/** Daemon notification method constants (daemon → client push). */
export const NOTIFY = {
  ...Object.fromEntries(
    PUSH_CHANNEL_DEFS
      .filter((p) => p.notify)
      .map((p) => {
        const key = p.ipc.replace(/[-:]/g, "_").toUpperCase();
        return [key, p.notify!];
      }),
  ),
  ...DAEMON_ONLY_NOTIFY,
} as Record<string, string>;

/** Map from IPC channel name → RPC method name. */
const _ipcToRpcMap: Record<string, string> = Object.fromEntries(
  REQUEST_CHANNELS.map((c) => [c.ipc, c.rpc]),
);

/** Convert an IPC channel name to its daemon RPC method name. */
export function ipcToRpc(channel: string): string | undefined {
  return _ipcToRpcMap[channel];
}

/** Map from notification method → IPC channel name. */
const _notifyToIpcMap: Record<string, string> = Object.fromEntries(
  PUSH_CHANNEL_DEFS
    .filter((p) => p.notify)
    .map((p) => [p.notify!, p.ipc]),
);

/** Convert a daemon notification method to its IPC channel. */
export function notifyToIpc(method: string): string | undefined {
  return _notifyToIpcMap[method];
}

/** Set of IPC channels that use push (`.on`) instead of request/response (`.invoke`). */
export const PUSH_CHANNELS = new Set(PUSH_CHANNEL_DEFS.map((p) => p.ipc));

/** Returns true if the channel is a request/response channel (not push). */
export function isRequestChannel(channel: string): boolean {
  return !PUSH_CHANNELS.has(channel);
}
