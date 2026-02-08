// Persona capability types shared between main and renderer

import type { PersonaId } from "./workspace-types";

export type SidebarSection = "sessions" | "agents" | "routines";
export type ComposerMode = "simple" | "advanced";

export interface PersonaCapabilities {
  persona: PersonaId;

  features: {
    git: boolean;
    subagents: boolean;
    dataWorkspace: boolean;
    skills: boolean;
    memory: boolean;
  };

  layout: {
    showModelSelector: boolean;
    showThinkingLevel: boolean;
    showRightPanel: boolean;
    defaultSidebarCollapsed: boolean;
    sidebarSections: SidebarSection[];
    composerMode: ComposerMode;
  };

  /** Prepended to agent system prompt to shape AI behavior for this persona */
  systemPromptPrefix: string | null;
}

/** Workspace state sent to renderer - combines config + runtime detection */
export interface WorkspaceState {
  id: string;
  folderPath: string;
  name: string;
  isGitRepo: boolean;
  isScratch: boolean;
  capabilities: PersonaCapabilities;
}
