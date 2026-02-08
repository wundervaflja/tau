import { createContext, useContext } from "react";
import type { WorkspaceState } from "../../shared/persona-types";
import type { WorkspaceConfig, AppConfig } from "../../shared/workspace-types";

export interface WorkspaceContextValue {
  /** Current workspace state (includes resolved capabilities) */
  state: WorkspaceState | null;
  /** Whether initial load is complete */
  ready: boolean;
  /** Open a workspace folder (sets up agent, updates recents) */
  openWorkspace: (folderPath: string) => Promise<void>;
  /** List of recent workspace configs */
  recentWorkspaces: WorkspaceConfig[];
  /** Set persona override for current workspace */
  setPersona: (persona: string | null) => Promise<void>;
  /** Global app config */
  appConfig: AppConfig | null;
  /** Set global default persona */
  setDefaultPersona: (persona: string) => Promise<void>;
  /** Refresh workspace state from main process */
  refresh: () => Promise<void>;
}

const defaultValue: WorkspaceContextValue = {
  state: null,
  ready: false,
  openWorkspace: async () => {},
  recentWorkspaces: [],
  setPersona: async () => {},
  appConfig: null,
  setDefaultPersona: async () => {},
  refresh: async () => {},
};

export const WorkspaceContext = createContext<WorkspaceContextValue>(defaultValue);

export function useWorkspace(): WorkspaceContextValue {
  return useContext(WorkspaceContext);
}
