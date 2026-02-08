import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAgentContext } from "../contexts/AgentContext";
import { bridge } from "../bridge";
import type { ModelInfo } from "../../shared/types";

const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;

interface BottomStatusBarProps {
  onOpenSettings?: () => void;
}

/**
 * Bottom status bar — always visible, shows model selector, thinking level
 * selector, working indicator, and current workspace path.
 *
 * Styled like VS Code / Cursor status bars: thin, muted, information-dense.
 * Clicking model or thinking opens a dropdown picker above the bar.
 */
export function BottomStatusBar({ onOpenSettings }: BottomStatusBarProps) {
  const { status, isLoading } = useAgentContext();

  const [modelOpen, setModelOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);

  const modelRef = useRef<HTMLDivElement>(null);
  const thinkingRef = useRef<HTMLDivElement>(null);

  // Fetch models when model dropdown opens
  useEffect(() => {
    if (!modelOpen) return;
    let cancelled = false;
    bridge.listModels().then((list: ModelInfo[]) => {
      if (!cancelled) setModels(list);
    });
    return () => { cancelled = true; };
  }, [modelOpen]);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!modelOpen && !thinkingOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (
        modelOpen &&
        modelRef.current &&
        !modelRef.current.contains(e.target as Node)
      ) {
        setModelOpen(false);
      }
      if (
        thinkingOpen &&
        thinkingRef.current &&
        !thinkingRef.current.contains(e.target as Node)
      ) {
        setThinkingOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [modelOpen, thinkingOpen]);

  // Close on Escape
  useEffect(() => {
    if (!modelOpen && !thinkingOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setModelOpen(false);
        setThinkingOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modelOpen, thinkingOpen]);

  const selectModel = useCallback((m: ModelInfo) => {
    bridge.setModel(m.provider, m.id);
    setModelOpen(false);
  }, []);

  const selectThinking = useCallback((level: string) => {
    bridge.setThinkingLevel(level);
    setThinkingOpen(false);
  }, []);

  const toggleModel = useCallback(() => {
    setModelOpen((v) => !v);
    setThinkingOpen(false);
  }, []);

  const toggleThinking = useCallback(() => {
    setThinkingOpen((v) => !v);
    setModelOpen(false);
  }, []);

  const currentThinking = status.thinkingLevel || "off";

  return (
    <div
      className="titlebar-no-drag flex items-center gap-0 shrink-0 select-none"
      style={{
        height: 26,
        borderTop: "1px solid var(--color-border)",
        background: "var(--color-bg-surface)",
        fontSize: 11,
        color: "var(--color-text-tertiary)",
      }}
    >
      {/* Working indicator (left edge accent) */}
      {isLoading && (
        <div
          className="flex items-center gap-1.5 px-2 h-full shrink-0"
          style={{
            background: "var(--color-bg-accent)",
            color: "var(--color-text-on-accent)",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: "currentColor" }}
          />
          <span style={{ fontSize: 10, fontWeight: 500 }}>Working</span>
        </div>
      )}

      {/* ── Model selector ── */}
      <div ref={modelRef} className="relative h-full">
        <button
          onClick={toggleModel}
          className="flex items-center gap-1.5 px-2.5 h-full transition-colors"
          style={{
            color: "var(--color-text-secondary)",
            background: modelOpen ? "var(--color-bg-hover)" : undefined,
          }}
          onMouseEnter={(e) => {
            if (!modelOpen) e.currentTarget.style.background = "var(--color-bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!modelOpen) e.currentTarget.style.background = "";
          }}
          title="Select model"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="8" cy="8" r="2" fill="currentColor" />
          </svg>
          <span className="truncate" style={{ maxWidth: 160 }}>
            {status.model || "No model"}
          </span>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 ml-0.5">
            <path d="M2 5l2-2 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Model dropdown (opens upward) */}
        {modelOpen && (
          <div
            className="absolute bottom-full left-0 mb-1 rounded-lg overflow-hidden animate-fade-in"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-heavy)",
              boxShadow: "var(--shadow-lg)",
              minWidth: 220,
              maxHeight: 320,
              overflowY: "auto",
              zIndex: 100,
            }}
          >
            <div
              className="px-2.5 py-1.5 text-xs font-medium"
              style={{ color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border)" }}
            >
              Models
            </div>
            {models.length === 0 ? (
              <div className="px-2.5 py-3 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                Loading...
              </div>
            ) : (
              models.map((m) => (
                <button
                  key={`${m.provider}/${m.id}`}
                  onClick={() => selectModel(m)}
                  className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors"
                  style={{
                    color: m.isActive ? "var(--color-text-accent)" : "var(--color-text-primary)",
                    fontWeight: m.isActive ? 600 : 400,
                    fontSize: 12,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  {/* Active check */}
                  <span className="w-3 shrink-0 text-center" style={{ fontSize: 10 }}>
                    {m.isActive ? "●" : ""}
                  </span>
                  <span className="truncate">{m.name || m.id}</span>
                  <span
                    className="ml-auto text-xs shrink-0"
                    style={{ color: "var(--color-text-tertiary)", fontSize: 10 }}
                  >
                    {m.provider}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      {/* Separator */}
      <div className="w-px h-3 shrink-0" style={{ background: "var(--color-border)" }} />

      {/* ── Thinking level selector ── */}
      <div ref={thinkingRef} className="relative h-full">
        <button
          onClick={toggleThinking}
          className="flex items-center gap-1 px-2.5 h-full transition-colors"
          style={{
            color: currentThinking !== "off"
              ? "var(--color-text-secondary)"
              : "var(--color-text-tertiary)",
            background: thinkingOpen ? "var(--color-bg-hover)" : undefined,
          }}
          onMouseEnter={(e) => {
            if (!thinkingOpen) e.currentTarget.style.background = "var(--color-bg-hover)";
          }}
          onMouseLeave={(e) => {
            if (!thinkingOpen) e.currentTarget.style.background = "";
          }}
          title="Select thinking level"
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path
              d="M8 2a5 5 0 0 0-2 9.58V13a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-1.42A5 5 0 0 0 8 2z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
            <path d="M6.5 15h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          <span>
            {currentThinking === "off" ? "Thinking off" : `Thinking: ${currentThinking}`}
          </span>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none" className="shrink-0 ml-0.5">
            <path d="M2 5l2-2 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {/* Thinking dropdown (opens upward) */}
        {thinkingOpen && (
          <div
            className="absolute bottom-full left-0 mb-1 rounded-lg overflow-hidden animate-fade-in"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border-heavy)",
              boxShadow: "var(--shadow-lg)",
              minWidth: 160,
              zIndex: 100,
            }}
          >
            <div
              className="px-2.5 py-1.5 text-xs font-medium"
              style={{ color: "var(--color-text-tertiary)", borderBottom: "1px solid var(--color-border)" }}
            >
              Thinking Level
            </div>
            {THINKING_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => selectThinking(level)}
                className="w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors"
                style={{
                  color: level === currentThinking ? "var(--color-text-accent)" : "var(--color-text-primary)",
                  fontWeight: level === currentThinking ? 600 : 400,
                  fontSize: 12,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <span className="w-3 shrink-0 text-center" style={{ fontSize: 10 }}>
                  {level === currentThinking ? "●" : ""}
                </span>
                <span className="capitalize">{level}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Settings gear */}
      {onOpenSettings && (
        <>
          <button
            onClick={onOpenSettings}
            className="flex items-center gap-1 px-2 h-full transition-colors"
            style={{ color: "var(--color-text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            title="Settings (⌘,)"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path
                d="M6.5 1.5h3l.4 1.9a5.5 5.5 0 0 1 1.3.8l1.9-.5 1.5 2.6-1.5 1.3v1.8l1.5 1.3-1.5 2.6-1.9-.5a5.5 5.5 0 0 1-1.3.8l-.4 1.9h-3l-.4-1.9a5.5 5.5 0 0 1-1.3-.8l-1.9.5-1.5-2.6 1.5-1.3V7.6L1.4 6.3l1.5-2.6 1.9.5a5.5 5.5 0 0 1 1.3-.8l.4-1.9z"
                stroke="currentColor"
                strokeWidth="1.2"
                fill="none"
              />
              <circle cx="8" cy="8.5" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" />
            </svg>
          </button>
          <div className="w-px h-3 shrink-0" style={{ background: "var(--color-border)" }} />
        </>
      )}

      {/* Workspace path (right side) */}
      {status.cwd && (
        <div
          className="flex items-center gap-1.5 px-2.5 h-full truncate"
          title={status.cwd}
          style={{ maxWidth: 300 }}
        >
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
            <path
              d="M2 4.5A1.5 1.5 0 0 1 3.5 3h3.379a1.5 1.5 0 0 1 1.06.44l.622.62a1.5 1.5 0 0 0 1.06.44H12.5A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5V4.5z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
            />
          </svg>
          <span className="truncate">
            {status.cwd.replace(/^\/Users\/[^/]+/, "~")}
          </span>
        </div>
      )}
    </div>
  );
}
