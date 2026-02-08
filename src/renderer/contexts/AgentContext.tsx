import { createContext, useContext } from "react";
import type { Message } from "../hooks/useAgent";
import type { StatusInfo } from "../../shared/types";

export interface AgentContextValue {
  messages: Message[];
  status: StatusInfo;
  isLoading: boolean;
  isCompacting: boolean;
  sessionVersion: number;
  sendMessage: (text: string) => void;
  abort: () => void;
  newSession: () => void;
  recompact: (instructions: string) => void;
}

const defaultStatus: StatusInfo = {
  isStreaming: false,
  cwd: "",
};

const defaultValue: AgentContextValue = {
  messages: [],
  status: defaultStatus,
  isLoading: false,
  isCompacting: false,
  sessionVersion: 0,
  sendMessage: () => {},
  abort: () => {},
  newSession: () => {},
  recompact: () => {},
};

export const AgentContext = createContext<AgentContextValue>(defaultValue);

export function useAgentContext(): AgentContextValue {
  return useContext(AgentContext);
}
