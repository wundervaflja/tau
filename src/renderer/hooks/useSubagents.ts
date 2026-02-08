import { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type {
  SubagentSpawnConfig,
  SubagentInfo,
  BusMessage,
  HistoryMessage,
} from "../../shared/types";
import type { Message, ToolCall } from "./useAgent";

let msgIdCounter = 0;
function nextId() {
  return `sub-msg-${++msgIdCounter}-${Date.now()}`;
}

export interface SubagentState {
  info: SubagentInfo;
  messages: Message[];
  isLoading: boolean;
  hasNewActivity: boolean; // true if new messages while tab not focused
  finished: boolean;       // true after agent_end — task is done
}

function historyToMessages(history: HistoryMessage[]): Message[] {
  return history.map((h) => ({
    id: nextId(),
    role: h.role as "user" | "assistant",
    content: h.content,
    thinking: h.thinking,
    tools: h.tools?.map((t) => ({
      id: t.id,
      name: t.name,
      input: t.input,
      output: t.output,
      isError: t.isError,
      isComplete: true,
    })),
    timestamp: h.timestamp,
    isStreaming: false,
  }));
}

export function useSubagents() {
  const [subagents, setSubagents] = useState<Map<string, SubagentState>>(
    new Map()
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busMessages, setBusMessages] = useState<BusMessage[]>([]);

  // Track current assistant message per subagent
  const currentAssistantRefs = useRef<Map<string, string>>(new Map());
  const currentToolsRefs = useRef<Map<string, Map<string, ToolCall>>>(
    new Map()
  );
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;

  // Subscribe to subagent events
  useEffect(() => {
    const unsub = bridge.onSubagentEvent((evt: any) => {
      // Bus message
      if (evt.subagentId === "__bus__" && evt.event?.type === "bus_message") {
        setBusMessages((prev) => [...prev, evt.event.data]);
        return;
      }

      const sid = evt.subagentId as string;
      const event = evt.event;

      switch (event.type) {
        case "status": {
          // Subagent info update (spawned or status change)
          const info = event.data as SubagentInfo;
          setSubagents((prev) => {
            const next = new Map(prev);
            const existing = next.get(sid);
            if (existing) {
              next.set(sid, { ...existing, info });
            } else {
              // New subagent — load history
              next.set(sid, {
                info,
                messages: [],
                isLoading: false,
                hasNewActivity: false,
                finished: false,
              });
              // Load initial history async
              bridge.subagentHistory(sid).then((history: HistoryMessage[]) => {
                setSubagents((p) => {
                  const n = new Map(p);
                  const s = n.get(sid);
                  if (s && s.messages.length === 0) {
                    n.set(sid, { ...s, messages: historyToMessages(history) });
                  }
                  return n;
                });
              });
            }
            return next;
          });
          break;
        }

        case "agent_start":
          setSubagents((prev) => {
            const next = new Map(prev);
            const s = next.get(sid);
            if (s) next.set(sid, { ...s, isLoading: true, finished: false });
            return next;
          });
          break;

        case "message_start": {
          const msgId = nextId();
          currentAssistantRefs.current.set(sid, msgId);
          currentToolsRefs.current.set(sid, new Map());

          setSubagents((prev) => {
            const next = new Map(prev);
            const s = next.get(sid);
            if (s) {
              const newMsg: Message = {
                id: msgId,
                role: "assistant",
                content: "",
                thinking: "",
                tools: [],
                timestamp: Date.now(),
                isStreaming: true,
              };
              next.set(sid, {
                ...s,
                messages: [...s.messages, newMsg],
                hasNewActivity:
                  activeIdRef.current !== sid ? true : s.hasNewActivity,
              });
            }
            return next;
          });
          break;
        }

        case "text_delta": {
          const msgId = currentAssistantRefs.current.get(sid);
          if (!msgId) break;
          setSubagents((prev) => {
            const next = new Map(prev);
            const s = next.get(sid);
            if (s) {
              next.set(sid, {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === msgId
                    ? { ...m, content: m.content + event.data.delta }
                    : m
                ),
              });
            }
            return next;
          });
          break;
        }

        case "thinking_delta": {
          const msgId = currentAssistantRefs.current.get(sid);
          if (!msgId) break;
          setSubagents((prev) => {
            const next = new Map(prev);
            const s = next.get(sid);
            if (s) {
              next.set(sid, {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === msgId
                    ? { ...m, thinking: (m.thinking || "") + event.data.delta }
                    : m
                ),
              });
            }
            return next;
          });
          break;
        }

        case "tool_start": {
          const msgId = currentAssistantRefs.current.get(sid);
          if (!msgId) break;
          const toolsMap = currentToolsRefs.current.get(sid);
          if (!toolsMap) break;

          const tool: ToolCall = {
            id: event.data.toolCallId,
            name: event.data.toolName,
            input: event.data.input,
            output: "",
            isComplete: false,
          };
          toolsMap.set(tool.id, tool);

          setSubagents((prev) => {
            const next = new Map(prev);
            const s = next.get(sid);
            if (s) {
              next.set(sid, {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === msgId
                    ? { ...m, tools: Array.from(toolsMap.values()) }
                    : m
                ),
              });
            }
            return next;
          });
          break;
        }

        case "tool_update": {
          const msgId = currentAssistantRefs.current.get(sid);
          if (!msgId) break;
          const toolsMap = currentToolsRefs.current.get(sid);
          const existing = toolsMap?.get(event.data.toolCallId);
          if (existing) {
            existing.output =
              (existing.output || "") + (event.data.output || "");
            setSubagents((prev) => {
              const next = new Map(prev);
              const s = next.get(sid);
              if (s) {
                next.set(sid, {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === msgId
                      ? { ...m, tools: Array.from(toolsMap!.values()) }
                      : m
                  ),
                });
              }
              return next;
            });
          }
          break;
        }

        case "tool_end": {
          const msgId = currentAssistantRefs.current.get(sid);
          if (!msgId) break;
          const toolsMap = currentToolsRefs.current.get(sid);
          const existing = toolsMap?.get(event.data.toolCallId);
          if (existing) {
            existing.isComplete = true;
            existing.isError = event.data.isError;
            setSubagents((prev) => {
              const next = new Map(prev);
              const s = next.get(sid);
              if (s) {
                next.set(sid, {
                  ...s,
                  messages: s.messages.map((m) =>
                    m.id === msgId
                      ? { ...m, tools: Array.from(toolsMap!.values()) }
                      : m
                  ),
                });
              }
              return next;
            });
          }
          break;
        }

        case "message_end": {
          const msgId = currentAssistantRefs.current.get(sid);
          if (!msgId) break;
          currentAssistantRefs.current.delete(sid);
          setSubagents((prev) => {
            const next = new Map(prev);
            const s = next.get(sid);
            if (s) {
              next.set(sid, {
                ...s,
                messages: s.messages.map((m) =>
                  m.id === msgId ? { ...m, isStreaming: false } : m
                ),
              });
            }
            return next;
          });
          break;
        }

        case "agent_end":
          setSubagents((prev) => {
            const next = new Map(prev);
            const s = next.get(sid);
            if (s) {
              next.set(sid, { ...s, isLoading: false, finished: true });
            }
            return next;
          });
          break;
      }
    });

    return unsub;
  }, []);

  // Clear new activity flag when switching to a tab
  useEffect(() => {
    if (!activeId) return;
    setSubagents((prev) => {
      const next = new Map(prev);
      const s = next.get(activeId);
      if (s?.hasNewActivity) {
        next.set(activeId, { ...s, hasNewActivity: false });
      }
      return next;
    });
  }, [activeId]);

  const spawn = useCallback(async (configs: SubagentSpawnConfig[]) => {
    await bridge.spawnSubagents(configs);
  }, []);

  // No user input to subagents — they are autonomous read-only workers

  const abort = useCallback(async (id: string) => {
    await bridge.subagentAbort(id);
  }, []);

  const close = useCallback(
    async (id: string) => {
      await bridge.closeSubagent(id);
      setSubagents((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
      if (activeId === id) setActiveId(null);
    },
    [activeId]
  );

  const sendAgentMessage = useCallback(
    async (fromId: string, toId: string, text: string) => {
      await bridge.sendAgentMessage(fromId, toId, text);
    },
    []
  );

  return {
    subagents,
    activeId,
    setActiveId,
    busMessages,
    spawn,
    abort,
    close,
    sendAgentMessage,
  };
}
