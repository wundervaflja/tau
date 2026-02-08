import React, { useRef, useEffect, useState, useCallback } from "react";
import { MessageBubble } from "./MessageBubble";
import { WelcomeScreen } from "./WelcomeScreen";
import { CompactionIndicator } from "./CompactionIndicator";
import { SpawnDialog } from "./SpawnDialog";
import { AgentBusPanel } from "./AgentBusPanel";
import { Composer } from "./Composer";
import { useAgentContext } from "../contexts/AgentContext";
import { useSubagentsFeature } from "../providers/FeatureProviders";
import type { SubagentSpawnConfig } from "../../shared/types";

interface ChatViewProps {
  prefillText?: string | null;
  onPrefillConsumed?: () => void;
}

export function ChatView({ prefillText, onPrefillConsumed }: ChatViewProps = {}) {
  const agent = useAgentContext();
  const subagents = useSubagentsFeature();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCountRef = useRef(0);
  const autoScrollRef = useRef(true);
  const [showSpawnDialog, setShowSpawnDialog] = useState(false);
  const [showBusPanel, setShowBusPanel] = useState(false);

  // Subagent routing
  const activeSubagent = subagents?.activeId
    ? subagents.subagents.get(subagents.activeId)
    : null;

  const messages = activeSubagent?.messages ?? agent.messages;
  const isLoading = activeSubagent?.isLoading ?? agent.isLoading;
  const isCompacting = !subagents?.activeId ? agent.isCompacting : false;

  const onSend = useCallback(
    (text: string) => {
      if (subagents?.activeId) {
        subagents.sendMessage(subagents.activeId, text);
      } else {
        agent.sendMessage(text);
      }
    },
    [subagents?.activeId, subagents?.sendMessage, agent.sendMessage]
  );

  const onAbort = useCallback(() => {
    if (subagents?.activeId) {
      subagents.abort(subagents.activeId);
    } else {
      agent.abort();
    }
  }, [subagents?.activeId, subagents?.abort, agent.abort]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    autoScrollRef.current = distanceFromBottom < 80;
  }, []);

  // Scroll: jump instantly on session load, smooth-scroll on new streaming messages
  useEffect(() => {
    const prevCount = prevMsgCountRef.current;
    const curCount = messages.length;
    prevMsgCountRef.current = curCount;

    if (curCount === 0) return;

    // Session switch / history load: message count changed drastically or went from 0
    const isSessionLoad = prevCount === 0 || Math.abs(curCount - prevCount) > 2;

    if (isSessionLoad) {
      // Reset auto-scroll and jump to bottom
      autoScrollRef.current = true;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    } else if (autoScrollRef.current) {
      // Incremental update (streaming / new message) — smooth scroll
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages]);

  const hasSubagents = subagents && subagents.subagents.size > 0;
  const busMessages = subagents?.busMessages ?? [];

  return (
    <div className="flex flex-col h-full relative">
      {/* Tab bar — always shown */}
      {subagents && (
        <div
          className="relative shrink-0"
          style={{
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-bg-surface)",
          }}
        >
          <div className="flex items-center gap-1 px-3 py-1.5 overflow-x-auto">
            {/* Main tab */}
            <TabButton
              label="Main"
              isActive={!subagents?.activeId}
              onClick={() => subagents?.setActiveId(null)}
            />

            {/* Subagent tabs */}
            {subagents &&
              Array.from(subagents.subagents.entries()).map(([id, state]) => (
                <TabButton
                  key={id}
                  label={state.info.name}
                  isActive={subagents.activeId === id}
                  isStreaming={state.info.isStreaming}
                  hasActivity={state.hasNewActivity}
                  onClick={() => subagents.setActiveId(id)}
                  onClose={() => subagents.close(id)}
                />
              ))}

            {/* Spawn button */}
            {subagents && (
              <button
                onClick={() => setShowSpawnDialog(!showSpawnDialog)}
                className="shrink-0 px-2 py-1 rounded-md text-xs transition-colors"
                style={{
                  color: showSpawnDialog ? "var(--color-text-accent)" : "var(--color-text-tertiary)",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                title="Spawn subagents"
              >
                +
              </button>
            )}
          </div>

          {/* Spawn dialog */}
          {showSpawnDialog && subagents && (
            <SpawnDialog
              onSpawn={subagents.spawn}
              onClose={() => setShowSpawnDialog(false)}
            />
          )}
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto"
        style={{ background: "var(--color-bg-surface)" }}
        onScroll={handleScroll}
      >
        {messages.length === 0 ? (
          <WelcomeScreen onSend={onSend} cwd={agent.status.cwd || ""} hasProject={!!agent.status.cwd} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 py-6">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} onRecompact={!subagents?.activeId ? agent.recompact : undefined} />
            ))}
            {isCompacting && <CompactionIndicator />}
            {isLoading &&
              !isCompacting &&
              !messages.some((m) => m.isStreaming) && (
                <div className="flex items-center gap-2 py-4 animate-fade-in">
                  <div className="thinking-dots" style={{ color: "var(--color-text-tertiary)" }}>
                    <span>●</span> <span>●</span> <span>●</span>
                  </div>
                </div>
              )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Bus panel — inter-agent messages */}
      {busMessages.length > 0 && (
        <AgentBusPanel
          messages={busMessages}
          isOpen={showBusPanel}
          onToggle={() => setShowBusPanel(!showBusPanel)}
        />
      )}

      {/* Composer — hidden for subagent tabs (read-only view) */}
      {!subagents?.activeId ? (
        <Composer
          onSend={onSend}
          onAbort={onAbort}
          isLoading={isLoading}
          sessionVersion={agent.sessionVersion}
          prefillText={prefillText}
          onPrefillConsumed={onPrefillConsumed}
        />
      ) : (
        <div
          className="px-4 py-3 text-center text-xs"
          style={{
            borderTop: "1px solid var(--color-border)",
            color: "var(--color-text-tertiary)",
            background: "var(--color-bg-surface)",
          }}
        >
          Subagent — read-only view
        </div>
      )}
    </div>
  );
}

// --- Tab button ---
function TabButton({
  label,
  isActive,
  isStreaming,
  hasActivity,
  onClick,
  onClose,
}: {
  label: string;
  isActive: boolean;
  isStreaming?: boolean;
  hasActivity?: boolean;
  onClick: () => void;
  onClose?: () => void;
}) {
  return (
    <div
      className="group flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
      onClick={onClick}
      style={{
        color: isActive ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
        background: isActive ? "var(--color-bg-hover)" : "transparent",
        borderBottom: isActive ? "2px solid var(--color-text-accent)" : "2px solid transparent",
      }}
      onMouseEnter={(e) => {
        if (!isActive) e.currentTarget.style.background = "var(--color-bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) e.currentTarget.style.background = "";
      }}
    >
      <span className="truncate max-w-[120px]">{label}</span>
      {isStreaming && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0 animate-pulse" style={{ background: "var(--color-text-accent)" }} />
      )}
      {hasActivity && !isActive && !isStreaming && (
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--color-text-warning)" }} />
      )}
      {onClose && (
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: "var(--color-text-tertiary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-error)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-tertiary)")}
          title="Close"
        >
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}
