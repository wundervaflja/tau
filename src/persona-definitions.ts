// Persona capability definitions - single persona with all features enabled

import type { PersonaId } from "./shared/workspace-types";
import type { PersonaCapabilities } from "./shared/persona-types";

export const PERSONA_DEFINITIONS: Record<PersonaId, PersonaCapabilities> = {
  everyday: {
    persona: "everyday",
    features: {
      git: true,
      subagents: true,
      dataWorkspace: false,
      skills: true,
      memory: true,
    },
    layout: {
      showModelSelector: true,
      showThinkingLevel: true,
      showRightPanel: true,
      defaultSidebarCollapsed: false,
      sidebarSections: ["sessions", "agents"],
      composerMode: "advanced",
    },
    systemPromptPrefix: null,
  },
};

/** Get capabilities for a persona, with optional runtime overrides */
export function getPersonaCapabilities(
  personaId: PersonaId,
  overrides?: { gitEnabled?: boolean | null }
): PersonaCapabilities {
  const base = PERSONA_DEFINITIONS[personaId];
  if (!overrides) return base;

  const caps = structuredClone(base);
  if (overrides.gitEnabled === true) {
    caps.features.git = true;
  } else if (overrides.gitEnabled === false) {
    caps.features.git = false;
  }

  return caps;
}

/** Get persona display label for UI */
export function getPersonaLabel(id: PersonaId): string {
  return "Everyday";
}

/** Get persona description for onboarding */
export function getPersonaDescription(id: PersonaId): string {
  return "Full access to all features";
}
