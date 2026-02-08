import React, { useState, useEffect, useCallback, type ReactNode } from "react";
import { bridge } from "../bridge";
import { WorkspaceContext, type WorkspaceContextValue } from "../contexts/WorkspaceContext";
import type { WorkspaceState } from "../../shared/persona-types";
import type { WorkspaceConfig, AppConfig } from "../../shared/workspace-types";

interface Props {
  children: ReactNode;
}

export function WorkspaceProvider({ children }: Props) {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [ready, setReady] = useState(false);
  const [recentWorkspaces, setRecentWorkspaces] = useState<WorkspaceConfig[]>([]);
  const [appConfig, setAppConfig] = useState<AppConfig | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [ws, config, recents] = await Promise.all([
        bridge.workspaceGetState(),
        bridge.appGetConfig(),
        bridge.workspaceListRecent(),
      ]);
      setState(ws);
      setAppConfig(config);
      setRecentWorkspaces(recents);
    } catch {
      // Bridge may not be ready yet
    }
  }, []);

  // Initial load
  useEffect(() => {
    refresh().then(() => setReady(true));
  }, [refresh]);

  const openWorkspace = useCallback(async (folderPath: string) => {
    const ws = await bridge.workspaceOpen(folderPath);
    setState(ws);
    // Refresh recents list after opening
    const recents = await bridge.workspaceListRecent();
    setRecentWorkspaces(recents);
  }, []);

  const setPersona = useCallback(async (persona: string | null) => {
    if (!state || state.isScratch) return;
    await bridge.workspaceSetPersona(state.folderPath, persona);
    await refresh();
  }, [state, refresh]);

  const setDefaultPersona = useCallback(async (persona: string) => {
    await bridge.appSetDefaultPersona(persona);
    await refresh();
  }, [refresh]);

  const value: WorkspaceContextValue = {
    state,
    ready,
    openWorkspace,
    recentWorkspaces,
    setPersona,
    appConfig,
    setDefaultPersona,
    refresh,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}
