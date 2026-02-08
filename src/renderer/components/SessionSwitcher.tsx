import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { SessionInfo } from "../../shared/types";

interface SessionSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  cwd: string;
  sessionVersion: number;
  onNewSession: () => void;
}

interface SwitcherItem {
  id: string;
  type: "action" | "session";
  label: string;
  detail?: string;
  time?: string;
  file?: string;
  folderPath?: string;
  shortcut?: string;
}

export function SessionSwitcher({
  isOpen,
  onClose,
  cwd,
  sessionVersion,
  onNewSession,
}: SessionSwitcherProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SwitcherItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedIndex(0);
    loadItems();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen, sessionVersion, cwd]);

  const loadItems = useCallback(async () => {
    const results: SwitcherItem[] = [
      { id: "__new", type: "action", label: "New chat", detail: "Start a fresh session", shortcut: "\u2318N" },
      { id: "__folder", type: "action", label: "Open folder\u2026", detail: "Switch working directory" },
    ];

    try {
      const allSessions: SessionInfo[] = await bridge.listAllSessions();
      allSessions.sort((a, b) => b.timestamp - a.timestamp);

      for (const s of allSessions) {
        const folderName = s.cwd ? s.cwd.split("/").pop() || s.cwd : "";
        const displayText = s.name || s.firstMessage;
        const preview = displayText
          ? displayText.slice(0, 80) + (displayText.length > 80 ? "\u2026" : "")
          : "(empty session)";
        results.push({
          id: s.file,
          type: "session",
          label: preview,
          detail: folderName,
          time: formatTime(s.timestamp),
          file: s.file,
          folderPath: s.cwd,
        });
      }
    } catch {
      try {
        const sessions = await bridge.listSessions();
        for (const s of sessions) {
          results.push({
            id: s.file,
            type: "session",
            label: (s.name || s.firstMessage)?.slice(0, 80) || "(empty session)",
            detail: cwd.split("/").pop() || cwd,
            time: formatTime(s.timestamp),
            file: s.file,
            folderPath: cwd,
          });
        }
      } catch { /* ignore */ }
    }

    setItems(results);
  }, [cwd]);

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

  async function executeItem(item: SwitcherItem) {
    if (item.id === "__new") {
      onNewSession();
      onClose();
      return;
    }
    if (item.id === "__folder") {
      const dir = await bridge.selectDirectory();
      if (dir) {
        // Set up agent + workspace in the selected directory (spawns a tau session)
        await bridge.workspaceOpen(dir);
      }
      onClose();
      return;
    }
    if (item.file) {
      if (item.folderPath && item.folderPath !== cwd) {
        await bridge.openDirectory(item.folderPath);
      }
      await bridge.switchSession(item.file);
      onClose();
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
      if (filtered[selectedIndex]) executeItem(filtered[selectedIndex]);
      return;
    }
  }

  if (!isOpen) return null;

  const actions = filtered.filter((i) => i.type === "action");
  const sessions = filtered.filter((i) => i.type === "session");

  const displayList: (SwitcherItem | { type: "header"; label: string })[] = [];
  if (actions.length) {
    displayList.push({ type: "header", label: "Quick Actions" });
    displayList.push(...actions);
  }
  if (sessions.length) {
    displayList.push({ type: "header", label: "Sessions" });
    displayList.push(...sessions);
  }

  let flatIndex = -1;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }} />
      <div
        data-session-switcher=""
        style={{
          position: "relative", width: "100%", maxWidth: 560, maxHeight: "min(520px, 70vh)",
          borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 16px 48px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Switch session\u2026"
            style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 15, color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}
          />
        </div>

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
            const item = entry as SwitcherItem;
            flatIndex++;
            const isSelected = flatIndex === selectedIndex;
            const fi = flatIndex;
            return (
              <div
                key={item.id}
                onClick={() => executeItem(item)}
                onMouseEnter={() => setSelectedIndex(fi)}
                style={{ padding: "8px 16px", cursor: "pointer", display: "flex", alignItems: "center", gap: 10, background: isSelected ? "var(--color-bg-hover)" : "transparent" }}
              >
                <div style={{ width: 20, display: "flex", justifyContent: "center", flexShrink: 0, color: "var(--color-text-tertiary)" }}>
                  {item.type === "action" ? (
                    item.id === "__new" ? (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                    ) : (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M2 4.5V12a1 1 0 001 1h10a1 1 0 001-1V6.5a1 1 0 00-1-1H8.5L7 4H3a1 1 0 00-1 .5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                    )
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 3h10v10H3z" stroke="currentColor" strokeWidth="1.2" rx="1.5" /><path d="M5 6h6M5 8.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" /></svg>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: "var(--color-text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: item.type === "action" ? 500 : 400 }}>
                    {item.label}
                  </div>
                  {item.detail && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", marginTop: 1 }}>{item.detail}</div>}
                </div>
                {item.time && <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", flexShrink: 0 }}>{item.time}</div>}
                {item.shortcut && (
                  <kbd style={{ fontSize: 10, padding: "2px 5px", borderRadius: 4, background: "var(--color-bg-hover)", border: "1px solid var(--color-border)", color: "var(--color-text-tertiary)", flexShrink: 0, fontFamily: "var(--font-sans)" }}>
                    {item.shortcut}
                  </kbd>
                )}
              </div>
            );
          })}
        </div>

        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 16, fontSize: 11, color: "var(--color-text-secondary)" }}>
          <span>{"↑↓ navigate"}</span><span>{"Enter select"}</span><span>{"Esc close"}</span>
        </div>
      </div>
    </div>
  );
}

function formatTime(ts: number): string {
  const now = Date.now();
  const diffMs = now - ts;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
