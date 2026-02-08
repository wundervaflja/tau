import React, { type ReactNode } from "react";
import { WorkspaceProvider } from "./WorkspaceProvider";
import { PersonaProvider } from "./PersonaProvider";
import { AgentProvider } from "./AgentProvider";
import { FeatureProviders } from "./FeatureProviders";

interface Props {
  children: ReactNode;
}

/**
 * Root provider tree for the application.
 *
 * Nesting order matters:
 * 1. WorkspaceProvider - loads workspace state + app config
 * 2. PersonaProvider - derives persona from workspace (needs WorkspaceContext)
 * 3. AgentProvider - wraps useAgent hook (independent, Tier 1)
 * 4. FeatureProviders - conditionally mounts feature hooks (needs PersonaContext + AgentContext)
 */
export function AppProviders({ children }: Props) {
  return (
    <WorkspaceProvider>
      <PersonaProvider>
        <AgentProvider>
          <FeatureProviders>
            {children}
          </FeatureProviders>
        </AgentProvider>
      </PersonaProvider>
    </WorkspaceProvider>
  );
}
