import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import { useAgentContext } from "../contexts/AgentContext";
import type { Task, TaskStatus } from "../../shared/task-types";
import { TaskDetailsModal } from "./TaskDetailsModal";

const SECTIONS: { status: TaskStatus; label: string }[] = [
  { status: "inbox", label: "Inbox" },
  { status: "todo", label: "Todo" },
  { status: "refinement", label: "Refinement" },
  { status: "in-progress", label: "In Progress" },
  { status: "done", label: "Done" },
];

const STATUS_COLORS: Record<TaskStatus, string> = {
  inbox: "var(--color-text-tertiary)",
  todo: "var(--color-text-warning)",
  refinement: "var(--color-text-muted, #a855f7)",
  "in-progress": "var(--color-text-accent)",
  done: "var(--color-text-success, #4ade80)",
};

interface TaskModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function TaskModal({ isOpen, onClose }: TaskModalProps) {
  const { status } = useAgentContext();
  const cwd = status.cwd;

  const [tasks, setTasks] = useState<Task[]>([]);
  const [collapsed, setCollapsed] = useState<Set<TaskStatus>>(new Set(["done"]));
  const [newText, setNewText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isDetailsModalOpen, setIsDetailsModalOpen] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Auto-dismiss save error after 5 seconds
  useEffect(() => {
    if (!saveError) return;
    const t = setTimeout(() => setSaveError(null), 5000);
    return () => clearTimeout(t);
  }, [saveError]);

  // Load tasks when modal opens and cwd changes
  useEffect(() => {
    if (!isOpen || !cwd) return;
    bridge
      .tasksLoad()
      .then(setTasks)
      .catch((err) => {
        console.warn("[TaskModal] Failed to load tasks:", err);
        setTasks([]);
      });
  }, [isOpen, cwd]);

  // Listen for server-pushed task updates (auto-spawn, auto-complete)
  useEffect(() => {
    const unsub = bridge.onTasksChanged((updated: Task[]) => {
      setSaveError(null);
      setTasks(updated);
    });
    return unsub;
  }, []);

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

  // Focus add input when modal opens
  useEffect(() => {
    if (isOpen && addRef.current) {
      setTimeout(() => addRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Save tasks whenever they change
  const save = useCallback(
    (updated: Task[]) => {
      setTasks(updated);
      if (cwd) {
        bridge.tasksSave(updated).catch((err) => {
          console.error("[TaskModal] Failed to save tasks:", err);
          setSaveError("Failed to save tasks — daemon may be offline");
        });
      }
    },
    [cwd]
  );

  // Add task
  const addTask = useCallback(() => {
    const text = newText.trim();
    if (!text) return;
    const task: Task = {
      id: crypto.randomUUID(),
      text,
      status: "inbox",
      done: false,
    };
    save([task, ...tasks]);
    setNewText("");
  }, [newText, tasks, save]);

  // Delete task
  const deleteTask = useCallback(
    (id: string) => {
      save(tasks.filter((t) => t.id !== id));
    },
    [tasks, save]
  );

  // Toggle done
  const toggleDone = useCallback(
    (id: string) => {
      save(
        tasks.map((t) => {
          if (t.id !== id) return t;
          if (t.done) return { ...t, status: "inbox" as TaskStatus, done: false };
          return { ...t, status: "done" as TaskStatus, done: true };
        })
      );
    },
    [tasks, save]
  );

  // Drag and drop
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TaskStatus | null>(null);

  const moveTask = useCallback(
    (id: string, toStatus: TaskStatus) => {
      save(
        tasks.map((t) => {
          if (t.id !== id) return t;
          return { ...t, status: toStatus, done: toStatus === "done" };
        })
      );
    },
    [tasks, save]
  );

  // Start editing
  const startEdit = useCallback((task: Task) => {
    setEditingId(task.id);
    setEditText(task.text);
    setTimeout(() => editRef.current?.focus(), 0);
  }, []);

  // Open task details
  const openTaskDetails = useCallback((task: Task) => {
    setSelectedTask(task);
    setIsDetailsModalOpen(true);
  }, []);

  // Commit edit
  const commitEdit = useCallback(() => {
    if (!editingId) return;
    const text = editText.trim();
    if (text) {
      save(tasks.map((t) => (t.id === editingId ? { ...t, text } : t)));
    }
    setEditingId(null);
    setEditText("");
  }, [editingId, editText, tasks, save]);

  // Toggle section collapse
  const toggleSection = useCallback((status: TaskStatus) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  if (!isOpen) return null;

  if (!cwd) {
    return (
      <div
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ background: "rgba(0, 0, 0, 0.5)", backdropFilter: "blur(2px)" }}
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          className="rounded-xl overflow-hidden animate-fade-in"
          style={{
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-heavy)",
            boxShadow: "var(--shadow-xl)",
            width: 600,
            height: 400,
          }}
        >
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <div>
              <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
                Tasks
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

          {/* No folder message */}
          <div className="flex items-center justify-center h-full">
            <div className="text-center px-6">
              <div className="text-sm mb-2" style={{ color: "var(--color-text-secondary)" }}>
                No folder open
              </div>
              <div className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                Open a folder to use tasks
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
          width: 800,
          height: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div>
            <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Tasks
            </h2>
            <p className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)" }}>
              Manage your tasks
            </p>
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

        {/* Error banner */}
        {saveError && (
          <div
            className="flex items-center gap-2 px-4 py-2 text-xs shrink-0"
            style={{
              background: "var(--color-bg-error, #fef2f2)",
              color: "var(--color-text-error, #ef4444)",
              borderBottom: "1px solid var(--color-border-error, #fca5a5)",
            }}
          >
            <span className="flex-1">{saveError}</span>
            <button
              onClick={() => setSaveError(null)}
              className="shrink-0 opacity-60 hover:opacity-100"
            >
              &times;
            </button>
          </div>
        )}

        {/* Task content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="max-w-2xl mx-auto">
            {SECTIONS.map(({ status: sectionStatus, label }) => {
              const group = tasks.filter((t) => t.status === sectionStatus);
              const isCollapsed = collapsed.has(sectionStatus);

              const isDropHere = dropTarget === sectionStatus && draggingId !== null;

              return (
                <div
                  key={sectionStatus}
                  className="mb-4 rounded-md transition-colors"
                  style={{
                    outline: isDropHere ? "2px dashed var(--color-border-heavy)" : "none",
                    outlineOffset: -2,
                    background: isDropHere ? "var(--color-bg-hover)" : "transparent",
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropTarget(sectionStatus);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      setDropTarget(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const id = e.dataTransfer.getData("text/plain");
                    if (id) moveTask(id, sectionStatus);
                    setDropTarget(null);
                    setDraggingId(null);
                  }}
                >
                  {/* Section header */}
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleSection(sectionStatus)}
                      className="flex items-center gap-2 flex-1 py-1.5 text-xs font-semibold transition-colors"
                      style={{ color: "var(--color-text-secondary)" }}
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                        className="shrink-0"
                        style={{
                          transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)",
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
                      <span>{label}</span>
                      <span
                        className="text-xs tabular-nums"
                        style={{ color: "var(--color-text-tertiary)" }}
                      >
                        {group.length}
                      </span>
                    </button>
                  </div>

                  {/* Task items */}
                  {!isCollapsed && (
                    <div className="ml-1">
                      {/* Always-visible add input in Inbox */}
                      {sectionStatus === "inbox" && (
                        <div className="flex items-center gap-2 py-1.5 pl-1 pr-1 mb-1">
                          <div
                            className="shrink-0 flex items-center justify-center w-5 h-5 rounded-full"
                            style={{ border: `2px solid ${STATUS_COLORS.inbox}` }}
                          >
                            <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                              <path
                                d="M8 4v8M4 8h8"
                                stroke={STATUS_COLORS.inbox}
                                strokeWidth="1.5"
                                strokeLinecap="round"
                              />
                            </svg>
                          </div>
                          <input
                            ref={addRef}
                            type="text"
                            value={newText}
                            onChange={(e) => setNewText(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") addTask();
                              if (e.key === "Escape") {
                                setNewText("");
                                addRef.current?.blur();
                              }
                            }}
                            placeholder="Add a task…"
                            className="flex-1 px-2 py-1 rounded text-sm outline-none transition-colors"
                            style={{
                              background: "var(--color-bg-hover)",
                              color: "var(--color-text-primary)",
                              border: "1px solid transparent",
                            }}
                            onFocus={(e) =>
                              (e.currentTarget.style.borderColor = "var(--color-border-heavy)")
                            }
                            onBlur={(e) =>
                              (e.currentTarget.style.borderColor = "transparent")
                            }
                          />
                        </div>
                      )}
                      {group.length === 0 ? (
                        <div
                          className="py-2 pl-5 text-xs"
                          style={{ color: "var(--color-text-tertiary)" }}
                        >
                          No tasks
                        </div>
                      ) : (
                        group.map((task) => (
                          <React.Fragment key={task.id}>
                            <div
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData("text/plain", task.id);
                                e.dataTransfer.effectAllowed = "move";
                                setDraggingId(task.id);
                              }}
                              onDragEnd={() => {
                                setDraggingId(null);
                                setDropTarget(null);
                              }}
                              className="group flex items-center gap-2 py-1.5 pl-1 pr-1 rounded-md transition-colors"
                              style={{
                                opacity: draggingId === task.id ? 0.4 : 1,
                                cursor: "grab",
                              }}
                              onMouseEnter={(e) => {
                                if (!draggingId) e.currentTarget.style.background = "var(--color-bg-hover)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "";
                              }}
                            >
                              {/* Checkbox — click to toggle done */}
                              <button
                                onClick={() => toggleDone(task.id)}
                                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-colors"
                                style={{
                                  border: `2px solid ${STATUS_COLORS[task.status]}`,
                                  background: task.done ? STATUS_COLORS[task.status] : "transparent",
                                }}
                                title={task.done ? "Mark not done" : "Mark done"}
                              >
                                {task.done && (
                                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                                    <path
                                      d="M4 8l3 3 5-6"
                                      stroke="var(--color-bg-surface)"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    />
                                  </svg>
                                )}
                              </button>

                              {/* Task text */}
                              {editingId === task.id ? (
                                <input
                                  ref={editRef}
                                  type="text"
                                  value={editText}
                                  onChange={(e) => setEditText(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") commitEdit();
                                    if (e.key === "Escape") {
                                      setEditingId(null);
                                      setEditText("");
                                    }
                                  }}
                                  onBlur={commitEdit}
                                  className="flex-1 px-1.5 py-0.5 rounded text-sm outline-none"
                                  style={{
                                    background: "var(--color-bg-hover)",
                                    color: "var(--color-text-primary)",
                                    border: "1px solid var(--color-border-heavy)",
                                  }}
                                />
                              ) : (
                                <span
                                  onClick={() => openTaskDetails(task)}
                                  onDoubleClick={() => startEdit(task)}
                                  className="flex-1 text-sm cursor-pointer hover:underline truncate flex items-center gap-1.5"
                                  style={{
                                    color: task.done
                                      ? "var(--color-text-tertiary)"
                                      : "var(--color-text-primary)",
                                    textDecoration: task.done ? "line-through" : "none",
                                  }}
                                  title="Click to view details, double-click to edit"
                                >
                                  {task.text}
                                  {task.subagentId && task.status === "in-progress" && (
                                    <span
                                      className="inline-block w-2 h-2 rounded-full shrink-0"
                                      style={{
                                        background: "var(--color-text-accent)",
                                        animation: "pulse-dot 1.5s ease-in-out infinite",
                                      }}
                                      title="Subagent working on this task"
                                    />
                                  )}
                                </span>
                              )}

                              {/* Delete button */}
                              <button
                                onClick={() => deleteTask(task.id)}
                                className="shrink-0 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ color: "var(--color-text-tertiary)" }}
                                onMouseEnter={(e) =>
                                  (e.currentTarget.style.color = "var(--color-text-error)")
                                }
                                onMouseLeave={(e) =>
                                  (e.currentTarget.style.color = "var(--color-text-tertiary)")
                                }
                                title="Delete task"
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
                            </div>
                            {/* Subagent result */}
                            {task.result && (
                              <div
                                className="ml-8 mb-1 px-2 py-1.5 rounded text-xs whitespace-pre-wrap"
                                style={{
                                  color: "var(--color-text-secondary)",
                                  background: "var(--color-bg-hover)",
                                  borderLeft: "2px solid var(--color-border-heavy)",
                                  maxHeight: 120,
                                  overflowY: "auto",
                                }}
                              >
                                {task.result}
                              </div>
                            )}
                          </React.Fragment>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Task Details Modal */}
      <TaskDetailsModal
        isOpen={isDetailsModalOpen}
        task={selectedTask}
        onClose={() => {
          setIsDetailsModalOpen(false);
          setSelectedTask(null);
        }}
      />
    </div>
  );
}
