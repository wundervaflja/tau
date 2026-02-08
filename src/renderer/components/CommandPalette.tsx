import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { ContextPanelId } from "../layout/ContextPanel";
import type { CommandInfo } from "../../shared/types";

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onSetPanel?: (panel: ContextPanelId) => void;
  onOpenSettings?: () => void;
  onOpenTree?: () => void;
  onOpenFork?: () => void;
}

interface PaletteItem {
  id: string;
  type: "ui-action" | "feature" | "command";
  label: string;
  detail?: string;
  shortcut?: string;
  panelId?: ContextPanelId;
  /** For commands that need a text argument before executing. */
  needsInput?: string; // placeholder text for sub-input
  /** Execute action — called with optional input arg (for needsInput commands). */
  execute: (input?: string) => void | Promise<void>;
}

// ── Static items ──────────────────────────────────────────────────────

function buildStaticItems(
  onClose: () => void,
  onSetPanel: ((p: ContextPanelId) => void) | undefined,
  onOpenSettings: (() => void) | undefined,
  onOpenTree: (() => void) | undefined,
  onOpenFork: (() => void) | undefined,
): PaletteItem[] {
  const items: PaletteItem[] = [];

  // UI actions
  items.push(
    {
      id: "ui:sidebar", type: "ui-action", label: "Toggle sidebar", detail: "Show or hide left sidebar", shortcut: "\u2318B",
      execute: () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true })); onClose(); },
    },
    {
      id: "ui:terminal", type: "ui-action", label: "Toggle terminal", detail: "Open integrated terminal", shortcut: "\u2318J",
      execute: () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "j", metaKey: true })); onClose(); },
    },
    {
      id: "ui:panel", type: "ui-action", label: "Toggle right panel", detail: "Show or hide context panel", shortcut: "\u2318\\",
      execute: () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "\\", metaKey: true })); onClose(); },
    },
    {
      id: "ui:settings", type: "ui-action", label: "Settings", detail: "Configure API keys and preferences", shortcut: "\u2318,",
      execute: () => { onClose(); onOpenSettings?.(); },
    },
  );

  // Feature panels
  const panels: Array<{ id: string; label: string; detail: string; shortcut: string; panelId: ContextPanelId }> = [
    { id: "feat:memory", label: "Memory", detail: "View and manage memory items", shortcut: "\u2318\u21e7M", panelId: "memory" },
    { id: "feat:skills", label: "Skills", detail: "Create and run automations", shortcut: "\u2318\u21e7S", panelId: "skills" },
    { id: "feat:git", label: "Git", detail: "Repository status and operations", shortcut: "\u2318\u21e7G", panelId: "git" },
    { id: "feat:vault", label: "Vault", detail: "Unified memory and knowledge notes", shortcut: "\u2318\u21e7V", panelId: "vault" },
    { id: "feat:soul", label: "Soul", detail: "Personality profile (SOUL.md)", shortcut: "\u2318\u21e7O", panelId: "soul" },
  ];
  for (const p of panels) {
    items.push({
      id: p.id, type: "feature", label: p.label, detail: p.detail, shortcut: p.shortcut, panelId: p.panelId,
      execute: () => { onSetPanel?.(p.panelId); onClose(); },
    });
  }

  // Special commands that open sub-UIs
  items.push(
    {
      id: "cmd:tree", type: "command", label: "Tree", detail: "Navigate session tree (switch branches)",
      execute: () => { onClose(); setTimeout(() => onOpenTree?.(), 50); },
    },
    {
      id: "cmd:fork", type: "command", label: "Fork", detail: "Create a new fork from a previous message",
      execute: () => { onClose(); setTimeout(() => onOpenFork?.(), 50); },
    },
  );

  // Commands that need sub-input
  items.push(
    {
      id: "cmd:name", type: "command", label: "Name session", detail: "Set session display name",
      needsInput: "Enter session name\u2026",
      execute: async (input) => {
        onClose();
        try {
          if (input?.trim()) await bridge.prompt("/name " + input.trim());
        } catch (err) { console.error("Name session failed:", err); }
      },
    },
    {
      id: "cmd:compact", type: "command", label: "Compact", detail: "Manually compact the session context",
      needsInput: "Compaction instructions (optional, press Enter to skip)\u2026",
      execute: async (input) => {
        onClose();
        try {
          await bridge.recompact(input?.trim() || "");
        } catch (err) {
          console.error("Compact failed:", err);
        }
      },
    },
  );

  // Theme toggle
  items.push({
    id: "ui:theme",
    type: "ui-action",
    label: "Toggle theme",
    detail: "Switch between light and dark mode",
    shortcut: "⌘⇧D",
    execute: async () => {
      const current = await bridge.getTheme();
      const next = current === "dark" ? "light" : "dark";
      await bridge.setTheme(next);
      onClose();
    },
  });

  // Keyboard shortcuts
  items.push({
    id: "ui:shortcuts",
    type: "ui-action",
    label: "Show keyboard shortcuts",
    detail: "View all available keyboard shortcuts",
    shortcut: "\u2318?",
    execute: () => {
      onClose();
      window.dispatchEvent(new CustomEvent("show-shortcuts"));
    },
  });

  // Immediate-execute commands
  items.push(
    {
      id: "cmd:copy", type: "command", label: "Copy last message", detail: "Copy last agent message to clipboard",
      execute: async () => {
        try {
          const text = await bridge.getLastAssistantText();
          if (text) await navigator.clipboard.writeText(text);
        } catch (err) { console.error("Copy failed:", err); }
        onClose();
      },
    },
    {
      id: "cmd:export", type: "command", label: "Export to HTML", detail: "Export session to HTML file",
      execute: async () => {
        try { await bridge.prompt("/export"); } catch (err) { console.error("Export failed:", err); }
        onClose();
      },
    },
    {
      id: "cmd:handoff", type: "command", label: "Handoff", detail: "Generate a handoff document for sharing",
      execute: async () => {
        try { await bridge.prompt("/handoff"); } catch (err) { console.error("Handoff failed:", err); }
        onClose();
      },
    },
    {
      id: "cmd:model", type: "command", label: "Cycle model", detail: "Switch to the next available model",
      execute: async () => {
        try { await bridge.cycleModel(); } catch (err) { console.error("Model cycle failed:", err); }
        onClose();
      },
    },
    {
      id: "cmd:session", type: "command", label: "Session info", detail: "Show session stats and details",
      execute: async () => {
        try { await bridge.prompt("/session"); } catch (err) { console.error("Session info failed:", err); }
        onClose();
      },
    },
  );

  return items;
}

// ── Dynamic tau commands (loaded from bridge) ──────────────────────────

const STATIC_COMMAND_NAMES = new Set([
  "tree", "fork", "name", "compact", "copy", "export", "handoff", "model", "session",
  // These don't make sense in the desktop app or are handled by dedicated UI
  "settings", "login", "logout", "quit", "new", "resume", "hotkeys",
  "scoped-models",
]);

function buildDynamicItems(commands: CommandInfo[], onClose: () => void): PaletteItem[] {
  return commands
    .filter((c) => !STATIC_COMMAND_NAMES.has(c.name))
    .map((c) => ({
      id: `dyn:${c.name}`,
      type: "command" as const,
      label: capitalize(c.name),
      detail: c.description || `(${c.source})`,
      execute: async () => {
        try { await bridge.prompt(`/${c.name}`); } catch (err) { console.error(`Command /${c.name} failed:`, err); }
        onClose();
      },
    }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, " ");
}

// ── Component ─────────────────────────────────────────────────────────

export function CommandPalette({
  isOpen,
  onClose,
  onSetPanel,
  onOpenSettings,
  onOpenTree,
  onOpenFork,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<PaletteItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [subInput, setSubInput] = useState<{ item: PaletteItem; value: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const subInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedIndex(0);
    setSubInput(null);
    loadItems();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const loadItems = useCallback(async () => {
    const staticItems = buildStaticItems(onClose, onSetPanel, onOpenSettings, onOpenTree, onOpenFork);
    try {
      const commands = await bridge.listCommands();
      const dynamicItems = buildDynamicItems(commands, onClose);
      setItems([...staticItems, ...dynamicItems]);
    } catch {
      setItems(staticItems);
    }
  }, [onClose, onSetPanel, onOpenSettings, onOpenTree, onOpenFork]);

  // Focus sub-input when it appears
  useEffect(() => {
    if (subInput) requestAnimationFrame(() => subInputRef.current?.focus());
  }, [subInput]);

  const filtered = query.trim()
    ? items.filter((item) => {
        const q = query.toLowerCase();
        return (
          item.label.toLowerCase().includes(q) ||
          (item.detail && item.detail.toLowerCase().includes(q))
        );
      })
    : items;

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function executeSelected() {
    const item = filtered[selectedIndex];
    if (!item) return;
    if (item.needsInput) {
      setSubInput({ item, value: "" });
    } else {
      item.execute();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      executeSelected();
      return;
    }
  }

  function handleSubInputKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation();
    if (e.key === "Escape") { e.preventDefault(); setSubInput(null); requestAnimationFrame(() => inputRef.current?.focus()); return; }
    if (e.key === "Enter") {
      e.preventDefault();
      const si = subInput;
      if (si) {
        setSubInput(null);
        si.item.execute(si.value);
      }
      return;
    }
  }

  if (!isOpen) return null;

  // Group items
  const uiActions = filtered.filter((i) => i.type === "ui-action");
  const features = filtered.filter((i) => i.type === "feature");
  const commands = filtered.filter((i) => i.type === "command");

  const displayList: (PaletteItem | { type: "header"; label: string })[] = [];
  if (uiActions.length) { displayList.push({ type: "header", label: "Actions" }); displayList.push(...uiActions); }
  if (features.length) { displayList.push({ type: "header", label: "Panels" }); displayList.push(...features); }
  if (commands.length) { displayList.push({ type: "header", label: "Commands" }); displayList.push(...commands); }

  let flatIndex = -1;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }} />
      <div
        data-command-palette=""
        style={{
          position: "relative", width: "100%", maxWidth: 560, maxHeight: "min(560px, 72vh)",
          borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 16px 48px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        {/* Search input or sub-input */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
          {subInput ? (
            <div>
              <div style={{ fontSize: 11, color: "var(--color-text-accent)", marginBottom: 4, fontWeight: 600 }}>
                {subInput.item.label}
              </div>
              <input
                ref={subInputRef}
                value={subInput.value}
                onChange={(e) => setSubInput({ ...subInput, value: e.target.value })}
                onKeyDown={handleSubInputKeyDown}
                placeholder={subInput.item.needsInput}
                style={{
                  width: "100%", background: "transparent", border: "none", outline: "none",
                  fontSize: 15, color: "var(--color-text-primary)", fontFamily: "var(--font-sans)",
                }}
              />
            </div>
          ) : (
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Type a command\u2026"
              style={{
                width: "100%", background: "transparent", border: "none", outline: "none",
                fontSize: 15, color: "var(--color-text-primary)", fontFamily: "var(--font-sans)",
              }}
            />
          )}
        </div>

        {/* Results (hidden when sub-input is showing) */}
        {!subInput && (
          <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
            {filtered.length === 0 && (
              <div style={{ padding: "20px 16px", textAlign: "center", fontSize: 13, color: "var(--color-text-tertiary)" }}>No results</div>
            )}
            {displayList.map((entry, _i) => {
              if ("type" in entry && entry.type === "header") {
                return (
                  <div key={`header-${entry.label}`} style={{ padding: "8px 16px 4px", fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    {entry.label}
                  </div>
                );
              }
              const item = entry as PaletteItem;
              flatIndex++;
              const isSelected = flatIndex === selectedIndex;
              const fi = flatIndex;
              return (
                <div
                  key={item.id}
                  onClick={() => {
                    setSelectedIndex(fi);
                    if (item.needsInput) {
                      setSubInput({ item, value: "" });
                    } else {
                      item.execute();
                    }
                  }}
                  onMouseEnter={() => setSelectedIndex(fi)}
                  style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, background: isSelected ? "var(--color-bg-hover)" : "transparent" }}
                >
                  <div style={{ width: 20, display: "flex", justifyContent: "center", flexShrink: 0, color: "var(--color-text-tertiary)" }}>
                    {renderIcon(item)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: item.type === "command" ? 400 : 500 }}>
                      {item.label}
                    </div>
                    {item.detail && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 1 }}>{item.detail}</div>}
                  </div>
                  {item.shortcut && (
                    <kbd style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, background: "var(--color-bg-hover)", border: "1px solid var(--color-border)", color: "var(--color-text-tertiary)", flexShrink: 0, fontFamily: "var(--font-sans)" }}>
                      {item.shortcut}
                    </kbd>
                  )}
                  {item.needsInput && (
                    <span style={{ fontSize: 10, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{"⏎ args"}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Footer */}
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 16, fontSize: 11, color: "var(--color-text-tertiary)" }}>
          {subInput ? (
            <>
              <span>Enter to confirm</span><span>Esc to go back</span>
            </>
          ) : (
            <>
              <span>{"↑↓ navigate"}</span><span>{"Enter select"}</span><span>{"Esc close"}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function renderIcon(item: PaletteItem) {
  if (item.type === "ui-action") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 6h6M5 8.5h4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
      </svg>
    );
  }
  if (item.type === "feature") {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
        <path d="M5 6h6M5 8h4M5 10h5" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
      </svg>
    );
  }
  // command
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path d="M5 12l-3-4 3-4M11 4l3 4-3 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
