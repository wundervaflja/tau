import React, { useState, useEffect, useCallback, Suspense, lazy } from "react";
import { ChatView } from "./ChatView";
import { SessionSwitcher } from "./SessionSwitcher";
import { CommandPalette } from "./CommandPalette";
import { SettingsModal } from "./SettingsModal";
import { ShortcutsModal } from "./ShortcutsModal";
import { AppLayout } from "../layout/AppLayout";

const TaskView = lazy(() => import("./TaskView").then((m) => ({ default: m.TaskView })));
const KnowledgeView = lazy(() => import("./KnowledgeView").then((m) => ({ default: m.KnowledgeView })));
const CanvasView = lazy(() => import("./CanvasView").then((m) => ({ default: m.CanvasView })));
const JournalView = lazy(() => import("./JournalView").then((m) => ({ default: m.JournalView })));
const TreeNavigator = lazy(() => import("./TreeNavigator").then((m) => ({ default: m.TreeNavigator })));
const ForkSelector = lazy(() => import("./ForkSelector").then((m) => ({ default: m.ForkSelector })));

// Lazy-loaded panel components — only loaded when their panel is opened
const GitSidebar = lazy(() => import("./GitSidebar").then((m) => ({ default: m.GitSidebar })));
const MemoryPanel = lazy(() => import("./MemoryPanel").then((m) => ({ default: m.MemoryPanel })));
const SkillsPanel = lazy(() => import("./SkillsPanel").then((m) => ({ default: m.SkillsPanel })));
const VaultPanel = lazy(() => import("./VaultPanel").then((m) => ({ default: m.VaultPanel })));
const SoulPanel = lazy(() => import("./SoulPanel").then((m) => ({ default: m.SoulPanel })));
import type { ContextPanelId } from "../layout/ContextPanel";
import { useAgentContext } from "../contexts/AgentContext";
import {
  useGitFeature,
  useMemoryFeature,
  useSkillsFeature,
  useVaultFeature,
  useSoulFeature,
} from "../providers/FeatureProviders";
import { bridge } from "../bridge";


export function App() {
  const agent = useAgentContext();
  const git = useGitFeature();
  const memory = useMemoryFeature();
  const skills = useSkillsFeature();
  const vault = useVaultFeature();
  const soul = useSoulFeature();

  const [sessionSwitcherOpen, setSessionSwitcherOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [treeOpen, setTreeOpen] = useState(false);
  const [forkOpen, setForkOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [activeView, setActiveView] = useState<"chat" | "tasks" | "knowledge" | "canvas" | "journal">("chat");
  const [activePanel, setActivePanel] = useState<ContextPanelId>(null);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [composerPrefill, setComposerPrefill] = useState<string | null>(null);

  // Theme
  useEffect(() => {
    bridge.getTheme().then((t: string) => setTheme(t as any));
    const unsub = bridge.onThemeChange((t: string) => setTheme(t as any));
    return unsub;
  }, []);

  // Show shortcuts event (from CommandPalette)
  useEffect(() => {
    function handleShowShortcuts() {
      setShortcutsOpen(true);
    }
    window.addEventListener("show-shortcuts", handleShowShortcuts);
    return () => window.removeEventListener("show-shortcuts", handleShowShortcuts);
  }, []);

  // Auto-switch to Canvas view when agent renders canvas UI
  useEffect(() => {
    function handleCanvasUpdate(e: Event) {
      if ((e as CustomEvent).detail) {
        setActiveView("canvas");
      }
    }
    window.addEventListener("canvas:update", handleCanvasUpdate);
    return () => window.removeEventListener("canvas:update", handleCanvasUpdate);
  }, []);

  // Handlers
  const openSessionSwitcher = useCallback(() => setSessionSwitcherOpen(true), []);
  const closeSessionSwitcher = useCallback(() => setSessionSwitcherOpen(false), []);
  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), []);
  const closeCommandPalette = useCallback(() => setCommandPaletteOpen(false), []);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openTree = useCallback(() => setTreeOpen(true), []);
  const closeTree = useCallback(() => setTreeOpen(false), []);
  const openFork = useCallback(() => setForkOpen(true), []);
  const closeFork = useCallback(() => setForkOpen(false), []);

  const handleEditorText = useCallback((text: string) => {
    setComposerPrefill(text);
    setActiveView("chat"); // make sure chat is visible
  }, []);

  const consumePrefill = useCallback(() => {
    setComposerPrefill(null);
  }, []);

  // Render context panel content based on activePanel (lazy-loaded)
  function renderPanelContent(): React.ReactNode {
    const panelFallback = <PanelPlaceholder text="Loading..." />;

    switch (activePanel) {
      case "git":
        if (!git) return <PanelPlaceholder text="Git is not available for this workspace." />;
        return (
          <Suspense fallback={panelFallback}>
            <GitSidebar
              status={git.status}
              branches={git.branches}
              loading={git.loading}
              onCheckout={git.checkout}
              onCheckoutNew={git.checkoutNewBranch}
              onStage={git.stageFile}
              onUnstage={git.unstageFile}
              onStageAll={git.stageAll}
              onDiscard={git.discardFile}
              onGetDiff={git.getDiff}
              onRefresh={git.refresh}
              onToggle={() => setActivePanel(null)}
            />
          </Suspense>
        );
      case "memory":
        if (!memory) return <PanelPlaceholder text="Memory is loading..." />;
        return (
          <Suspense fallback={panelFallback}>
            <MemoryPanel items={memory.items} onAdd={memory.add} onDelete={memory.remove} />
          </Suspense>
        );
      case "skills":
        if (!skills) return <PanelPlaceholder text="Skills are not available." />;
        return (
          <Suspense fallback={panelFallback}>
            <SkillsPanel
              skills={skills.skills}
              onSave={skills.save}
              onDelete={skills.remove}
              onRun={(skill) => skills.run(skill.id)}
            />
          </Suspense>
        );
      case "vault":
        if (!vault) return <PanelPlaceholder text="Vault is loading..." />;
        return (
          <Suspense fallback={panelFallback}>
            <VaultPanel
              notes={vault.notes}
              onSearch={vault.search}
              onRead={vault.read}
              onCreate={vault.create}
              onDelete={vault.remove}
              onRefresh={vault.refresh}
            />
          </Suspense>
        );
      case "soul":
        if (!soul) return <PanelPlaceholder text="Soul is loading..." />;
        return (
          <Suspense fallback={panelFallback}>
            <SoulPanel
              status={soul.status}
              content={soul.content}
              proposals={soul.proposals}
              onWrite={soul.write}
              onClearProposals={soul.clearProposals}
              onRefresh={soul.refresh}
            />
          </Suspense>
        );
      default:
        return null;
    }
  }

  return (
    <div data-theme={theme}>
      <AppLayout
        contextPanelContent={renderPanelContent()}
        activePanel={activePanel}
        onSetPanel={setActivePanel}
        onOpenSessionSwitcher={openSessionSwitcher}
        onOpenCommandPalette={openCommandPalette}
        onOpenSettings={openSettings}
        onOpenShortcuts={() => setShortcutsOpen(true)}
        activeView={activeView}
        onSetView={setActiveView}
      >
        {activeView === "tasks" ? (
          <Suspense fallback={<div />}>
            <TaskView />
          </Suspense>
        ) : activeView === "knowledge" ? (
          <Suspense fallback={<div />}>
            <KnowledgeView />
          </Suspense>
        ) : activeView === "canvas" ? (
          <Suspense fallback={<div />}>
            <CanvasView />
          </Suspense>
        ) : activeView === "journal" ? (
          <Suspense fallback={<div />}>
            <JournalView />
          </Suspense>
        ) : (
          <ChatView prefillText={composerPrefill} onPrefillConsumed={consumePrefill} />
        )}
      </AppLayout>

      {/* Overlays */}
      <SessionSwitcher
        isOpen={sessionSwitcherOpen}
        onClose={closeSessionSwitcher}
        cwd={agent.status.cwd}
        sessionVersion={agent.sessionVersion}
        onNewSession={agent.newSession}
      />

      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={closeCommandPalette}
        onSetPanel={setActivePanel}
        onOpenSettings={openSettings}
        onOpenTree={openTree}
        onOpenFork={openFork}
      />

      <Suspense fallback={null}>
        <TreeNavigator
          isOpen={treeOpen}
          onClose={closeTree}
          onEditorText={handleEditorText}
        />
      </Suspense>

      <Suspense fallback={null}>
        <ForkSelector
          isOpen={forkOpen}
          onClose={closeFork}
          onEditorText={handleEditorText}
        />
      </Suspense>

      <SettingsModal isOpen={settingsOpen} onClose={closeSettings} />
      <ShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}

function PanelPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-full p-4">
      <p className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>{text}</p>
    </div>
  );
}
