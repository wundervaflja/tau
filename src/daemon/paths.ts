/**
 * Platform-aware path resolution for the daemon process.
 * Replaces Electron's `app.getPath("userData")` so that stores,
 * workspace configs, and daemon runtime files can be resolved
 * without depending on Electron.
 */
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

// ── Data directory (same location Electron uses) ──────────────────────

function resolveUserDataDir(): string {
  const home = os.homedir();
  switch (process.platform) {
    case "darwin":
      return path.join(home, "Library", "Application Support", "tau");
    case "win32":
      return path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "tau");
    default:
      // Linux / FreeBSD
      return path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "tau");
  }
}

/** Stores data directory — equivalent to `app.getPath("userData") + "/tau"` */
export function getDataDir(): string {
  return resolveUserDataDir();
}

/** Ensure the data directory exists and return its path. */
export async function ensureDataDir(): Promise<string> {
  const dir = getDataDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// ── Daemon runtime directory ──────────────────────────────────────────

function resolveDaemonDir(): string {
  return path.join(os.homedir(), ".tau", "daemon");
}

/** Directory for daemon runtime files (PID, socket). */
export function getDaemonDir(): string {
  return resolveDaemonDir();
}

/** Ensure the daemon directory exists and return its path. */
export async function ensureDaemonDir(): Promise<string> {
  const dir = getDaemonDir();
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** PID file path. */
export function getPidFilePath(): string {
  return path.join(getDaemonDir(), "tau-daemon.pid");
}

/** Socket path (Unix domain socket or Windows named pipe). */
export function getSocketPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\tau-daemon";
  }
  return path.join(getDaemonDir(), "tau-daemon.sock");
}
