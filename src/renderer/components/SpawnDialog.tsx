import React, { useState, useRef, useEffect } from "react";
import type { SubagentSpawnConfig } from "../../shared/types";

interface SpawnDialogProps {
  onSpawn: (configs: SubagentSpawnConfig[]) => void;
  onClose: () => void;
}

export function SpawnDialog({ onSpawn, onClose }: SpawnDialogProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  function handleSpawn() {
    const lines = text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const configs: SubagentSpawnConfig[] = lines.map((line) => ({
      name: line.slice(0, 40),
      task: line,
    }));

    onSpawn(configs);
    onClose();
  }

  return (
    <div
      className="absolute top-full left-0 right-0 z-40 mt-1 mx-4 rounded-lg overflow-hidden animate-fade-in"
      style={{
        background: "var(--color-bg-elevated)",
        border: "1px solid var(--color-border)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
      }}
    >
      <div className="px-4 pt-3 pb-2">
        <div
          className="text-xs font-medium mb-2"
          style={{ color: "var(--color-text-secondary)" }}
        >
          Spawn subagents — one task per line
        </div>
        <textarea
          ref={textareaRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleSpawn();
            }
            if (e.key === "Escape") onClose();
          }}
          placeholder={"Research authentication patterns\nFix failing test suite\nReview CI/CD configuration"}
          className="w-full text-sm resize-none outline-none rounded-md p-3"
          rows={4}
          style={{
            background: "var(--color-bg-surface)",
            color: "var(--color-text-primary)",
            border: "1px solid var(--color-border)",
            fontFamily: "var(--font-sans)",
          }}
        />
      </div>
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <span
          className="text-xs"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {text.split("\n").filter((l) => l.trim()).length || 0} agent(s) · Cmd+Enter to spawn
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded-md transition-colors"
            style={{ color: "var(--color-text-tertiary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--color-bg-hover)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            Cancel
          </button>
          <button
            onClick={handleSpawn}
            disabled={!text.trim()}
            className="text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
            style={{
              background: text.trim()
                ? "var(--color-bg-accent)"
                : "var(--color-bg-hover)",
              color: text.trim()
                ? "var(--color-text-on-accent)"
                : "var(--color-text-tertiary)",
            }}
          >
            Spawn
          </button>
        </div>
      </div>
    </div>
  );
}
