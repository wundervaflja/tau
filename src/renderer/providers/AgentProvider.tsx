import React, { useMemo, type ReactNode } from "react";
import { AgentContext, type AgentContextValue } from "../contexts/AgentContext";
import { useAgent } from "../hooks/useAgent";

interface Props {
  children: ReactNode;
}

/**
 * Wraps the existing useAgent hook in a context provider.
 * This is Tier 1 - always mounted regardless of persona.
 */
export function AgentProvider({ children }: Props) {
  const agent = useAgent();

  const value = useMemo<AgentContextValue>(
    () => ({
      messages: agent.messages,
      status: agent.status,
      isLoading: agent.isLoading,
      isCompacting: agent.isCompacting,
      sessionVersion: agent.sessionVersion,
      sendMessage: agent.sendMessage,
      abort: agent.abort,
      newSession: agent.newSession,
      recompact: agent.recompact,
    }),
    [
      agent.messages,
      agent.status,
      agent.isLoading,
      agent.isCompacting,
      agent.sessionVersion,
      agent.sendMessage,
      agent.abort,
      agent.newSession,
      agent.recompact,
    ]
  );

  return (
    <AgentContext.Provider value={value}>
      {children}
    </AgentContext.Provider>
  );
}
