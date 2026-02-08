// Workspace and app configuration types shared between main and renderer

export type PersonaId = "everyday";

export interface WorkspaceConfig {
  id: string;
  folderPath: string;
  name: string;
  persona: PersonaId | null;     // null = inherit from AppConfig.defaultPersona
  pinnedSessions: string[];
  settings: WorkspaceSettings;
}

export interface WorkspaceSettings {
  gitEnabled: boolean | null;    // null = defer to persona default
  autoCompact: boolean;
  systemPromptOverride?: string;
}

export interface AppConfig {
  defaultPersona: PersonaId;
  recentWorkspaces: string[];
  globalSettings: {
    theme: "system" | "light" | "dark";
    sidebarCollapsed: boolean;
    telemetryEnabled: boolean;
  };
}

export const SCRATCH_WORKSPACE_ID = "__scratch__";

export const DEFAULT_APP_CONFIG: AppConfig = {
  defaultPersona: "everyday",
  recentWorkspaces: [],
  globalSettings: {
    theme: "system",
    sidebarCollapsed: false,
    telemetryEnabled: false,
  },
};

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  gitEnabled: null,
  autoCompact: true,
};
