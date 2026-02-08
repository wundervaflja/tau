import React, { useMemo, useState, useCallback } from "react";
import type { VaultNoteListItem, VaultNoteType } from "../../shared/vault-types";

interface VaultPanelProps {
  notes: VaultNoteListItem[];
  onSearch: (query: string) => void;
  onRead: (slug: string, scope: string) => void;
  onCreate: (opts: any) => void;
  onDelete: (slug: string, scope: string) => void;
  onRefresh: () => void;
}

const TYPE_LABELS: Record<string, string> = {
  memory: "Memory",
  concept: "Concept",
  pattern: "Pattern",
  project: "Project",
  reference: "Reference",
  log: "Log",
  moc: "Map of Content",
};

const MEMORY_TYPE_COLORS: Record<string, string> = {
  preference: "bg-purple-500/20 text-purple-300",
  fact: "bg-blue-500/20 text-blue-300",
  decision: "bg-amber-500/20 text-amber-300",
  summary: "bg-green-500/20 text-green-300",
};

const TYPE_COLORS: Record<string, string> = {
  memory: "bg-cyan-500/20 text-cyan-300",
  concept: "bg-indigo-500/20 text-indigo-300",
  pattern: "bg-pink-500/20 text-pink-300",
  project: "bg-emerald-500/20 text-emerald-300",
  reference: "bg-gray-500/20 text-gray-300",
  log: "bg-orange-500/20 text-orange-300",
  moc: "bg-teal-500/20 text-teal-300",
};

function formatTime(ts: string | undefined) {
  if (!ts) return "";
  const d = Date.now() - new Date(ts).getTime();
  if (d < 1000 * 60) return "now";
  const m = Math.floor(d / (1000 * 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}

type FilterType = "all" | "memory" | "concept" | "pattern" | "reference";

export function VaultPanel({ notes, onSearch, onRead, onCreate, onDelete, onRefresh }: VaultPanelProps) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterType>("all");
  const [showCreate, setShowCreate] = useState(false);

  // Create form
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<VaultNoteType>("memory");
  const [newMemoryType, setNewMemoryType] = useState("fact");
  const [newTags, setNewTags] = useState("");
  const [newScope, setNewScope] = useState("workspace");

  const filtered = useMemo(() => {
    let result = notes;
    if (filter !== "all") {
      result = result.filter(n => n.type === filter);
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      result = result.filter(n =>
        n.title.toLowerCase().includes(q) ||
        (n.preview && n.preview.toLowerCase().includes(q)) ||
        n.tags?.some(t => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [notes, filter, search]);

  const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    if (e.target.value.length > 2) {
      onSearch(e.target.value);
    }
  }, [onSearch]);

  const handleCreate = useCallback(() => {
    if (!newTitle.trim()) return;
    const opts: any = {
      title: newTitle,
      content: newContent,
      type: newType,
      tags: newTags.split(",").map(t => t.trim()).filter(Boolean),
      scope: newScope,
    };
    if (newType === "memory") {
      opts.memoryType = newMemoryType;
    }
    onCreate(opts);
    setShowCreate(false);
    setNewTitle("");
    setNewContent("");
    setNewTags("");
  }, [newTitle, newContent, newType, newMemoryType, newTags, newScope, onCreate]);

  const filterTabs: { key: FilterType; label: string }[] = [
    { key: "all", label: "All" },
    { key: "memory", label: "Memories" },
    { key: "concept", label: "Concepts" },
    { key: "pattern", label: "Patterns" },
    { key: "reference", label: "References" },
  ];

  return (
    <div className="flex flex-col h-full bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-primary)]">
        <span className="text-sm font-medium text-[var(--text-primary)]">Vault</span>
        <span className="text-xs text-[var(--text-muted)]">{notes.length} notes</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs px-2 py-1 rounded bg-[var(--accent-primary)] text-white hover:opacity-90"
        >
          + New
        </button>
        <button
          onClick={onRefresh}
          className="text-xs px-2 py-1 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:opacity-90"
        >
          Refresh
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <input
          type="text"
          placeholder="Search vault..."
          value={search}
          onChange={handleSearch}
          className="w-full px-2 py-1 text-sm bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 px-3 pb-2">
        {filterTabs.map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`text-xs px-2 py-0.5 rounded ${
              filter === tab.key
                ? "bg-[var(--accent-primary)] text-white"
                : "bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:opacity-80"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="px-3 py-2 border-b border-[var(--border-primary)] bg-[var(--bg-secondary)]">
          <input
            type="text"
            placeholder="Title"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            className="w-full mb-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
          />
          <textarea
            placeholder="Content (markdown)"
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            rows={3}
            className="w-full mb-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)] resize-y"
          />
          <div className="flex gap-1 mb-1">
            <select
              value={newType}
              onChange={e => setNewType(e.target.value as VaultNoteType)}
              className="text-xs px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
            >
              <option value="memory">Memory</option>
              <option value="concept">Concept</option>
              <option value="pattern">Pattern</option>
              <option value="project">Project</option>
              <option value="reference">Reference</option>
              <option value="log">Log</option>
            </select>
            {newType === "memory" && (
              <select
                value={newMemoryType}
                onChange={e => setNewMemoryType(e.target.value)}
                className="text-xs px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
              >
                <option value="fact">Fact</option>
                <option value="preference">Preference</option>
                <option value="decision">Decision</option>
                <option value="summary">Summary</option>
              </select>
            )}
            <select
              value={newScope}
              onChange={e => setNewScope(e.target.value)}
              className="text-xs px-2 py-1 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
            >
              <option value="workspace">Workspace</option>
              <option value="global">Global</option>
            </select>
          </div>
          <input
            type="text"
            placeholder="Tags (comma-separated)"
            value={newTags}
            onChange={e => setNewTags(e.target.value)}
            className="w-full mb-1 px-2 py-1 text-sm bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-[var(--text-primary)]"
          />
          <button
            onClick={handleCreate}
            disabled={!newTitle.trim()}
            className="text-xs px-3 py-1 rounded bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50"
          >
            Create
          </button>
        </div>
      )}

      {/* Note list */}
      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-3 py-4 text-sm text-[var(--text-muted)] text-center">
            {notes.length === 0 ? "No notes in vault yet." : "No notes match your filter."}
          </div>
        ) : (
          filtered.map(note => (
            <div
              key={`${note.scope}/${note.slug}`}
              className="px-3 py-2 border-b border-[var(--border-primary)] hover:bg-[var(--bg-secondary)] cursor-pointer group"
              onClick={() => onRead(note.slug, note.scope)}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${TYPE_COLORS[note.type] || "bg-gray-500/20 text-gray-300"}`}>
                  {TYPE_LABELS[note.type] || note.type}
                </span>
                {note.type === "memory" && note.memoryType && (
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${MEMORY_TYPE_COLORS[note.memoryType] || ""}`}>
                    {note.memoryType}
                  </span>
                )}
                <span className="text-[10px] text-[var(--text-muted)]">
                  {note.scope === "global" ? "G" : "W"}
                </span>
                <div className="flex-1" />
                <span className="text-[10px] text-[var(--text-muted)]">
                  {formatTime(note.updated)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(note.slug, note.scope); }}
                  className="text-[10px] text-red-400 opacity-0 group-hover:opacity-100"
                >
                  x
                </button>
              </div>
              <div className="text-sm text-[var(--text-primary)] truncate">{note.title}</div>
              {note.preview && (
                <div className="text-xs text-[var(--text-muted)] truncate">{note.preview}</div>
              )}
              {note.tags && note.tags.length > 0 && (
                <div className="flex gap-1 mt-0.5">
                  {note.tags.slice(0, 4).map(tag => (
                    <span key={tag} className="text-[10px] px-1 py-0 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
