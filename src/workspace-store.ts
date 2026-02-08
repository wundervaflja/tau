import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { ensureDataDir } from "./daemon/paths";
import type {
  WorkspaceConfig,
  WorkspaceSettings,
  AppConfig,
  PersonaId,
  DEFAULT_APP_CONFIG,
  DEFAULT_WORKSPACE_SETTINGS,
  SCRATCH_WORKSPACE_ID,
} from "./shared/workspace-types";
import type { PersonaCapabilities, WorkspaceState } from "./shared/persona-types";
import { getPersonaCapabilities } from "./persona-definitions";

// Re-import constants (can't import `const` as type)
const SCRATCH_ID = "__scratch__";
const MAX_RECENT = 20;

const APP_CONFIG_DEFAULTS: AppConfig = {
  defaultPersona: "everyday",
  recentWorkspaces: [],
  globalSettings: {
    theme: "system",
    sidebarCollapsed: false,
    telemetryEnabled: true,
  },
};

const WORKSPACE_SETTINGS_DEFAULTS: WorkspaceSettings = {
  gitEnabled: null,
  autoCompact: true,
};

// ---- Helpers ----

async function getDataDir(): Promise<string> {
  return ensureDataDir();
}

async function getWorkspacesDir(): Promise<string> {
  const dataDir = await getDataDir();
  const dir = path.join(dataDir, "workspaces");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function workspaceId(folderPath: string): string {
  return crypto.createHash("sha256").update(folderPath).digest("hex").slice(0, 16);
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(filePath: string, data: T): Promise<void> {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, filePath);
}

// ---- App Config ----

let appConfigCache: AppConfig | null = null;

export async function getAppConfig(): Promise<AppConfig> {
  if (appConfigCache) return appConfigCache;
  const dataDir = await getDataDir();
  const filePath = path.join(dataDir, "app-config.json");
  appConfigCache = await readJson(filePath, APP_CONFIG_DEFAULTS);
  return appConfigCache;
}

export async function updateAppConfig(
  mutator: (config: AppConfig) => AppConfig
): Promise<AppConfig> {
  const current = await getAppConfig();
  const next = mutator(structuredClone(current));
  appConfigCache = next;
  const dataDir = await getDataDir();
  await writeJson(path.join(dataDir, "app-config.json"), next);
  return next;
}

export async function setDefaultPersona(persona: PersonaId): Promise<AppConfig> {
  return updateAppConfig((config) => ({
    ...config,
    defaultPersona: persona,
  }));
}

// ---- Workspace Config ----

const workspaceCache = new Map<string, WorkspaceConfig>();

export async function getWorkspaceConfig(
  folderPath: string
): Promise<WorkspaceConfig> {
  const id = workspaceId(folderPath);
  if (workspaceCache.has(id)) return workspaceCache.get(id)!;

  const dir = await getWorkspacesDir();
  const filePath = path.join(dir, `${id}.json`);
  const fallback: WorkspaceConfig = {
    id,
    folderPath,
    name: path.basename(folderPath),
    persona: null,
    createdAt: Date.now(),
    lastOpenedAt: Date.now(),
    pinnedSessions: [],
    settings: { ...WORKSPACE_SETTINGS_DEFAULTS },
  };

  const config = await readJson(filePath, fallback);
  // Ensure ID and path are correct (in case of manual edits)
  config.id = id;
  config.folderPath = folderPath;
  workspaceCache.set(id, config);
  return config;
}

export async function updateWorkspaceConfig(
  folderPath: string,
  mutator: (config: WorkspaceConfig) => WorkspaceConfig
): Promise<WorkspaceConfig> {
  const current = await getWorkspaceConfig(folderPath);
  const next = mutator(structuredClone(current));
  workspaceCache.set(next.id, next);

  const dir = await getWorkspacesDir();
  await writeJson(path.join(dir, `${next.id}.json`), next);
  return next;
}

export async function setWorkspacePersona(
  folderPath: string,
  persona: PersonaId | null
): Promise<WorkspaceConfig> {
  return updateWorkspaceConfig(folderPath, (config) => ({
    ...config,
    persona,
  }));
}

/** Mark a workspace as recently opened and update its timestamp */
export async function touchWorkspace(folderPath: string): Promise<void> {
  const id = workspaceId(folderPath);

  // Update workspace lastOpenedAt
  await updateWorkspaceConfig(folderPath, (config) => ({
    ...config,
    lastOpenedAt: Date.now(),
  }));

  // Update recent workspaces list in app config
  await updateAppConfig((config) => {
    const recents = [id, ...config.recentWorkspaces.filter((w) => w !== id)].slice(
      0,
      MAX_RECENT
    );
    return { ...config, recentWorkspaces: recents };
  });
}

/** Get list of recent workspace configs */
export async function getRecentWorkspaces(): Promise<WorkspaceConfig[]> {
  const appConfig = await getAppConfig();
  const dir = await getWorkspacesDir();
  const results: WorkspaceConfig[] = [];

  for (const id of appConfig.recentWorkspaces) {
    const filePath = path.join(dir, `${id}.json`);
    try {
      const config = await readJson<WorkspaceConfig>(filePath, null as any);
      if (config && config.folderPath) {
        // Verify the folder still exists
        try {
          await fs.access(config.folderPath);
          results.push(config);
        } catch {
          // Folder no longer exists, skip
        }
      }
    } catch {
      // Config file missing, skip
    }
  }

  return results;
}

// ---- Scratch Workspace ----

export function getScratchWorkspaceConfig(): WorkspaceConfig {
  return {
    id: SCRATCH_ID,
    folderPath: "",
    name: "Quick Chat",
    persona: null,
    createdAt: 0,
    lastOpenedAt: Date.now(),
    pinnedSessions: [],
    settings: { ...WORKSPACE_SETTINGS_DEFAULTS },
  };
}

// ---- Workspace State (for renderer) ----

async function detectGitRepo(folderPath: string): Promise<boolean> {
  if (!folderPath) return false;
  try {
    await fs.access(path.join(folderPath, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Build the full workspace state to send to the renderer */
export async function getWorkspaceState(
  folderPath: string
): Promise<WorkspaceState> {
  const isScratch = !folderPath;
  const config = isScratch
    ? getScratchWorkspaceConfig()
    : await getWorkspaceConfig(folderPath);
  const appConfig = await getAppConfig();

  const resolvedPersona = config.persona ?? appConfig.defaultPersona;
  const isGitRepo = await detectGitRepo(folderPath);

  const capabilities = getPersonaCapabilities(resolvedPersona, {
    gitEnabled: config.settings.gitEnabled,
  });

  // If persona allows git but folder isn't a git repo, disable git in capabilities
  if (capabilities.features.git && !isGitRepo) {
    capabilities.features.git = false;
  }

  return {
    id: config.id,
    folderPath: config.folderPath,
    name: config.name,
    isGitRepo,
    isScratch,
    capabilities,
  };
}
