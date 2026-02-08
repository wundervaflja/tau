import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import { useWorkspace } from "../contexts/WorkspaceContext";
import { usePersona } from "../contexts/PersonaContext";
import type { SessionInfo } from "../../shared/types";

interface WorkspaceSidebarProps {
  cwd: string;
  sessionVersion: number;
  currentSessionId?: string;
  onNewSession: () => void;
  onClose: () => void;
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
  return new Date(ts).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

interface FolderGroup {
  path: string;
  name: string;
  sessions: SessionInfo[];
  isActive: boolean;
}

export function WorkspaceSidebar({
  cwd,
  sessionVersion,
  currentSessionId,
  onNewSession,
  onClose,
}: WorkspaceSidebarProps) {
  const { state, openWorkspace } = useWorkspace();
  const { personaId } = usePersona();
  const [groups, setGroups] = useState<FolderGroup[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    new Set(),
  );
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmDeleteFolder, setConfirmDeleteFolder] = useState<string | null>(
    null,
  );
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
      // Ensure the active cwd always has a folder group, even with 0 sessions
      if (!folderGroups.some((g) => g.path === cwd)) {
        folderGroups.push({
          path: cwd,
          name: cwd.split("/").pop() || cwd,
          sessions: [],
          isActive: true,
        });
      }
      folderGroups.sort((a, b) => {
        if (a.isActive && !b.isActive) return -1;
        if (!a.isActive && b.isActive) return 1;
        return (
          (b.sessions[0]?.timestamp ?? 0) - (a.sessions[0]?.timestamp ?? 0)
        );
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
      await bridge.deleteSessionFolder(group.sessions.map((s) => s.file));
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

  return (
    <div
      data-workspace-sidebar=""
      className="flex flex-col h-full"
      style={{
        width: "var(--sidebar-width)",
        borderRight: "1px solid var(--color-border)",
      }}
    >
      {/* Workspace header */}
      <div
        className="titlebar-drag flex items-end px-3 pb-2 shrink-0"
        style={{ paddingTop: "var(--titlebar-height)" }}
      >
        <div className="titlebar-no-drag flex items-center gap-2 w-full">
          <div className="flex-1 min-w-0">
            <div
              className="text-xs font-medium truncate"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {state?.name || cwd.split("/").pop() || "Tau"}
            </div>
          </div>
          <button
            onClick={onNewSession}
            className="p-1.5 rounded-md transition-colors shrink-0"
            style={{ color: "var(--color-text-tertiary)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--color-bg-hover)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            title="New chat (Cmd+N)"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M8 3v10M3 8h10"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto px-1">
        {groups.length === 0 ? (
          <div
            className="px-3 py-6 text-center text-xs"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            No conversations yet
          </div>
        ) : (
          groups.map((group) => {
            const isExpanded = expandedFolders.has(group.path);
            const isConfirmingFolder = confirmDeleteFolder === group.path;
            return (
              <div key={group.path} className="mb-0.5">
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
                        transform: isExpanded
                          ? "rotate(0deg)"
                          : "rotate(-90deg)",
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
                        color: isConfirmingFolder
                          ? "var(--color-text-on-accent)"
                          : "var(--color-text-tertiary)",
                        background: isConfirmingFolder
                          ? "var(--color-text-error)"
                          : "transparent",
                      }}
                      title={
                        isConfirmingFolder
                          ? "Click again to confirm"
                          : "Delete all sessions in folder"
                      }
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                      >
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
                      const isCurrentSession = session.id === currentSessionId;
                      return (
                        <div
                          key={session.id}
                          className="group flex items-start rounded-md transition-colors mb-0.5"
                          style={
                            isCurrentSession
                              ? { background: "var(--color-bg-active)" }
                              : undefined
                          }
                          onMouseEnter={(e) => {
                            if (!isCurrentSession)
                              e.currentTarget.style.background =
                                "var(--color-bg-hover)";
                          }}
                          onMouseLeave={(e) => {
                            if (!isCurrentSession)
                              e.currentTarget.style.background = "";
                          }}
                        >
                          {renamingSession === session.file ? (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                handleRename(session.file);
                              }}
                              className="flex-1 min-w-0 px-2 py-1"
                            >
                              <input
                                autoFocus
                                value={renameValue}
                                onChange={(e) => setRenameValue(e.target.value)}
                                onBlur={() => handleRename(session.file)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape")
                                    setRenamingSession(null);
                                }}
                                className="w-full text-xs px-1.5 py-0.5 rounded"
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
                              onClick={() =>
                                handleSwitch(session.file, group.path)
                              }
                              className="flex-1 min-w-0 text-left px-2 py-1.5 text-xs"
                              style={{ color: "var(--color-text-secondary)" }}
                            >
                              <div className="flex items-baseline gap-2">
                                <span
                                  className="truncate flex-1"
                                  style={{
                                    color: "var(--color-text-primary)",
                                    fontWeight: isCurrentSession ? 600 : 400,
                                  }}
                                >
                                  {session.name ||
                                    session.firstMessage ||
                                    "(empty)"}
                                </span>
                                <span
                                  className="text-xs shrink-0 tabular-nums"
                                  style={{
                                    color: "var(--color-text-tertiary)",
                                  }}
                                >
                                  {formatTime(session.timestamp)}
                                </span>
                              </div>
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(session);
                            }}
                            className="shrink-0 p-1 mt-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                            style={{ color: "var(--color-text-tertiary)" }}
                            onMouseEnter={(e) =>
                              (e.currentTarget.style.color =
                                "var(--color-text-primary)")
                            }
                            onMouseLeave={(e) =>
                              (e.currentTarget.style.color =
                                "var(--color-text-tertiary)")
                            }
                            title="Rename session"
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 16 16"
                              fill="none"
                            >
                              <path
                                d="M11.5 1.5l3 3-9 9H2.5v-3l9-9z"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteSession(session.file);
                            }}
                            className="shrink-0 p-1 mt-1 mr-1 rounded transition-colors opacity-0 group-hover:opacity-100"
                            style={{
                              color: isConfirming
                                ? "var(--color-text-on-accent)"
                                : "var(--color-text-tertiary)",
                              background: isConfirming
                                ? "var(--color-text-error)"
                                : "transparent",
                            }}
                            title={
                              isConfirming
                                ? "Click again to confirm"
                                : "Delete session"
                            }
                          >
                            <svg
                              width="10"
                              height="10"
                              viewBox="0 0 16 16"
                              fill="none"
                            >
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
      <div
        className="shrink-0 px-2 py-2"
        style={{ borderTop: "1px solid var(--color-border)" }}
      >
        <button
          onClick={async () => {
            const dir = await bridge.selectDirectory();
            if (dir) await openWorkspace(dir);
          }}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs transition-colors"
          style={{ color: "var(--color-text-tertiary)" }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--color-bg-hover)")
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
        >
          Open folder...
        </button>
      </div>
    </div>
  );
}
