import React, { useState, useCallback } from "react";
import type { GitStatusResult, GitBranchInfo, GitFileStatus } from "../../shared/types";

interface GitSidebarProps {
  status: GitStatusResult;
  branches: GitBranchInfo;
  loading: boolean;
  onCheckout: (target: string, isFile?: boolean) => Promise<void>;
  onCheckoutNew: (name: string) => Promise<void>;
  onStage: (file: string) => Promise<void>;
  onUnstage: (file: string) => Promise<void>;
  onStageAll: () => Promise<void>;
  onDiscard: (file: string) => Promise<void>;
  onGetDiff: (file: string, staged: boolean) => Promise<string>;
  onRefresh: () => void;
  onToggle: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  U: "Unmerged",
  "?": "Untracked",
};

const STATUS_COLORS: Record<string, string> = {
  M: "var(--color-text-warning)",
  A: "var(--color-text-success)",
  D: "var(--color-text-error)",
  R: "var(--color-text-accent)",
  C: "var(--color-text-accent)",
  U: "var(--color-text-error)",
  "?": "var(--color-text-tertiary)",
};

export function GitSidebar({
  status,
  branches,
  loading,
  onCheckout,
  onCheckoutNew,
  onStage,
  onUnstage,
  onStageAll,
  onDiscard,
  onGetDiff,
  onRefresh,
  onToggle,
}: GitSidebarProps) {
  const [showBranches, setShowBranches] = useState(false);
  const [newBranchName, setNewBranchName] = useState("");
  const [showNewBranch, setShowNewBranch] = useState(false);
  const [expandedDiff, setExpandedDiff] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>("");
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);

  const stagedFiles = status.files.filter((f) => f.staged);
  const unstagedFiles = status.files.filter((f) => !f.staged);

  const handleToggleDiff = useCallback(
    async (file: string, staged: boolean) => {
      const key = `${staged ? "s" : "u"}:${file}`;
      if (expandedDiff === key) {
        setExpandedDiff(null);
        setDiffContent("");
        return;
      }
      try {
        const diff = await onGetDiff(file, staged);
        setDiffContent(diff || "(no diff available)");
        setExpandedDiff(key);
      } catch {
        setDiffContent("(error loading diff)");
        setExpandedDiff(key);
      }
    },
    [expandedDiff, onGetDiff]
  );

  const handleCreateBranch = useCallback(async () => {
    if (!newBranchName.trim()) return;
    await onCheckoutNew(newBranchName.trim());
    setNewBranchName("");
    setShowNewBranch(false);
    setShowBranches(false);
  }, [newBranchName, onCheckoutNew]);

  const handleDiscard = useCallback(
    async (file: string) => {
      if (confirmDiscard === file) {
        await onDiscard(file);
        setConfirmDiscard(null);
      } else {
        setConfirmDiscard(file);
        setTimeout(() => setConfirmDiscard(null), 3000);
      }
    },
    [confirmDiscard, onDiscard]
  );

  if (!status.isRepo) {
    return (
      <div
        className="flex flex-col h-full animate-slide-in-right"
        style={{
          width: "var(--sidebar-width)",
          minWidth: "var(--sidebar-width)",
          background: "var(--color-bg-sidebar)",
          borderLeft: "1px solid var(--color-border)",
        }}
      >
        <div
          className="titlebar-drag flex items-end px-4 pb-3"
          style={{ paddingTop: "var(--titlebar-height)" }}
        >
          <div className="titlebar-no-drag flex items-center justify-between w-full">
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Git
            </span>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: "var(--color-text-tertiary)" }}
              title="Hide git panel"
            >
              <CloseIcon />
            </button>
          </div>
        </div>
        <div
          className="flex-1 flex items-center justify-center px-4 text-center"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          <div>
            <GitIcon size={32} />
            <p className="text-sm mt-3">Not a git repository</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full animate-slide-in-right"
      style={{
        width: 280,
        minWidth: 280,
        background: "var(--color-bg-sidebar)",
        borderLeft: "1px solid var(--color-border)",
      }}
    >
      {/* Header */}
      <div
        className="titlebar-drag flex items-end px-4 pb-3"
        style={{ paddingTop: "var(--titlebar-height)" }}
      >
        <div className="titlebar-no-drag flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <GitIcon size={14} />
            <span
              className="text-sm font-medium"
              style={{ color: "var(--color-text-primary)" }}
            >
              Git
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: "var(--color-text-tertiary)" }}
              title="Refresh"
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--color-bg-hover)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            >
              <RefreshIcon />
            </button>
            <button
              onClick={onToggle}
              className="p-1.5 rounded-md transition-colors"
              style={{ color: "var(--color-text-tertiary)" }}
              title="Hide git panel"
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = "var(--color-bg-hover)")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            >
              <CloseIcon />
            </button>
          </div>
        </div>
      </div>

      {/* Branch selector */}
      <div className="px-3 pb-2">
        <button
          onClick={() => setShowBranches(!showBranches)}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border)",
            color: "var(--color-text-primary)",
          }}
        >
          <BranchIcon />
          <span className="truncate flex-1 text-left font-medium">
            {status.branch || "detached"}
          </span>
          {(status.ahead > 0 || status.behind > 0) && (
            <span
              className="text-xs"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {status.ahead > 0 && `↑${status.ahead}`}
              {status.behind > 0 && `↓${status.behind}`}
            </span>
          )}
          <ChevronIcon open={showBranches} />
        </button>

        {/* Branch dropdown */}
        {showBranches && (
          <div
            className="mt-1 rounded-lg overflow-hidden overflow-y-auto"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              maxHeight: 200,
            }}
          >
            {branches.branches
              .filter((b) => b !== branches.current)
              .map((branch) => (
                <button
                  key={branch}
                  onClick={async () => {
                    await onCheckout(branch);
                    setShowBranches(false);
                  }}
                  className="w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2"
                  style={{ color: "var(--color-text-secondary)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "var(--color-bg-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "")
                  }
                >
                  <BranchIcon />
                  <span className="truncate">{branch}</span>
                </button>
              ))}

            {/* New branch */}
            {showNewBranch ? (
              <div className="px-3 py-2 flex items-center gap-1">
                <input
                  autoFocus
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreateBranch();
                    if (e.key === "Escape") {
                      setShowNewBranch(false);
                      setNewBranchName("");
                    }
                  }}
                  placeholder="branch name"
                  className="flex-1 bg-transparent text-sm outline-none px-1 py-1"
                  style={{
                    color: "var(--color-text-primary)",
                    borderBottom: "1px solid var(--color-border-focus)",
                  }}
                />
              </div>
            ) : (
              <button
                onClick={() => setShowNewBranch(true)}
                className="w-full text-left px-3 py-2 text-sm transition-colors flex items-center gap-2"
                style={{ color: "var(--color-text-accent)" }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = "var(--color-bg-hover)")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "")
                }
              >
                <PlusIcon />
                <span>New branch</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* File changes */}
      <div className="flex-1 overflow-y-auto px-2">
        {status.files.length === 0 ? (
          <div
            className="px-3 py-8 text-center text-sm"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            <CheckIcon />
            <p className="mt-2">Working tree clean</p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="px-2 py-1 flex items-center justify-between">
              <span
                className="text-xs font-medium uppercase tracking-wider"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Changes ({status.files.length})
              </span>
              {unstagedFiles.length > 0 && (
                <button
                  onClick={onStageAll}
                  className="text-xs px-2 py-0.5 rounded transition-colors"
                  style={{ color: "var(--color-text-accent)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background =
                      "var(--color-bg-hover)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "")
                  }
                  title="Stage all"
                >
                  Stage all
                </button>
              )}
            </div>

            {/* Staged */}
            {stagedFiles.length > 0 && (
              <>
                <div className="px-2 py-1.5 mt-1">
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-success)" }}
                  >
                    Staged ({stagedFiles.length})
                  </span>
                </div>
                {stagedFiles.map((f) => (
                  <FileRow
                    key={`s-${f.file}`}
                    file={f}
                    expandedDiff={expandedDiff}
                    diffContent={diffContent}
                    onToggleDiff={() => handleToggleDiff(f.file, true)}
                    onAction={() => onUnstage(f.file)}
                    actionLabel="Unstage"
                    confirmDiscard={confirmDiscard}
                    onDiscard={handleDiscard}
                  />
                ))}
              </>
            )}

            {/* Unstaged */}
            {unstagedFiles.length > 0 && (
              <>
                <div className="px-2 py-1.5 mt-1">
                  <span
                    className="text-xs font-medium"
                    style={{ color: "var(--color-text-warning)" }}
                  >
                    Unstaged ({unstagedFiles.length})
                  </span>
                </div>
                {unstagedFiles.map((f) => (
                  <FileRow
                    key={`u-${f.file}`}
                    file={f}
                    expandedDiff={expandedDiff}
                    diffContent={diffContent}
                    onToggleDiff={() => handleToggleDiff(f.file, false)}
                    onAction={() => onStage(f.file)}
                    actionLabel="Stage"
                    confirmDiscard={confirmDiscard}
                    onDiscard={handleDiscard}
                  />
                ))}
              </>
            )}
          </>
        )}
      </div>

      {/* Loading indicator */}
      {loading && (
        <div
          className="px-4 py-2 text-xs text-center"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Working…
        </div>
      )}
    </div>
  );
}

// --- File row component ---
function FileRow({
  file,
  expandedDiff,
  diffContent,
  onToggleDiff,
  onAction,
  actionLabel,
  confirmDiscard,
  onDiscard,
}: {
  file: GitFileStatus;
  expandedDiff: string | null;
  diffContent: string;
  onToggleDiff: () => void;
  onAction: () => void;
  actionLabel: string;
  confirmDiscard: string | null;
  onDiscard: (file: string) => void;
}) {
  const diffKey = `${file.staged ? "s" : "u"}:${file.file}`;
  const isExpanded = expandedDiff === diffKey;
  const fileName = file.file.split("/").pop() || file.file;
  const dirPath = file.file.includes("/")
    ? file.file.slice(0, file.file.lastIndexOf("/"))
    : "";

  return (
    <div className="mb-0.5">
      <div
        className="group flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors cursor-pointer"
        onClick={onToggleDiff}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--color-bg-hover)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
      >
        {/* Status badge */}
        <span
          className="text-xs font-mono font-bold shrink-0 w-4 text-center"
          style={{ color: STATUS_COLORS[file.status] || "var(--color-text-tertiary)" }}
          title={STATUS_LABELS[file.status] || file.status}
        >
          {file.status}
        </span>

        {/* File name */}
        <div className="flex-1 min-w-0">
          <span
            className="text-sm truncate block"
            style={{ color: "var(--color-text-primary)" }}
          >
            {fileName}
          </span>
          {dirPath && (
            <span
              className="text-xs truncate block"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              {dirPath}
            </span>
          )}
        </div>

        {/* Actions (visible on hover) */}
        <div
          className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={onAction}
            className="text-xs px-1.5 py-0.5 rounded transition-colors"
            style={{ color: "var(--color-text-accent)" }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.background = "var(--color-bg-active)")
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
            title={actionLabel}
          >
            {actionLabel === "Stage" ? "+" : "−"}
          </button>
          {!file.staged && file.status !== "?" && (
            <button
              onClick={() => onDiscard(file.file)}
              className="text-xs px-1.5 py-0.5 rounded transition-colors"
              style={{
                color:
                  confirmDiscard === file.file
                    ? "var(--color-text-on-accent)"
                    : "var(--color-text-error)",
                background:
                  confirmDiscard === file.file
                    ? "var(--color-text-error)"
                    : "transparent",
              }}
              onMouseEnter={(e) => {
                if (confirmDiscard !== file.file)
                  e.currentTarget.style.background = "var(--color-bg-active)";
              }}
              onMouseLeave={(e) => {
                if (confirmDiscard !== file.file)
                  e.currentTarget.style.background = "";
              }}
              title={
                confirmDiscard === file.file
                  ? "Click again to confirm"
                  : "Discard changes"
              }
            >
              {confirmDiscard === file.file ? "Confirm?" : "✕"}
            </button>
          )}
        </div>
      </div>

      {/* Inline diff */}
      {isExpanded && (
        <div
          className="mx-2 mb-1 rounded-md overflow-x-auto"
          style={{
            background: "var(--color-bg-code)",
            border: "1px solid var(--color-border)",
            maxHeight: 200,
          }}
        >
          <pre
            className="text-xs p-2 select-text"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-secondary)",
              whiteSpace: "pre",
              userSelect: "text",
            }}
          >
            {diffContent.split("\n").map((line, i) => {
              let color = "var(--color-text-secondary)";
              if (line.startsWith("+") && !line.startsWith("+++"))
                color = "var(--color-text-success)";
              else if (line.startsWith("-") && !line.startsWith("---"))
                color = "var(--color-text-error)";
              else if (line.startsWith("@@"))
                color = "var(--color-text-accent)";
              return (
                <span key={i} style={{ color }}>
                  {line}
                  {"\n"}
                </span>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

// --- Icons ---
function GitIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      style={{ color: "var(--color-text-warning)" }}
    >
      <path
        d="M15.698 7.287L8.712.302a1.03 1.03 0 00-1.457 0l-1.45 1.45 1.84 1.84a1.223 1.223 0 011.55 1.56l1.773 1.774a1.224 1.224 0 11-.733.686L8.535 5.91v4.27a1.225 1.225 0 11-1.008-.036V5.822a1.224 1.224 0 01-.664-1.606L5.05 2.404.302 7.152a1.03 1.03 0 000 1.457l6.986 6.986a1.03 1.03 0 001.457 0l6.953-6.953a1.031 1.031 0 000-1.455z"
        fill="currentColor"
      />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path
        d="M5 3a2 2 0 10-4 0 2 2 0 004 0zm0 0v6a2 2 0 104 0V5m0 0a2 2 0 104 0 2 2 0 00-4 0zm0 0v4a2 2 0 11-4 0"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
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
  );
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 8a6 6 0 0110.89-3.48M14 2v4h-4M14 8a6 6 0 01-10.89 3.48M2 14v-4h4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M4 4l8 8M12 4l-8 8"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
      <path
        d="M8 3v10M3 8h10"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 16 16"
      fill="none"
      style={{ margin: "0 auto", color: "var(--color-text-success)" }}
    >
      <path
        d="M3 8l3.5 3.5L13 5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
