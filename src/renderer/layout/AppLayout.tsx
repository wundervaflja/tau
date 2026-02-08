import React, { useState, useEffect, useCallback, lazy, Suspense, type ReactNode } from "react";
import { TopBar } from "./TopBar";
import { BottomStatusBar } from "./BottomStatusBar";
import { WorkspaceSidebar } from "./WorkspaceSidebar";
import { ContextPanel, type ContextPanelId } from "./ContextPanel";
import { useAgentContext } from "../contexts/AgentContext";
import { useGitFeature } from "../providers/FeatureProviders";
import { bridge } from "../bridge";

const TerminalPanel = lazy(() => import("../components/TerminalPanel"));

export type ActiveView = "chat" | "tasks" | "knowledge" | "canvas" | "journal";

interface AppLayoutProps {
  /** The chat area (center) */
  children: ReactNode;
  /** Which context panel content to show */
  contextPanelContent: ReactNode | null;
  /** Active right panel id */
  activePanel: ContextPanelId;
  /** Set which right panel to show */
  onSetPanel: (panel: ContextPanelId) => void;
  /** Open session switcher (Cmd+K) */
  onOpenSessionSwitcher: () => void;
  /** Open command palette (Cmd+Shift+P) */
  onOpenCommandPalette: () => void;
  /** Open the settings modal */
  onOpenSettings: () => void;
  /** Open the shortcuts modal */
  onOpenShortcuts: () => void;
  /** Which main view is active */
  activeView: ActiveView;
  /** Switch main view */
  onSetView: (view: ActiveView) => void;
}

export function AppLayout({
  children,
  contextPanelContent,
  activePanel,
  onSetPanel,
  onOpenSessionSwitcher,
  onOpenCommandPalette,
  onOpenSettings,
  onOpenShortcuts,
  activeView,
  onSetView,
}: AppLayoutProps) {
  const agent = useAgentContext();
  const git = useGitFeature();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Right panel stays closed by default; user can open it manually

  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closePanel = useCallback(() => onSetPanel(null), [onSetPanel]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+B — toggle sidebar
      if (meta && e.key === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
        return;
      }

      // Cmd+J — toggle terminal
      if (meta && e.key === "j") {
        e.preventDefault();
        setTerminalOpen((v) => !v);
        return;
      }

      // Cmd+\ — toggle right panel
      if (meta && e.key === "\\") {
        e.preventDefault();
        if (activePanel) {
          onSetPanel(null);
        } else {
          // Re-open last panel or default to git
          onSetPanel("git");
        }
        return;
      }

      // Cmd+, — open settings
      if (meta && e.key === ",") {
        e.preventDefault();
        onOpenSettings();
        return;
      }

      // Cmd+K — session switcher
      if (meta && e.key === "k") {
        e.preventDefault();
        onOpenSessionSwitcher();
        return;
      }

      // Cmd+Shift+P — command palette
      if (meta && e.shiftKey && e.key.toLowerCase() === "p") {
        e.preventDefault();
        onOpenCommandPalette();
        return;
      }

      // Cmd+N — new chat
      if (meta && e.key === "n") {
        e.preventDefault();
        agent.newSession();
        return;
      }

      // Cmd+Shift+T — toggle Tasks view
      if (meta && e.shiftKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        onSetView(activeView === "tasks" ? "chat" : "tasks");
        return;
      }

      // Cmd+Shift+K — toggle Knowledge view
      if (meta && e.shiftKey && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onSetView(activeView === "knowledge" ? "chat" : "knowledge");
        return;
      }

      // Cmd+Shift+C — toggle Canvas view
      if (meta && e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        onSetView(activeView === "canvas" ? "chat" : "canvas");
        return;
      }

      // Cmd+Shift+J — toggle Journal view
      if (meta && e.shiftKey && e.key.toLowerCase() === "j") {
        e.preventDefault();
        onSetView(activeView === "journal" ? "chat" : "journal");
        return;
      }

      // Cmd+Shift+D — toggle dark/light theme
      if (meta && e.shiftKey && e.key.toLowerCase() === "d") {
        e.preventDefault();
        bridge.getTheme().then((current: string) => {
          bridge.setTheme(current === "dark" ? "light" : "dark");
        });
        return;
      }

      // Cmd+? — show keyboard shortcuts
      if (meta && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
        e.preventDefault();
        onOpenShortcuts();
        return;
      }

      // Cmd+Shift+<key> — open specific panels
      if (meta && e.shiftKey) {
        const panelMap: Record<string, ContextPanelId> = {
          m: "memory",
          s: "skills",
          g: "git",
          v: "vault",
          o: "soul",
        };
        const panel = panelMap[e.key.toLowerCase()];
        if (panel) {
          e.preventDefault();
          onSetPanel(activePanel === panel ? null : panel);
          return;
        }
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePanel, activeView, onSetPanel, onSetView, onOpenSessionSwitcher, onOpenCommandPalette, onOpenSettings, onOpenShortcuts, agent.newSession]);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "var(--color-bg-app)" }}>
      {/* Titlebar drag region */}
      <div
        className="titlebar-drag fixed top-0 left-0 right-0 z-50"
        style={{ height: "var(--titlebar-height)" }}
      />

      {/* Left sidebar */}
      {sidebarOpen && (
        <WorkspaceSidebar
          cwd={agent.status.cwd}
          sessionVersion={agent.sessionVersion}
          currentSessionId={agent.status.sessionId}
          onNewSession={agent.newSession}
          onClose={toggleSidebar}
        />
      )}

      {/* Center: TopBar + Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* TopBar with drag region */}
        <div
          className="titlebar-drag shrink-0"
          style={{ paddingTop: "var(--titlebar-height)" }}
        >
          <TopBar
            onToggleSidebar={toggleSidebar}
            sidebarOpen={sidebarOpen}
            activeView={activeView}
            onSetView={onSetView}
          />
        </div>

        {/* Chat area */}
        <div className="flex-1 overflow-hidden relative">
          {children}
        </div>

        {/* Terminal panel */}
        {terminalOpen && (
          <Suspense fallback={null}>
            <TerminalPanel
              cwd={agent.status.cwd}
              visible={terminalOpen}
              onClose={() => setTerminalOpen(false)}
            />
          </Suspense>
        )}

        {/* Bottom status bar */}
        <BottomStatusBar onOpenSettings={onOpenSettings} />
      </div>

      {/* Right context panel */}
      <ContextPanel activePanel={activePanel} onClose={closePanel}>
        {contextPanelContent}
      </ContextPanel>
    </div>
  );
}
