import React, { useCallback, useRef, useEffect } from "react";
import type { Task, TaskStatus } from "../../shared/task-types";

const STATUS_LABELS: Record<TaskStatus, string> = {
  'inbox': 'Inbox',
  'todo': 'Todo',
  'refinement': 'Refinement',
  'in-progress': 'In Progress',
  'done': 'Done',
};

const STATUS_COLORS: Record<TaskStatus, string> = {
  inbox: "var(--color-text-tertiary)",
  todo: "var(--color-text-warning)",
  refinement: "var(--color-text-muted, #a855f7)",
  "in-progress": "var(--color-text-accent)",
  done: "var(--color-text-success, #4ade80)",
};

interface TaskDetailsModalProps {
  isOpen: boolean;
  task: Task | null;
  onClose: () => void;
}

export function TaskDetailsModal({ isOpen, task, onClose }: TaskDetailsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  // Close on click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen || !task) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: "rgba(0, 0, 0, 0.5)", backdropFilter: "blur(2px)" }}
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        className="rounded-xl overflow-hidden animate-fade-in flex flex-col"
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border-heavy)",
          boxShadow: "var(--shadow-xl)",
          width: 600,
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Task Details
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md transition-colors"
            style={{ color: "var(--color-text-tertiary)" }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "")}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            {/* Status Badge */}
            <div className="flex items-center gap-2">
              <span
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium"
                style={{
                  background: "var(--color-bg-hover)",
                  color: STATUS_COLORS[task.status],
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{ background: STATUS_COLORS[task.status] }}
                />
                {STATUS_LABELS[task.status]}
              </span>
            </div>

            {/* Task Text */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                Task
              </label>
              <div
                className="px-3 py-2 rounded-md"
                style={{
                  background: "var(--color-bg-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-primary)",
                }}
              >
                {task.text}
              </div>
            </div>

            {/* Task ID */}
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                Task ID
              </label>
              <div
                className="px-3 py-2 rounded-md font-mono text-xs"
                style={{
                  background: "var(--color-bg-surface)",
                  border: "1px solid var(--color-border)",
                  color: "var(--color-text-tertiary)",
                }}
              >
                {task.id}
              </div>
            </div>

            {/* Subagent Info */}
            {task.subagentId && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                  Subagent
                </label>
                <div
                  className="px-3 py-2 rounded-md flex items-center gap-2"
                  style={{
                    background: "var(--color-bg-surface)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{
                      background: "var(--color-text-accent)",
                      animation: "pulse-dot 1.5s ease-in-out infinite",
                    }}
                  />
                  <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                    {task.subagentId}
                  </span>
                </div>
              </div>
            )}

            {/* Result */}
            {task.result && (
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
                  Result
                </label>
                <div
                  className="px-3 py-2 rounded-md whitespace-pre-wrap text-sm"
                  style={{
                    background: "var(--color-bg-surface)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-secondary)",
                    maxHeight: 300,
                    overflowY: "auto",
                  }}
                >
                  {task.result}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
