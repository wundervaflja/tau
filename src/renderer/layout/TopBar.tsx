import React from "react";
import type { ActiveView } from "./AppLayout";

interface TopBarProps {
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
  activeView: ActiveView;
  onSetView: (view: ActiveView) => void;
}

export function TopBar({
  onToggleSidebar,
  sidebarOpen,
  activeView,
  onSetView,
}: TopBarProps) {
  return (
    <div
      className="titlebar-no-drag flex items-center gap-3 px-3 shrink-0"
      style={{
        height: 48,
        borderBottom: "1px solid var(--color-border)",
        background: "var(--color-bg-surface)",
      }}
    >
      {/* Sidebar toggle */}
      <button
        onClick={onToggleSidebar}
        className="p-1.5 rounded-md transition-colors"
        style={{ color: "var(--color-text-tertiary)" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
        title={sidebarOpen ? "Hide sidebar (Cmd+B)" : "Show sidebar (Cmd+B)"}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
          <path d="M5.5 2.5v11" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>

      {/* View switcher */}
      <div
        className="flex items-center rounded-md p-0.5"
        style={{ background: "var(--color-bg-hover)" }}
      >
        <ViewTab
          label="Chat"
          isActive={activeView === "chat"}
          onClick={() => onSetView("chat")}
        />
        <ViewTab
          label="Tasks"
          isActive={activeView === "tasks"}
          onClick={() => onSetView("tasks")}
        />
        <ViewTab
          label="Knowledge"
          isActive={activeView === "knowledge"}
          onClick={() => onSetView("knowledge")}
        />
        <ViewTab
          label="Canvas"
          isActive={activeView === "canvas"}
          onClick={() => onSetView("canvas")}
        />
        <ViewTab
          label="Journal"
          isActive={activeView === "journal"}
          onClick={() => onSetView("journal")}
        />
      </div>
    </div>
  );
}

function ViewTab({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded text-xs font-medium transition-colors"
      style={{
        background: isActive ? "var(--color-bg-surface)" : "transparent",
        color: isActive ? "var(--color-text-primary)" : "var(--color-text-tertiary)",
        boxShadow: isActive ? "0 1px 2px rgba(0,0,0,0.1)" : "none",
      }}
    >
      {label}
    </button>
  );
}
