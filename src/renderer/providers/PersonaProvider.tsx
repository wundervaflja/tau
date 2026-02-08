import React, { useMemo, type ReactNode } from "react";
import { PersonaContext, type PersonaContextValue } from "../contexts/PersonaContext";
import { useWorkspace } from "../contexts/WorkspaceContext";
import type { PersonaCapabilities } from "../../shared/persona-types";
import type { PersonaId } from "../../shared/workspace-types";

interface Props {
  children: ReactNode;
}

/**
 * Derives persona from WorkspaceContext.
 * Must be rendered inside WorkspaceProvider.
 */
export function PersonaProvider({ children }: Props) {
  const { state, appConfig } = useWorkspace();

  const value = useMemo<PersonaContextValue>(() => {
    const capabilities = state?.capabilities ?? null;
    const personaId: PersonaId = capabilities?.persona ?? appConfig?.defaultPersona ?? "everyday";

    return {
      personaId,
      capabilities,
      hasFeature: (feature: keyof PersonaCapabilities["features"]) => {
        return capabilities?.features[feature] ?? false;
      },
    };
  }, [state, appConfig]);

  return (
    <PersonaContext.Provider value={value}>
      {children}
    </PersonaContext.Provider>
  );
}
