import React, { useCallback, useRef, useEffect } from "react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS: { key: string; label: string }[] = [
  { key: "⌘K", label: "Session switcher" },
  { key: "⌘⇧P", label: "Command palette" },
  { key: "⌘N", label: "New chat" },
  { key: "⌘B", label: "Toggle sidebar" },
  { key: "⌘J", label: "Toggle terminal" },
  { key: "⌘\\", label: "Toggle right panel" },
  { key: "⌘,", label: "Settings" },
  { key: "⌘⇧T", label: "Toggle tasks view" },
  { key: "⌘⇧K", label: "Toggle knowledge view" },
  { key: "⌘⇧C", label: "Toggle canvas view" },
  { key: "⌘⇧J", label: "Toggle journal view" },
  { key: "⌘⇧M", label: "Memory panel" },
  { key: "⌘⇧S", label: "Skills panel" },
  { key: "⌘⇧G", label: "Git panel" },
  { key: "⌘⇧D", label: "Toggle dark/light theme" },
  { key: "⌘?", label: "Show shortcuts" },
  { key: "Esc", label: "Close modal / panel" },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

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

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

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
          width: 420,
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 shrink-0"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <h2 className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Keyboard Shortcuts
          </h2>
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

        {/* Shortcuts list */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          <div className="space-y-1">
            {SHORTCUTS.map((s) => (
              <div
                key={s.key}
                className="flex items-center justify-between py-1.5"
              >
                <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                  {s.label}
                </span>
                <kbd
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono"
                  style={{
                    background: "var(--color-bg-hover)",
                    border: "1px solid var(--color-border)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {s.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
