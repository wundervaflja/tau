import React, { useState, useCallback } from "react";
import type { SoulStatus, SoulProposal, SoulProposalsFile } from "../../shared/soul-types";

interface SoulPanelProps {
  status: SoulStatus | null;
  content: string;
  proposals: SoulProposalsFile | null;
  onWrite: (content: string) => void;
  onClearProposals: () => void;
  onRefresh: () => void;
}

export function SoulPanel({ status, content, proposals, onWrite, onClearProposals, onRefresh }: SoulPanelProps) {
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");

  const startEditing = useCallback(() => {
    setEditContent(content);
    setEditing(true);
  }, [content]);

  const saveEdit = useCallback(() => {
    onWrite(editContent);
    setEditing(false);
  }, [editContent, onWrite]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setEditContent("");
  }, []);

  const statusText = status?.needsBootstrap
    ? "Needs Bootstrap"
    : status?.exists
      ? "Active"
      : "Not Created";

  const statusColor = status?.needsBootstrap
    ? "text-amber-400"
    : status?.exists
      ? "text-green-400"
      : "text-gray-400";

  const pendingCount = proposals?.proposals?.length ?? 0;

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">SOUL</span>
        <span className={`text-xs ${statusColor}`}>{statusText}</span>
        {pendingCount > 0 && (
          <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
            {pendingCount} proposal{pendingCount > 1 ? "s" : ""}
          </span>
        )}
        <div className="flex-1" />
        {!editing && (
          <button
            onClick={startEditing}
            className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:opacity-90"
          >
            Edit
          </button>
        )}
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:opacity-90"
        >
          Refresh
        </button>
      </div>

      {/* Proposals section */}
      {pendingCount > 0 && proposals && (
        <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-amber-500/5">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-amber-300">Pending Proposals</span>
            <button
              onClick={onClearProposals}
              className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-300 hover:opacity-90"
            >
              Dismiss All
            </button>
          </div>
          {proposals.proposals.map((p: SoulProposal) => (
            <div key={p.id} className="mb-1 text-xs">
              <div className="flex items-center gap-1">
                <span className={`px-1 py-0 rounded ${
                  p.action === "add" ? "bg-green-500/20 text-green-300" :
                  p.action === "update" ? "bg-blue-500/20 text-blue-300" :
                  "bg-red-500/20 text-red-300"
                }`}>
                  {p.action}
                </span>
                <span className="text-[var(--text-muted)]">{p.section}</span>
              </div>
              <div className="text-[var(--text-secondary)] mt-0.5">{p.proposedEntry}</div>
              {p.evidence && (
                <div className="text-[var(--text-muted)] italic mt-0.5">Evidence: {p.evidence}</div>
              )}
            </div>
          ))}
          {proposals.reinforcements && proposals.reinforcements.length > 0 && (
            <div className="text-[10px] text-[var(--text-muted)] mt-1">
              Reinforced: {proposals.reinforcements.join(", ")}
            </div>
          )}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {editing ? (
          <div className="flex flex-col h-full gap-2">
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              className="flex-1 w-full px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] font-mono resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={saveEdit}
                className="text-xs px-3 py-1 rounded bg-[var(--accent-primary)] text-white hover:opacity-90"
              >
                Save
              </button>
              <button
                onClick={cancelEdit}
                className="text-xs px-3 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:opacity-90"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : content ? (
          <div className="text-sm text-[var(--text-secondary)] whitespace-pre-wrap font-mono leading-relaxed">
            {content}
          </div>
        ) : (
          <div className="text-sm text-[var(--text-muted)] text-center py-4">
            {status?.needsBootstrap
              ? "SOUL.md needs bootstrapping. Start a conversation and the agent will interview you to set up your personality profile."
              : "No SOUL.md content yet."}
          </div>
        )}
      </div>

      {/* Footer info */}
      {status && (
        <div className="px-3 py-1 border-t border-[var(--border-primary)] text-[10px] text-[var(--text-muted)]">
          {status.sections.length} section{status.sections.length !== 1 ? "s" : ""}
          {status.lastModified > 0 && ` · Modified ${new Date(status.lastModified).toLocaleDateString()}`}
        </div>
      )}
    </div>
  );
}
