import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { bridge } from "../bridge";

// ── Types ────────────────────────────────────────────────────────────

interface JournalListItem {
  name: string;
  path: string;
  modified: number;
  created: number;
  preview: string;
}

interface Block {
  id: string;
  text: string;
  /** Set after subagent processes this block */
  processed?: boolean;
}

let blockIdCounter = 0;
function newBlockId() {
  return `blk-${++blockIdCounter}-${Date.now()}`;
}

// ── Helpers ──────────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function contentToBlocks(content: string): Block[] {
  const lines = content.split("\n");
  if (lines.length === 0) return [{ id: newBlockId(), text: "" }];
  return lines.map((text) => ({ id: newBlockId(), text }));
}

function blocksToContent(blocks: Block[]): string {
  return blocks.map((b) => b.text).join("\n");
}

/** Detect special tags in text */
function detectTags(text: string): { hasTask: boolean; hasReminder: boolean; links: string[] } {
  const hasTask = /#task\b/i.test(text) || /#todo\b/i.test(text);
  const hasReminder = /#reminder\b/i.test(text);
  const linkRegex = /\[\[([^\]]+)\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    links.push(match[1]);
  }
  return { hasTask, hasReminder, links };
}

// ── Block component ──────────────────────────────────────────────────

function BlockEditor({
  block,
  isActive,
  onActivate,
  onChange,
  onKeyDown,
  onBlur,
  onLinkClick,
}: {
  block: Block;
  isActive: boolean;
  onActivate: () => void;
  onChange: (text: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onBlur: () => void;
  onLinkClick: (title: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const { hasTask, hasReminder, links } = useMemo(() => detectTags(block.text), [block.text]);

  useEffect(() => {
    if (isActive && ref.current) {
      ref.current.focus();
      // Place cursor at end
      const len = ref.current.value.length;
      ref.current.setSelectionRange(len, len);
    }
  }, [isActive]);

  const isHeading = /^#{1,3}\s/.test(block.text);
  const isH1 = /^#\s/.test(block.text);
  const isH2 = /^##\s/.test(block.text);

  // Render mode (non-active): render markdown-like display
  if (!isActive) {
    return (
      <div
        dir="ltr"
        onClick={onActivate}
        className="block-line px-3 py-1 rounded-md cursor-text transition-colors"
        style={{
          minHeight: 28,
          color: "var(--color-text-primary)",
          fontSize: isH1 ? 22 : isH2 ? 18 : isHeading ? 16 : 14,
          fontWeight: isHeading ? 600 : 400,
          lineHeight: 1.7,
          textAlign: "left",
        }}
      >
        {renderInlineMarkdown(block.text, onLinkClick, hasTask, hasReminder)}
        {block.processed && (
          <span
            className="ml-2 inline-block"
            style={{ color: "var(--color-text-success)", fontSize: 11 }}
            title="Processed by agent"
          >
            ✓
          </span>
        )}
      </div>
    );
  }

  // Edit mode
  return (
    <input
      ref={ref}
      type="text"
      dir="ltr"
      value={block.text}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
      className="block-line-edit w-full px-3 py-1 rounded-md outline-none"
      style={{
        minHeight: 28,
        color: "var(--color-text-primary)",
        fontSize: isH1 ? 22 : isH2 ? 18 : isHeading ? 16 : 14,
        fontWeight: isHeading ? 600 : 400,
        lineHeight: 1.7,
        background: "var(--color-bg-hover)",
        border: "none",
        textAlign: "left",
        direction: "ltr",
      }}
    />
  );
}

function renderInlineMarkdown(
  text: string,
  onLinkClick: (title: string) => void,
  hasTask: boolean,
  hasReminder: boolean,
): React.ReactNode {
  if (!text) {
    return <span style={{ color: "var(--color-text-tertiary)", opacity: 0.5 }}>&#8203;</span>;
  }

  // Parse inline elements: [[links]], #task, #reminder, **bold**, *italic*, `code`
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // [[link]]
    const linkMatch = remaining.match(/\[\[([^\]]+)\]\]/);
    // #task / #todo / #reminder
    const tagMatch = remaining.match(/#(task|todo|reminder)\b/i);
    // `code`
    const codeMatch = remaining.match(/`([^`]+)`/);
    // **bold**
    const boldMatch = remaining.match(/\*\*([^*]+)\*\*/);

    // Find earliest match
    const matches = [
      linkMatch ? { type: "link", match: linkMatch } : null,
      tagMatch ? { type: "tag", match: tagMatch } : null,
      codeMatch ? { type: "code", match: codeMatch } : null,
      boldMatch ? { type: "bold", match: boldMatch } : null,
    ]
      .filter(Boolean)
      .sort((a, b) => (a!.match.index ?? 0) - (b!.match.index ?? 0));

    if (matches.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const first = matches[0]!;
    const idx = first.match.index ?? 0;

    // Text before match
    if (idx > 0) {
      parts.push(<span key={key++}>{remaining.slice(0, idx)}</span>);
    }

    if (first.type === "link") {
      const title = first.match[1];
      parts.push(
        <span
          key={key++}
          onClick={(e) => {
            e.stopPropagation();
            onLinkClick(title);
          }}
          className="cursor-pointer"
          style={{
            color: "var(--color-text-accent)",
            textDecoration: "underline",
            textDecorationStyle: "dotted",
          }}
        >
          {title}
        </span>,
      );
    } else if (first.type === "tag") {
      const tag = first.match[0];
      const color =
        tag.toLowerCase().includes("task") || tag.toLowerCase().includes("todo")
          ? "var(--color-text-warning)"
          : "var(--color-bg-accent)";
      parts.push(
        <span
          key={key++}
          className="px-1.5 py-0.5 rounded-md text-xs font-medium"
          style={{ background: `${color}22`, color }}
        >
          {tag}
        </span>,
      );
    } else if (first.type === "code") {
      parts.push(
        <code
          key={key++}
          className="px-1 py-0.5 rounded text-xs"
          style={{
            background: "var(--color-bg-code)",
            color: "var(--color-text-primary)",
            fontFamily: "monospace",
          }}
        >
          {first.match[1]}
        </code>,
      );
    } else if (first.type === "bold") {
      parts.push(
        <strong key={key++} style={{ fontWeight: 600 }}>
          {first.match[1]}
        </strong>,
      );
    }

    remaining = remaining.slice(idx + first.match[0].length);
  }

  return <>{parts}</>;
}

// ── Main JournalView ─────────────────────────────────────────────────

export function JournalView() {
  const [entries, setEntries] = useState<JournalListItem[]>([]);
  const [activeName, setActiveName] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [activeBlockIdx, setActiveBlockIdx] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const saveTimer = useRef<NodeJS.Timeout | null>(null);
  const [navStack, setNavStack] = useState<string[]>([]);

  // Load entry list
  const refreshList = useCallback(async () => {
    try {
      const list = await bridge.journalList();
      setEntries(list ?? []);
    } catch {
      // ignore
    }
  }, []);

  // Load list and auto-open today's entry if it exists
  useEffect(() => {
    refreshList().then(async () => {
      if (activeName) return; // already viewing something
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, "0");
      const d = String(today.getDate()).padStart(2, "0");
      const todayName = `${y}-${m}-${d}`;
      try {
        const entry = await bridge.journalRead(todayName);
        if (entry) {
          setActiveName(todayName);
          setBlocks(contentToBlocks(entry.content));
        }
      } catch {
        // no today file, show empty state
      }
    });
  }, []);

  // Open an entry
  const openEntry = useCallback(async (name: string) => {
    try {
      const entry = await bridge.journalRead(name);
      if (entry) {
        setActiveName(name);
        setBlocks(contentToBlocks(entry.content));
        setActiveBlockIdx(null);
        setDirty(false);
      }
    } catch {
      // ignore
    }
  }, []);

  // Create today's entry
  const createToday = useCallback(async () => {
    try {
      const entry = await bridge.journalCreate();
      await refreshList();
      if (entry) {
        setActiveName(entry.name);
        setBlocks(contentToBlocks(entry.content));
        setActiveBlockIdx(null);
        setDirty(false);
      }
    } catch {
      // ignore
    }
  }, [refreshList]);

  // Create named entry
  const createNamed = useCallback(
    async (name: string) => {
      try {
        const entry = await bridge.journalCreate(name);
        await refreshList();
        if (entry) {
          setActiveName(entry.name);
          setBlocks(contentToBlocks(entry.content));
          setActiveBlockIdx(null);
          setDirty(false);
        }
      } catch {
        // ignore
      }
    },
    [refreshList],
  );

  // Auto-save with debounce — silent save, no list refresh to avoid re-renders
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;
  const activeNameRef = useRef(activeName);
  activeNameRef.current = activeName;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const scheduleAutoSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      if (activeNameRef.current && dirtyRef.current) {
        const content = blocksToContent(blocksRef.current);
        await bridge.journalSave(activeNameRef.current, content);
        setDirty(false);
      }
    }, 1000);
  }, []);

  useEffect(() => {
    if (dirty) scheduleAutoSave();
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [dirty, scheduleAutoSave]);

  // Block operations
  const updateBlock = useCallback(
    (idx: number, text: string) => {
      setBlocks((prev) => {
        const next = [...prev];
        next[idx] = { ...next[idx], text };
        return next;
      });
      setDirty(true);
    },
    [],
  );

  const handleBlockKeyDown = useCallback(
    (idx: number, e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // Insert new block below
        const newBlock: Block = { id: newBlockId(), text: "" };
        setBlocks((prev) => {
          const next = [...prev];
          next.splice(idx + 1, 0, newBlock);
          return next;
        });
        setActiveBlockIdx(idx + 1);
        setDirty(true);
      } else if (e.key === "Backspace" && blocks[idx]?.text === "" && blocks.length > 1) {
        e.preventDefault();
        // Remove empty block
        setBlocks((prev) => prev.filter((_, i) => i !== idx));
        setActiveBlockIdx(Math.max(0, idx - 1));
        setDirty(true);
      } else if (e.key === "ArrowUp" && idx > 0) {
        e.preventDefault();
        setActiveBlockIdx(idx - 1);
      } else if (e.key === "ArrowDown" && idx < blocks.length - 1) {
        e.preventDefault();
        setActiveBlockIdx(idx + 1);
      }
    },
    [blocks],
  );

  // Process block on blur
  const handleBlockBlur = useCallback(
    (idx: number) => {
      setActiveBlockIdx(null);
      const block = blocks[idx];
      if (!block || block.processed) return;
      const { links } = detectTags(block.text);

      // Create [[linked]] pages directly — no subagent needed
      if (links.length > 0) {
        for (const title of links) {
          bridge.journalCreateLink(title).catch((err: unknown) => {
            console.warn("[journal] link creation failed:", err);
          });
        }
      }

      // Send substantial text (>20 chars, not a heading) to the Consigliere subagent
      // It will proactively analyze and act: tasks, reminders, memories, insights
      const isSubstantial = block.text.length > 20 && !/^#{1,3}\s/.test(block.text);
      if (isSubstantial && activeName) {
        bridge.journalProcessBlock(block.text, activeName).then((result: any) => {
          if (result?.ok) {
            setBlocks((prev) => {
              const next = [...prev];
              if (next[idx]) next[idx] = { ...next[idx], processed: true };
              return next;
            });
          }
        }).catch((err: unknown) => { console.warn("[journal] process failed:", err); });
      }
    },
    [blocks, activeName],
  );

  // Handle [[link]] clicks
  const handleLinkClick = useCallback(
    async (title: string) => {
      // Push current entry to nav stack
      if (activeName) {
        setNavStack((prev) => [...prev, activeName]);
      }
      // Create/open the linked page
      const slug = title
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 60);
      try {
        await bridge.journalCreateLink(title);
        await refreshList();
        await openEntry(slug);
      } catch {
        // ignore
      }
    },
    [activeName, refreshList, openEntry],
  );

  // Back navigation
  const goBack = useCallback(() => {
    const prev = navStack[navStack.length - 1];
    if (prev) {
      setNavStack((s) => s.slice(0, -1));
      openEntry(prev);
    }
  }, [navStack, openEntry]);

  // Delete entry
  const handleDelete = useCallback(async () => {
    if (!activeName) return;
    await bridge.journalDelete(activeName);
    setActiveName(null);
    setBlocks([]);
    await refreshList();
  }, [activeName, refreshList]);

  // Filter entries
  const filtered = search.trim()
    ? entries.filter(
        (e) =>
          e.name.toLowerCase().includes(search.toLowerCase()) ||
          e.preview.toLowerCase().includes(search.toLowerCase()),
      )
    : entries;

  // Entry picker dropdown
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div className="flex flex-col h-full" dir="ltr" style={{ textAlign: "left" }}>
      {activeName ? (
        <>
          {/* Toolbar */}
          <div
            className="flex items-center justify-between px-5 py-2 shrink-0"
            style={{ borderBottom: "1px solid var(--color-border)" }}
          >
            <div className="flex items-center gap-2">
              {navStack.length > 0 && (
                <button
                  onClick={goBack}
                  className="p-1 rounded-md transition-colors"
                  style={{ color: "var(--color-text-tertiary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                  title="Go back"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              )}

              {/* Entry switcher */}
              <div className="relative">
                <button
                  onClick={() => setPickerOpen((v) => !v)}
                  className="flex items-center gap-1.5 px-2 py-1 rounded-md text-sm font-semibold transition-colors"
                  style={{ color: "var(--color-text-primary)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                >
                  {activeName}
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>

                {pickerOpen && (
                  <div
                    className="absolute top-full left-0 mt-1 z-50 rounded-lg overflow-hidden"
                    style={{
                      background: "var(--color-bg-elevated)",
                      border: "1px solid var(--color-border-heavy)",
                      boxShadow: "var(--shadow-lg)",
                      width: 240,
                      maxHeight: 300,
                      overflowY: "auto",
                    }}
                  >
                    <div className="px-2 py-1.5" style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search entries..."
                        className="w-full px-2 py-1 rounded-md text-xs"
                        style={{
                          background: "var(--color-bg-input)",
                          border: "1px solid var(--color-border)",
                          color: "var(--color-text-primary)",
                          outline: "none",
                        }}
                        autoFocus
                      />
                    </div>
                    {filtered.map((entry) => (
                      <div
                        key={entry.name}
                        onClick={() => {
                          openEntry(entry.name);
                          setPickerOpen(false);
                          setSearch("");
                        }}
                        className="px-3 py-2 cursor-pointer transition-colors"
                        style={{
                          background: activeName === entry.name ? "var(--color-bg-hover)" : "transparent",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                        onMouseLeave={(e) => {
                          if (activeName !== entry.name)
                            e.currentTarget.style.background = "transparent";
                        }}
                      >
                        <div className="text-xs font-medium" style={{ color: "var(--color-text-primary)" }}>
                          {entry.name}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: "var(--color-text-tertiary)", fontSize: 10 }}>
                          {entry.preview || "Empty"} · {relativeTime(entry.modified)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {dirty && (
                <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                  saving…
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={createToday}
                className="px-2 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  color: "var(--color-text-secondary)",
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                + Today
              </button>
              <button
                onClick={handleDelete}
                className="px-2 py-1 rounded-md text-xs transition-colors"
                style={{
                  color: "var(--color-text-error)",
                  border: "1px solid var(--color-border)",
                  background: "transparent",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                Delete
              </button>
            </div>
          </div>

          {/* Close picker on click outside */}
          {pickerOpen && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => { setPickerOpen(false); setSearch(""); }}
            />
          )}

          {/* Block editor */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-6 py-4" dir="ltr" style={{ textAlign: "left" }}>
              <style>{`
                .block-line:hover { background: var(--color-bg-hover); }
              `}</style>
              {blocks.map((block, idx) => (
                <BlockEditor
                  key={block.id}
                  block={block}
                  isActive={activeBlockIdx === idx}
                  onActivate={() => setActiveBlockIdx(idx)}
                  onChange={(text) => updateBlock(idx, text)}
                  onKeyDown={(e) => handleBlockKeyDown(idx, e)}
                  onBlur={() => handleBlockBlur(idx)}
                  onLinkClick={handleLinkClick}
                />
              ))}
              {/* Click below blocks to add new */}
              <div
                className="py-8 cursor-text"
                onClick={() => {
                  const newBlock: Block = { id: newBlockId(), text: "" };
                  setBlocks((prev) => [...prev, newBlock]);
                  setActiveBlockIdx(blocks.length);
                  setDirty(true);
                }}
                style={{ minHeight: 100 }}
              />
            </div>
          </div>
        </>
      ) : (
        /* Empty state */
        <div className="flex flex-col items-center justify-center h-full p-8">
          <div className="flex flex-col items-center gap-3" style={{ maxWidth: 420 }}>
            <div
              className="flex items-center justify-center w-10 h-10 rounded-xl"
              style={{ background: "var(--color-bg-hover)" }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 4h16v16H4V4z"
                  stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"
                  style={{ color: "var(--color-text-tertiary)" }}
                />
                <path
                  d="M8 2v4M16 2v4M4 10h16"
                  stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                  style={{ color: "var(--color-text-tertiary)" }}
                />
              </svg>
            </div>
            <h2 className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Journal
            </h2>
            <p className="text-xs text-center" style={{ color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
              Markdown-based journal with block editing. Each paragraph is a block.
              Use <strong>#task</strong> to create tasks, <strong>#reminder</strong> for reminders,
              and <strong>[[links]]</strong> to create connected pages. Pi will extract memories automatically.
            </p>
            <button
              onClick={createToday}
              className="mt-2 px-4 py-2 rounded-lg text-sm font-medium"
              style={{
                background: "var(--color-bg-accent)",
                color: "var(--color-text-on-accent)",
                border: "none",
                cursor: "pointer",
              }}
            >
              Start Today&apos;s Entry
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
