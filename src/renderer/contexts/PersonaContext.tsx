import { createContext, useContext } from "react";
import type { PersonaCapabilities } from "../../shared/persona-types";
import type { PersonaId } from "../../shared/workspace-types";

export interface PersonaContextValue {
  /** Resolved persona ID (workspace override > global default) */
  personaId: PersonaId;
  /** Full capability manifest for current persona */
  capabilities: PersonaCapabilities | null;
  /** Whether a specific feature is enabled for the current persona */
  hasFeature: (feature: keyof PersonaCapabilities["features"]) => boolean;
}

const defaultValue: PersonaContextValue = {
  personaId: "everyday",
  capabilities: null,
  hasFeature: () => false,
};

export const PersonaContext = createContext<PersonaContextValue>(defaultValue);

export function usePersona(): PersonaContextValue {
  return useContext(PersonaContext);
}
