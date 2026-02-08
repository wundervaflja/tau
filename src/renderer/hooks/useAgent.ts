import { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { AgentEvent, StatusInfo, HistoryMessage } from "../../shared/types";
import { pushCanvasSpec } from "./useCanvas";

export interface Message {
  id: string;
  role: "user" | "assistant" | "compaction";
  content: string;
  thinking?: string;
  tools?: ToolCall[];
  timestamp: number;
  isStreaming?: boolean;
  compaction?: {
    summary: string;
    tokensBefore?: number;
  };
  memoryNotification?: {
    type: string;
    content: string;
    id: string;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input?: any;
  output?: string;
  isError?: boolean;
  isComplete: boolean;
}

let messageIdCounter = 0;
function nextId() {
  return `msg-${++messageIdCounter}-${Date.now()}`;
}

/** Strip [CONTEXT]...[/CONTEXT] prefix that AgentManager prepends to user prompts */
function stripMemoryContext(text: string): string {
  return text.replace(/^\[CONTEXT\][\s\S]*?\[\/CONTEXT\]\s*/m, "");
}

function historyToMessages(history: HistoryMessage[]): Message[] {
  return history.map((h) => ({
    id: nextId(),
    role: h.role,
    content: h.role === "user" ? stripMemoryContext(h.content) : h.content,
    thinking: h.thinking,
    tools: h.tools?.map((t) => ({
      id: t.id,
      name: t.name,
      input: t.input,
      output: t.output,
      isError: t.isError,
      isComplete: true,
    })),
    compaction: h.compaction,
    timestamp: h.timestamp,
    isStreaming: false,
  }));
}

export function useAgent() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<StatusInfo>({
    isStreaming: false,
    cwd: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);
  const [sessionVersion, setSessionVersion] = useState(0);
  const currentAssistantRef = useRef<string | null>(null);
  const currentToolsRef = useRef<Map<string, ToolCall>>(new Map());
  const currentAssistantContentRef = useRef<string>("");
  const runStartRef = useRef<number | null>(null);
  const prevCwdRef = useRef<string>("");

  // Load session history
  const loadHistory = useCallback(async () => {
    try {
      const history = await bridge.getSessionHistory();
      setMessages(historyToMessages(history));
    } catch {
      // ignore
    }
  }, []);

  // Add a compaction message to the chat
  const addCompactionMessage = useCallback((summary: string, tokensBefore?: number) => {
    setMessages((prev) => [
      ...prev,
      {
        id: nextId(),
        role: "compaction",
        content: "",
        timestamp: Date.now(),
        compaction: { summary, tokensBefore },
      },
    ]);
  }, []);

  useEffect(() => {
    // Get initial status and load existing session history
    bridge.getStatus().then((s) => {
      setStatus(s);
      prevCwdRef.current = s.cwd || "";
    });
    loadHistory();

    // Subscribe to agent events
    const unsub = bridge.onAgentEvent((event: AgentEvent) => {
      switch (event.type) {
        case "session_switched" as string:
          loadHistory();
          setSessionVersion((v) => v + 1);
          break;

        // Auto-compaction (background)
        case "compaction_start" as string:
          setIsCompacting(true);
          break;

        case "compaction_end" as string: {
          setIsCompacting(false);
          // Reload history — compaction entries are now included in getSessionHistory()
          loadHistory();
          setSessionVersion((v) => v + 1);
          break;
        }

        // Legacy manual /compact result — also just reload
        case "compaction_result" as string: {
          setIsCompacting(false);
          loadHistory();
          setSessionVersion((v) => v + 1);
          break;
        }

        case "agent_start":
          setIsLoading(true);
          runStartRef.current = Date.now();
          break;

        case "message_start": {
          const id = nextId();
          currentAssistantRef.current = id;
          currentToolsRef.current = new Map();
          currentAssistantContentRef.current = "";
          setMessages((prev) => [
            ...prev,
            {
              id,
              role: "assistant",
              content: "",
              thinking: "",
              tools: [],
              timestamp: Date.now(),
              isStreaming: true,
            },
          ]);
          break;
        }

        case "text_delta": {
          const msgId = currentAssistantRef.current;
          if (!msgId) break;
          currentAssistantContentRef.current += event.data.delta;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId ? { ...m, content: m.content + event.data.delta } : m
            )
          );
          break;
        }

        case "thinking_delta": {
          const msgId = currentAssistantRef.current;
          if (!msgId) break;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, thinking: (m.thinking || "") + event.data.delta }
                : m
            )
          );
          break;
        }

        case "tool_start": {
          const msgId = currentAssistantRef.current;
          if (!msgId) break;
          const tool: ToolCall = {
            id: event.data.toolCallId,
            name: event.data.toolName,
            input: event.data.input,
            output: "",
            isComplete: false,
          };
          currentToolsRef.current.set(tool.id, tool);
          setMessages((prev) =>
            prev.map((m) =>
              m.id === msgId
                ? { ...m, tools: Array.from(currentToolsRef.current.values()) }
                : m
            )
          );
          break;
        }

        case "tool_update": {
          const msgId = currentAssistantRef.current;
          if (!msgId) break;
          const existing = currentToolsRef.current.get(event.data.toolCallId);
          if (existing) {
            existing.output = (existing.output || "") + (event.data.output || "");
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, tools: Array.from(currentToolsRef.current.values()) }
                  : m
              )
            );
          }
          break;
        }

        case "tool_end": {
          const msgId = currentAssistantRef.current;
          if (!msgId) break;
          const existing = currentToolsRef.current.get(event.data.toolCallId);
          if (existing) {
            existing.isComplete = true;
            existing.isError = event.data.isError;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === msgId
                  ? { ...m, tools: Array.from(currentToolsRef.current.values()) }
                  : m
              )
            );
          }
          break;
        }

        case "message_end": {
          const msgId = currentAssistantRef.current;
          if (!msgId) break;
          setMessages((prev) =>
            prev.map((m) => (m.id === msgId ? { ...m, isStreaming: false } : m))
          );
          currentAssistantRef.current = null;

          // NOTE: removed automatic generic summary memory creation here.
          // The agent-manager now handles fact extraction and memory creation on agent_end.

          break;
        }

        case "agent_end":
          setIsLoading(false);
          setSessionVersion((v) => v + 1);
          if (runStartRef.current) {
            const durationMs = Date.now() - runStartRef.current;
            bridge.telemetryAdd({
              id: "",
              kind: "agent_run",
              success: true,
              durationMs,
              timestamp: Date.now(),
            });
            runStartRef.current = null;
          }
          break;

        case "status": {
          const newCwd = event.data.cwd || "";
          if (prevCwdRef.current && newCwd && prevCwdRef.current !== newCwd) {
            // Workspace changed — reset UI for the new session
            setMessages([]);
            loadHistory();
          }
          prevCwdRef.current = newCwd;
          setStatus(event.data);
          setSessionVersion((v) => v + 1);
          break;
        }

        case "memory_created" as string: {
          // Show an inline memory confirmation card in chat
          const m = event.data?.memory;
          if (m) {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: "assistant",
                content: "",
                memoryNotification: {
                  type: m.type,
                  content: m.content,
                  id: m.id,
                },
                isStreaming: false,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }

        case "command_result": {
          const msg = event.data.message as string;
          if (!msg) break;
          if (msg.startsWith("__COPY__")) {
            navigator.clipboard.writeText(msg.slice(8));
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: "assistant",
                content: "Copied to clipboard.",
                timestamp: Date.now(),
              },
            ]);
          } else if (msg === "Started new session.") {
            setMessages([]);
            setSessionVersion((v) => v + 1);
          } else if (msg === "__RESUME__") {
            // TODO: open session selector
          } else if (msg === "__QUIT__") {
            window.close();
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                role: "assistant",
                content: msg,
                timestamp: Date.now(),
              },
            ]);
          }
          break;
        }

        case "canvas_update" as string:
          if (event.data) {
            pushCanvasSpec(event.data);
          }
          break;

        case "error":
          setIsLoading(false);
          if (runStartRef.current) {
            bridge.telemetryAdd({
              id: "",
              kind: "agent_run",
              success: false,
              durationMs: Date.now() - runStartRef.current,
              timestamp: Date.now(),
            });
            runStartRef.current = null;
          }
          break;
      }
    });

    return unsub;
  }, [loadHistory, addCompactionMessage]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim()) return;

    const userMsg: Message = {
      id: nextId(),
      role: "user",
      content: text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);

    const result = await bridge.prompt(text);
    if (result?.error) {
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          content: `Error: ${result.error}`,
          timestamp: Date.now(),
        },
      ]);
      setIsLoading(false);
    }
  }, []);

  const abort = useCallback(() => {
    bridge.abort();
  }, []);

  const newSession = useCallback(async () => {
    await bridge.newSession();
    setMessages([]);
    setSessionVersion((v) => v + 1);
  }, []);

  const recompact = useCallback(async (instructions: string) => {
    // isCompacting is now set by compaction_start/compaction_end events
    // from AgentManager, so it works regardless of who triggers compaction
    await bridge.recompact(instructions);
  }, []);

  return {
    messages,
    setMessages,
    status,
    isLoading,
    isCompacting,
    sessionVersion,
    sendMessage,
    abort,
    newSession,
    recompact,
  };
}
