/**
 * JSON-RPC 2.0 protocol types for the tau-daemon.
 *
 * Channel definitions (RPC, NOTIFY, IPC_TO_RPC, PUSH_CHANNELS, etc.)
 * are re-exported from the single source of truth in shared/ipc-schema.ts.
 */

// ── Re-export channel/mapping constants from schema ──────────────────
export {
  RPC,
  NOTIFY,
  ipcToRpc,
  notifyToIpc,
  PUSH_CHANNELS,
  isRequestChannel,
} from "../shared/ipc-schema";

// ── JSON-RPC 2.0 base types ──────────────────────────────────────────

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: any;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

/** Notification — no `id`, no response expected. */
export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: any;
}

// Standard error codes
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // Application errors (server-defined)
  AGENT_NOT_READY: -32000,
  DAEMON_SHUTTING_DOWN: -32001,
} as const;

// ── Heartbeat types ──────────────────────────────────────────────────

export interface HeartbeatParams {
  pid: number;
  uptime: number;
  cwd: string | null;
  isStreaming: boolean;
  activeSubagents: number;
  clientCount: number;
  memoryUsageMB: number;
  seq: number;
}

// ── Recovery types ───────────────────────────────────────────────────

export interface RecoverRequest {
  clientId: string;
  lastSeq: number;
}

export interface RecoverResponse {
  status: any;
  history: any[];
  subagents: any[];
  bufferedEvents: JsonRpcNotification[];
  fullRecoveryRequired: boolean;
}

// ── PID file ─────────────────────────────────────────────────────────

export interface PidFileContent {
  pid: number;
  socketPath: string;
  startedAt: number;
  version: string;
}

// ── Client tracking ──────────────────────────────────────────────────

export interface DaemonClient {
  id: string;
  connectedAt: number;
  lastSeq: number;
}
