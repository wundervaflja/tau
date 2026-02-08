import React, { type ReactNode } from "react";

export type ContextPanelId = "git" | "memory" | "skills" | "vault" | "soul" | null;

interface ContextPanelProps {
  /** Which panel is currently showing, or null if closed */
  activePanel: ContextPanelId;
  /** Close the panel */
  onClose: () => void;
  /** The panel content to render (passed as children keyed by active panel) */
  children: ReactNode;
}

const PANEL_TITLES: Record<string, string> = {
  git: "Git",
  memory: "Memory",
  skills: "Skills",
  vault: "Vault",
  soul: "Soul",
};

export function ContextPanel({ activePanel, onClose, children }: ContextPanelProps) {
  if (!activePanel) return null;

  return (
    <div
      data-context-panel=""
      className="flex flex-col h-full animate-slide-in-right"
      style={{
        width: 300,
        borderLeft: "1px solid var(--color-border)",
      }}
    >
      {/* Panel header */}
      <div
        className="flex items-center justify-between px-3 py-2 shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <span className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>
          {PANEL_TITLES[activePanel] || activePanel}
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-md transition-colors"
          style={{ color: "var(--color-text-tertiary)" }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          title="Close panel (Cmd+\)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-y-auto">
        {children}
      </div>
    </div>
  );
}
