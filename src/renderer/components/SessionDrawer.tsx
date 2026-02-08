import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { SessionInfo } from "../../shared/types";

interface SessionDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cwd: string;
  sessionVersion: number;
  onNewSession: () => void;
}

interface FolderGroup {
  path: string;
  name: string;
  sessions: SessionInfo[];
  isActive: boolean;
}

export function SessionDrawer({
  isOpen,
  onClose,
  cwd,
  sessionVersion,
  onNewSession,
}: SessionDrawerProps) {
  const [groups, setGroups] = useState<FolderGroup[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const [renamingSession, setRenamingSession] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const loadSessions = useCallback(async () => {
    try {
      const allSessions = await bridge.listAllSessions();

      const byFolder = new Map<string, SessionInfo[]>();
      for (const s of allSessions) {
        const folder = s.cwd || "(unknown)";
        if (!byFolder.has(folder)) byFolder.set(folder, []);
        byFolder.get(folder)!.push(s);
      }

      for (const sessions of byFolder.values()) {
        sessions.sort((a, b) => b.timestamp - a.timestamp);
      }

      const folderGroups: FolderGroup[] = [];
      for (const [path, sessions] of byFolder) {
        folderGroups.push({
          path,
          name: path.split("/").pop() || path,
          sessions,
          isActive: path === cwd,
        });
      }

      folderGroups.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        const aTime = a.sessions[0]?.timestamp ?? 0;
        const bTime = b.sessions[0]?.timestamp ?? 0;
        return bTime - aTime;
      });

      setGroups(folderGroups);

      if (!initializedRef.current) {
        initializedRef.current = true;
        setExpandedFolders(new Set([cwd]));
      }
    } catch {
      const sessions = await bridge.listSessions();
      setGroups([
        {
          path: cwd,
          name: cwd.split("/").pop() || cwd,
          sessions,
          isActive: true,
        },
      ]);
      if (!initializedRef.current) {
        initializedRef.current = true;
        setExpandedFolders(new Set([cwd]));
      }
    }
  }, [cwd]);

  useEffect(() => {
    loadSessions();
  }, [cwd, sessionVersion, loadSessions]);

  useEffect(() => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      next.add(cwd);
      return next;
    });
  }, [cwd]);

  function toggleFolder(path: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function handleSwitch(file: string, folderPath: string) {
    if (folderPath !== cwd && folderPath !== "(unknown)") {
      await bridge.openDirectory(folderPath);
    }
    await bridge.switchSession(file);
    await loadSessions();
    onClose();
  }

  async function handleDeleteSession(sessionFile: string) {
    if (confirmDelete === sessionFile) {
      await bridge.deleteSession(sessionFile);
      setConfirmDelete(null);
      await loadSessions();
    } else {
      setConfirmDelete(sessionFile);
      setTimeout(() => setConfirmDelete(null), 3000);
    }
  }

  async function handleDeleteFolder(group: FolderGroup) {
    if (confirmDeleteFolder === group.path) {
      const files = group.sessions.map((s) => s.file);
      await bridge.deleteSessionFolder(files);
      setConfirmDeleteFolder(null);
      await loadSessions();
    } else {
      setConfirmDeleteFolder(group.path);
      setTimeout(() => setConfirmDeleteFolder(null), 3000);
    }
  }

  function startRename(session: SessionInfo) {
    setRenamingSession(session.file);
    setRenameValue(session.name || session.firstMessage || "");
  }

  async function handleRename(sessionFile: string) {
    const trimmed = renameValue.trim();
    if (trimmed) {
      await bridge.renameSession(sessionFile, trimmed);
      await loadSessions();
    }
    setRenamingSession(null);
  }

  function formatTime(ts: number): string {
    const now = Date.now();
    const diffMs = now - ts;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return "now";
    if (diffMins < 60) return `${diffMins}m`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays < 30) return `${diffDays}d`;
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  return (
    <div>
      {/* Backdrop */}
      {isOpen && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            zIndex: 40,
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
          }}
        />
      )}

      {/* Slide-in panel */}
      <div
        data-session-drawer=""
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          bottom: 0,
          width: "300px",
          maxWidth: "80%",
          transform: isOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 200ms ease",
          borderRight: "1px solid var(--color-border)",
          boxShadow: isOpen ? "4px 0 24px rgba(0,0,0,0.25)" : "none",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          className="titlebar-drag flex items-end px-4 pb-3"
          style={{ paddingTop: "var(--titlebar-height)" }}
        >
          <div className="titlebar-no-drag flex items-center gap-2 w-full">
            <h3
              style={{
                margin: 0,
                color: "var(--color-text-primary)",
                fontSize: "14px",
                fontWeight: 600,
              }}
            >
              Sessions
            </h3>

            <button
              onClick={onNewSession}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg transition-colors"
              style={{
                marginLeft: 8,
                background: "var(--color-bg-elevated)",
                color: "var(--color-text-primary)",
                border: "1px solid var(--color-border)",
              }}
              title="New conversation"
            >
              New chat
            </button>

            <button
              onClick={onClose}
              className="p-2 rounded-lg transition-colors"
              style={{ marginLeft: "auto", color: "var(--color-text-tertiary)" }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path
                  d="M3 3l10 10M13 3l-10 10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Session list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {groups.length === 0 ? (
            <div
              className="px-3 py-6 text-center text-sm"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              No conversations yet
            </div>
          ) : (
            groups.map((group) => {
              const isExpanded = expandedFolders.has(group.path);
              const isConfirmingFolderDelete = confirmDeleteFolder === group.path;
              return (
                <div key={group.path} className="mb-1">
                  {/* Folder header */}
                  <div
                    className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors"
                    onMouseEnter={(e) =>
                      (e.currentTarget.style.background = "var(--color-bg-hover)")
                    }
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  >
                    <button
                      onClick={() => toggleFolder(group.path)}
                      className="flex items-center gap-1.5 flex-1 min-w-0 text-xs font-medium"
                      style={{
                        color: group.isActive
                          ? "var(--color-text-primary)"
                          : "var(--color-text-secondary)",
                      }}
                      title={group.path}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                        className="shrink-0"
                        style={{
                          transform: isExpanded ? "rotate(0deg)" : "rotate(-90deg)",
                          transition: "transform 0.15s",
                        }}
                      >
                        <path
                          d="M4 6l4 4 4-4"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      <span className="truncate">{group.name}</span>
                    </button>

                    <span
                      className="text-xs tabular-nums shrink-0"
                      style={{ color: "var(--color-text-tertiary)" }}
                    >
                      {group.sessions.length}
                    </span>

                    {group.isActive && (
                      <span
                        className="w-1.5 h-1.5 rounded-full shrink-0"
                        style={{ background: "var(--color-text-accent)" }}
                      />
                    )}

                    {!group.isActive && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDeleteFolder(group);
                        }}
                        className="shrink-0 p-0.5 rounded transition-colors opacity-0 group-hover:opacity-100"
                        style={{
                          color: isConfirmingFolderDelete
                            ? "var(--color-text-on-accent)"
                            : "var(--color-text-tertiary)",
                          background: isConfirmingFolderDelete
                            ? "var(--color-text-error)"
                            : "transparent",
                        }}
                        onMouseEnter={(e) => {
                          if (!isConfirmingFolderDelete)
                            e.currentTarget.style.color = "var(--color-text-error)";
                        }}
                        onMouseLeave={(e) => {
                          if (!isConfirmingFolderDelete)
                            e.currentTarget.style.color = "var(--color-text-tertiary)";
                        }}
                        title={
                          isConfirmingFolderDelete
                            ? "Click again to delete all sessions"
                            : "Delete all sessions in this folder"
                        }
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                          <path
                            d="M4 4l8 8M12 4l-8 8"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                          />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Sessions */}
                  {isExpanded && (
                    <div className="ml-1">
                      {group.sessions.map((session) => {
                        const isConfirming = confirmDelete === session.file;
                        return (
                          <div
                            key={session.id}
                            className="group flex items-start rounded-md transition-colors mb-0.5"
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.background = "var(--color-bg-hover)")
                            }
                            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                          >
                            {renamingSession === session.file ? (
                              <form
                                onSubmit={(e) => { e.preventDefault(); handleRename(session.file); }}
                                className="flex-1 min-w-0 px-3 py-2"
                              >
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={() => handleRename(session.file)}
                                  onKeyDown={(e) => { if (e.key === "Escape") setRenamingSession(null); }}
                                  className="w-full text-sm px-1.5 py-0.5 rounded"
                                  style={{
                                    background: "var(--color-bg-elevated)",
                                    color: "var(--color-text-primary)",
                                    border: "1px solid var(--color-text-accent)",
                                    outline: "none",
                                  }}
                                />
                              </form>
                            ) : (
                              <button
                                onClick={() => handleSwitch(session.file, group.path)}
                                className="flex-1 min-w-0 text-left px-3 py-2 text-sm"
                                style={{ color: "var(--color-text-secondary)" }}
                              >
                                <div className="flex items-baseline gap-2">
                                  <span
                                    className="truncate flex-1"
                                    style={{ color: "var(--color-text-primary)" }}
                                  >
                                    {session.name || session.firstMessage}
                                  </span>
                                  <span
                                    className="text-xs shrink-0 tabular-nums"
                                    style={{ color: "var(--color-text-tertiary)" }}
                                  >
                                    {formatTime(session.timestamp)}
                                  </span>
                                </div>
                                <div
                                  className="text-xs mt-0.5"
                                  style={{ color: "var(--color-text-tertiary)" }}
                                >
                                  {session.messageCount} messages
                                </div>
                              </button>
                            )}

                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(session);
                              }}
                              className="shrink-0 p-1.5 mt-2 rounded transition-colors opacity-0 group-hover:opacity-100"
                              style={{ color: "var(--color-text-tertiary)" }}
                              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--color-text-primary)")}
                              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--color-text-tertiary)")}
                              title="Rename session"
                            >
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                                <path d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSession(session.file);
                              }}
                              className="shrink-0 p-1.5 mt-2 mr-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                              style={{
                                color: isConfirming
                                  ? "var(--color-text-on-accent)"
                                  : "var(--color-text-tertiary)",
                                background: isConfirming ? "var(--color-text-error)" : "transparent",
                              }}
                              onMouseEnter={(e) => {
                                if (!isConfirming)
                                  e.currentTarget.style.color = "var(--color-text-error)";
                              }}
                              onMouseLeave={(e) => {
                                if (!isConfirming)
                                  e.currentTarget.style.color = "var(--color-text-tertiary)";
                              }}
                              title={isConfirming ? "Click again to confirm" : "Delete session"}
                            >
                              <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                                <path
                                  d="M4 4l8 8M12 4l-8 8"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                  strokeLinecap="round"
                                />
                              </svg>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid var(--color-border)", padding: "12px" }}>
          <button
            onClick={async () => {
              const dir = await bridge.selectDirectory();
              if (dir) {
                await bridge.workspaceOpen(dir);
                await loadSessions();
              }
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{ color: "var(--color-text-secondary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            Open folder...
          </button>
        </div>
      </div>
    </div>
  );
}
