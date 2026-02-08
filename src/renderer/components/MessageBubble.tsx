import React, { useState, useRef, useEffect, useCallback } from "react";
import { ToolCallView } from "./ToolCallView";
import { MarkdownContent } from "./MarkdownContent";
import { bridge } from "../bridge";
import type { Message } from "../hooks/useAgent";

interface MessageBubbleProps {
  message: Message;
  onRecompact?: (instructions: string) => void;
}

export function MessageBubble({ message, onRecompact }: MessageBubbleProps) {
  const [showThinking, setShowThinking] = useState(true);
  const isUser = message.role === "user";
  const isCompaction = message.role === "compaction";
  const thinkingRef = useRef<HTMLDivElement>(null);

  // Auto-scroll thinking block to bottom while streaming
  useEffect(() => {
    if (message.isStreaming && showThinking && thinkingRef.current) {
      const el = thinkingRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [message.thinking, message.isStreaming, showThinking]);

  if (isCompaction) {
    return (
      <CompactionBubble
        summary={message.compaction?.summary || ""}
        tokensBefore={message.compaction?.tokensBefore}
        onRecompact={onRecompact}
      />
    );
  }

  // Inline memory confirmation cards
  if (message.memoryNotification) {
    return (
      <div className={`mb-4 animate-fade-in ${isUser ? "flex justify-end" : ""}`}>
        <MemoryNotificationCard memory={message.memoryNotification} />
      </div>
    );
  }

  return (
    <div
      className={`mb-4 animate-fade-in ${isUser ? "flex justify-end" : ""}`}
    >
      {isUser ? (
        /* User message - right-aligned bubble */
        <div
          className="max-w-[85%] px-4 py-2.5 rounded-2xl text-sm select-text user-message-bubble"
          style={{
            background: "var(--color-bg-accent)",
            color: "var(--color-text-on-accent)",
            borderBottomRightRadius: "6px",
          }}
        >
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        </div>
      ) : (
        /* Assistant message */
        <div className="max-w-full">
          {/* Thinking section */}
          {message.thinking && (
            <div className="mb-3">
              {/* Thinking header — toggle */}
              <button
                onClick={() => setShowThinking(!showThinking)}
                className="flex items-center gap-1.5 mb-1.5 text-xs px-2 py-1 rounded-md transition-colors"
                style={{
                  color: "var(--color-text-tertiary)",
                  background: showThinking ? "var(--color-bg-hover)" : "transparent",
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--color-bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = showThinking
                    ? "var(--color-bg-hover)"
                    : "transparent")
                }
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  style={{
                    transform: showThinking ? "rotate(90deg)" : "",
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
                Thinking
                {message.isStreaming && !message.content && (
                  <span className="thinking-dots ml-1">
                    <span>●</span>
                    <span>●</span>
                    <span>●</span>
                  </span>
                )}
              </button>

              {/* Thinking content — expanded by default, streams in */}
              {showThinking && (
                <div
                  ref={thinkingRef}
                  className="px-3 py-2 rounded-lg text-xs font-mono select-text overflow-x-auto overflow-y-auto"
                  style={{
                    background: "var(--color-bg-tool)",
                    color: "var(--color-text-secondary)",
                    borderLeft: "2px solid var(--color-border-heavy)",
                    maxHeight: message.isStreaming ? "none" : "400px",
                  }}
                >
                  <pre className="whitespace-pre-wrap">{message.thinking}</pre>
                  {message.isStreaming && !message.content && (
                    <span
                      className="inline-block w-0.5 h-3 ml-0.5 animate-pulse"
                      style={{ background: "var(--color-text-tertiary)" }}
                    />
                  )}
                </div>
              )}
            </div>
          )}

          {/* Tool calls */}
          {message.tools && message.tools.length > 0 && (
            <div className="mb-3 space-y-2">
              {message.tools.map((tool) => (
                <ToolCallView key={tool.id} tool={tool} />
              ))}
            </div>
          )}

          {/* Text content */}
          {message.content && (
            <div className="text-sm select-text leading-relaxed">
              <MarkdownContent content={message.content} />
            </div>
          )}

          {/* Streaming cursor */}
          {message.isStreaming && message.content && (
            <span
              className="inline-block w-0.5 h-4 ml-0.5 animate-pulse"
              style={{ background: "var(--color-text-accent)" }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// --- Memory notification card (compact) ---
function MemoryNotificationCard({
  memory,
}: {
  memory: { type: string; content: string; id: string };
}) {
  const [muted, setMuted] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [loading, setLoading] = useState(false);

  if (deleted) return null;

  const handleDelete = async () => {
    setLoading(true);
    try {
      await bridge.memoryDelete(memory.id);
      setDeleted(true);
    } catch (err) {
      console.error("Failed to delete memory", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="rounded-md p-3 select-text"
      style={{
        background: "var(--color-bg-elevated)",
        color: "var(--color-text-primary)",
        borderLeft: `4px solid var(--color-accent)`,
        maxWidth: "85%",
      }}
    >
      <div className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>
        Memory saved
      </div>

      <div className="mt-2 flex items-start gap-3">
        <span
          className="text-xs font-medium px-2 py-0.5 rounded"
          style={{
            background: "var(--color-bg-surface)",
            color: "var(--color-text-secondary)",
            border: "1px solid var(--color-border)",
            alignSelf: "flex-start",
          }}
        >
          {memory.type}
        </span>

        <div className="whitespace-pre-wrap break-words text-sm" style={{ color: "var(--color-text-secondary)" }}>
          {memory.content}
        </div>
      </div>

      <div className="mt-3 flex items-center">
        <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
          Stored locally.
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setMuted(true)}
          className="text-xs px-3 py-1 rounded transition-colors mr-2"
          style={{ color: "var(--color-text-accent)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          OK
        </button>

        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-xs px-3 py-1 rounded transition-colors"
          style={{ color: "var(--color-text-error)", border: "1px solid var(--color-border)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          {loading ? "Deleting..." : "Delete"}
        </button>
      </div>
    </div>
  );
}

// --- Compaction summary bubble ---
function CompactionBubble({
  summary,
  tokensBefore,
  onRecompact,
}: {
  summary: string;
  tokensBefore?: number;
  onRecompact?: (instructions: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(summary);
  const [expanded, setExpanded] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditValue(summary);
  }, [summary]);

  useEffect(() => {
    if (isEditing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.focus();
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
    }
  }, [isEditing]);

  const handleSave = useCallback(() => {
    if (onRecompact && editValue.trim() !== summary.trim()) {
      onRecompact(editValue.trim());
    }
    setIsEditing(false);
  }, [editValue, summary, onRecompact]);

  const handleCancel = useCallback(() => {
    setEditValue(summary);
    setIsEditing(false);
  }, [summary]);

  return (
    <div className="mb-4 animate-fade-in">
      <div
        className="rounded-lg overflow-hidden"
        style={{
          border: "1px solid var(--color-border)",
          background: "var(--color-bg-tool)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{
            borderBottom: expanded ? "1px solid var(--color-border)" : "none",
            background: "var(--color-bg-elevated)",
          }}
        >
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs font-medium transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              style={{
                transform: expanded ? "rotate(90deg)" : "",
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
            Compaction summary
          </button>

          {tokensBefore != null && (
            <span
              className="text-xs"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {tokensBefore.toLocaleString()} tokens compacted
            </span>
          )}

          <div className="flex-1" />

          {/* Edit / Recompact button */}
          {!isEditing && onRecompact && (
            <button
              onClick={() => setIsEditing(true)}
              className="text-xs px-2 py-0.5 rounded transition-colors"
              style={{ color: "var(--color-text-accent)" }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--color-bg-hover)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              title="Edit summary and recompact"
            >
              Edit
            </button>
          )}
        </div>

        {/* Content */}
        {expanded && (
          <div className="px-3 py-2">
            {isEditing ? (
              <div>
                <textarea
                  ref={textareaRef}
                  value={editValue}
                  onChange={(e) => {
                    setEditValue(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = e.target.scrollHeight + "px";
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") handleCancel();
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSave();
                  }}
                  className="w-full text-xs font-mono resize-none outline-none rounded p-2"
                  style={{
                    background: "var(--color-bg-surface)",
                    color: "var(--color-text-primary)",
                    border: "1px solid var(--color-border-focus)",
                    fontFamily: "var(--font-mono)",
                    minHeight: 100,
                  }}
                />
                <div className="flex items-center gap-2 mt-2">
                  <button
                    onClick={handleSave}
                    className="text-xs px-3 py-1 rounded transition-colors font-medium"
                    style={{
                      background: "var(--color-bg-accent)",
                      color: "var(--color-text-on-accent)",
                    }}
                  >
                    Recompact
                  </button>
                  <button
                    onClick={handleCancel}
                    className="text-xs px-3 py-1 rounded transition-colors"
                    style={{ color: "var(--color-text-tertiary)" }}
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--color-bg-hover)")
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    Cancel
                  </button>
                  <span
                    className="text-xs ml-auto"
                    style={{ color: "var(--color-text-tertiary)" }}
                  >
                    Cmd+Enter to save
                  </span>
                </div>
              </div>
            ) : (
              <pre
                className="text-xs font-mono select-text whitespace-pre-wrap overflow-y-auto"
                style={{
                  color: "var(--color-text-secondary)",
                  fontFamily: "var(--font-mono)",
                  maxHeight: 400,
                }}
              >
                {summary}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
