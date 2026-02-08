import React, { useRef, useEffect } from "react";
import type { BusMessage } from "../../shared/types";

interface AgentBusPanelProps {
  messages: BusMessage[];
  isOpen: boolean;
  onToggle: () => void;
}

export function AgentBusPanel({
  messages,
  isOpen,
  onToggle,
}: AgentBusPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isOpen]);

  if (messages.length === 0 && !isOpen) return null;

  return (
    <div
      style={{
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-bg-elevated)",
      }}
    >
      {/* Toggle header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-2 px-4 py-1.5 text-xs transition-colors"
        style={{ color: "var(--color-text-tertiary)" }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--color-bg-hover)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 16 16"
          fill="none"
          style={{
            transform: isOpen ? "rotate(90deg)" : "",
            transition: "transform 0.15s",
          }}
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Agent messages ({messages.length})
      </button>

      {/* Message list */}
      {isOpen && (
        <div
          ref={scrollRef}
          className="overflow-y-auto px-4 pb-2"
          style={{ maxHeight: 150 }}
        >
          {messages.map((msg, i) => (
            <div
              key={i}
              className="text-xs py-1 flex items-baseline gap-1.5"
              style={{ color: "var(--color-text-secondary)" }}
            >
              <span
                className="font-medium shrink-0"
                style={{ color: "var(--color-text-accent)" }}
              >
                @{msg.from}
              </span>
              <span style={{ color: "var(--color-text-tertiary)" }}>→</span>
              <span
                className="font-medium shrink-0"
                style={{ color: "var(--color-text-accent)" }}
              >
                {msg.to === "all" ? "@all" : `@${msg.to}`}
              </span>
              <span className="truncate">{msg.content}</span>
              <span
                className="shrink-0 tabular-nums ml-auto"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                {new Date(msg.timestamp).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
