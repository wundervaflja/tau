import React, { useMemo, useState } from "react";
import type { MemoryItem, MemoryType } from "../../shared/types";

interface MemoryPanelProps {
  items: MemoryItem[];
  onAdd: (item: MemoryItem) => void;
  onDelete: (id: string) => void;
}

const ORDER: MemoryType[] = [
  "preference",
  "fact",
  "decision",
  "summary",
  "tag",
];
const ALL_TYPES: MemoryType[] = [
  "summary",
  "fact",
  "preference",
  "decision",
  "tag",
];

function formatTime(ts: number) {
  const d = Date.now() - ts;
  if (d < 1000 * 60) return "now";
  const m = Math.floor(d / (1000 * 60));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  // fallback to short date
  const date = new Date(ts);
  return date.toLocaleDateString();
}

export function MemoryPanel({ items, onAdd, onDelete }: MemoryPanelProps) {
  const [search, setSearch] = useState("");
  const [openAdd, setOpenAdd] = useState(false);
  const [type, setType] = useState<MemoryType>("fact");
  const [content, setContent] = useState("");
  const [tags, setTags] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice().sort((a, b) => b.timestamp - a.timestamp);
    return items
      .filter((it) => {
        if (it.content.toLowerCase().includes(q)) return true;
        if (it.tags && it.tags.some((t) => t.toLowerCase().includes(q)))
          return true;
        return false;
      })
      .sort((a, b) => b.timestamp - a.timestamp);
  }, [items, search]);

  const groups = useMemo(() => {
    const map: Record<MemoryType, MemoryItem[]> = {
      summary: [],
      fact: [],
      preference: [],
      decision: [],
      tag: [],
    };
    for (const it of filtered) {
      map[it.type].push(it);
    }
    // produce ordered list of non-empty groups in the requested order
    const result: { type: MemoryType; items: MemoryItem[] }[] = [];
    for (const t of ORDER) {
      if (map[t].length > 0) result.push({ type: t, items: map[t] });
    }
    return result;
  }, [filtered]);

  function handleSave() {
    const c = content.trim();
    if (!c) return;
    const tArr = tags
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    onAdd({ id: "", type, content: c, tags: tArr, timestamp: Date.now() });
    setContent("");
    setTags("");
    setOpenAdd(false);
  }

  function getSourceText(src?: MemoryItem["source"]) {
    switch (src) {
      case "manual":
        return "Added manually";
      case "auto-extracted":
        return "Learned from conversation";
      case "agent-created":
        return "Created by agent";
      case "auto-summary":
        return "Auto-summary";
      default:
        return undefined;
    }
  }

  return (
    <div
      className="memory-panel"
      style={{
        padding: "24px",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 920 }}>
        <style>{`
          .memory-panel .header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            margin-bottom: 12px;
          }
          .memory-panel .title {
            font-size: 18px;
            font-weight: 600;
            color: var(--color-text-primary);
          }
          .memory-panel .add-toggle {
            font-size: 13px;
            padding: 6px 10px;
            border-radius: 8px;
            background: var(--color-bg-accent);
            color: var(--color-text-on-accent);
            border: 1px solid var(--color-border);
            cursor: pointer;
          }

          .memory-panel .search {
            width: 100%;
            padding: 10px 12px;
            border-radius: 8px;
            border: 1px solid var(--color-border);
            background: var(--color-bg-input);
            color: var(--color-text-primary);
            margin-bottom: 16px;
            box-sizing: border-box;
          }

          .memory-panel .section {
            margin-top: 18px;
          }

          .memory-panel .section-header {
            font-size: 12px;
            font-weight: 600;
            color: var(--color-text-secondary);
            text-transform: uppercase;
            margin-bottom: 8px;
            display: flex;
            align-items: center;
            gap: 8px;
          }

          .memory-panel .section-count {
            font-size: 11px;
            color: var(--color-text-tertiary);
            font-weight: 500;
          }

          .memory-panel .memory-item {
            background: var(--color-bg-elevated);
            border: 1px solid var(--color-border);
            padding: 12px;
            border-radius: 10px;
            margin-bottom: 10px;
            transition: box-shadow 0.15s ease, transform 0.08s ease;
            position: relative;
          }
          .memory-panel .memory-item:hover {
            box-shadow: 0 6px 18px rgba(0,0,0,0.06);
            transform: translateY(-2px);
          }

          .memory-panel .memory-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
          }

          .memory-panel .content {
            font-size: 14px;
            color: var(--color-text-primary);
            margin-top: 8px;
            white-space: pre-wrap;
          }

          .memory-panel .meta {
            margin-top: 10px;
            font-size: 12px;
            color: var(--color-text-tertiary);
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
          }

          .memory-panel .tag-pill {
            background: var(--color-bg-muted, rgba(0,0,0,0.04));
            color: var(--color-text-secondary);
            padding: 4px 8px;
            border-radius: 999px;
            font-size: 12px;
            margin-right: 6px;
          }

          .memory-panel .delete-btn {
            font-size: 12px;
            color: var(--color-text-error);
            background: transparent;
            border: none;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.12s ease, transform 0.12s ease;
          }

          .memory-panel .memory-item:hover .delete-btn {
            opacity: 1;
            transform: translateY(0);
          }

          .memory-panel .add-form {
            overflow: hidden;
            transform-origin: top;
            transition: transform 0.18s ease, opacity 0.18s ease;
            transform: scaleY(0);
            opacity: 0;
            margin-bottom: 12px;
          }
          .memory-panel .add-form.open {
            transform: scaleY(1);
            opacity: 1;
          }

          .memory-panel .form-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
          }

          .memory-panel .input, .memory-panel select {
            padding: 8px 10px;
            border-radius: 8px;
            border: 1px solid var(--color-border);
            background: var(--color-bg-input);
            color: var(--color-text-primary);
            font-size: 13px;
            flex: 1;
          }

          .memory-panel .small-btn {
            padding: 8px 10px;
            border-radius: 8px;
            font-size: 13px;
            cursor: pointer;
            border: 1px solid var(--color-border);
            background: var(--color-bg);
            color: var(--color-text-primary);
          }

          .memory-panel .save-btn {
            background: var(--color-bg-accent);
            color: var(--color-text-on-accent);
            border: 1px solid var(--color-border);
          }

          .memory-panel .empty {
            color: var(--color-text-tertiary);
            font-size: 14px;
            margin-top: 18px;
          }

          .memory-panel .privacy {
            margin-top: 18px;
            font-size: 12px;
            color: var(--color-text-tertiary);
          }

          .memory-panel .source-line {
            font-size: 12px;
            color: var(--color-text-tertiary);
            margin-top: 6px;
          }
        `}</style>

        <div className="header">
          <div className="title">What Tau knows</div>
          <div>
            <button
              className="add-toggle"
              onClick={() => setOpenAdd((s) => !s)}
              aria-expanded={openAdd}
            >
              + Add
            </button>
          </div>
        </div>

        <div className={"add-form" + (openAdd ? " open" : "")}>
          <div className="form-row" style={{ marginBottom: 10 }}>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as MemoryType)}
              className="input"
              style={{ maxWidth: 180 }}
            >
              {ALL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              className="input"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Memory content"
            />
          </div>
          <div className="form-row">
            <input
              className="input"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="Tags (comma-separated)"
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="small-btn save-btn" onClick={handleSave}>
                Save
              </button>
              <button className="small-btn" onClick={() => setOpenAdd(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>

        <input
          className="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search memories by content or tags"
        />

        {groups.length === 0 ? (
          <div className="empty">
            No memories yet. Tau will learn from your conversations and remember
            important details.
          </div>
        ) : (
          groups.map((g) => (
            <div className="section" key={g.type}>
              <div className="section-header">
                <div style={{ textTransform: "capitalize" }}>{g.type}</div>
                <div className="section-count">{g.items.length}</div>
              </div>
              <div>
                {g.items.map((m) => (
                  <div className="memory-item" key={m.id}>
                    <div className="memory-top">
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-secondary)",
                          fontWeight: 600,
                        }}
                      >
                        {/* type label */}
                        {m.type}
                      </div>
                      <button
                        className="delete-btn"
                        onClick={() => onDelete(m.id)}
                        title="Delete memory"
                      >
                        Delete
                      </button>
                    </div>

                    <div className="content">{m.content}</div>

                    <div className="meta">
                      <div
                        style={{
                          display: "flex",
                          gap: 6,
                          flexDirection: "column",
                          alignItems: "flex-start",
                          flexWrap: "wrap",
                        }}
                      >
                        <div
                          style={{
                            display: "flex",
                            gap: 6,
                            alignItems: "center",
                            flexWrap: "wrap",
                          }}
                        >
                          {(m.tags || []).map((t) => (
                            <div key={t} className="tag-pill">
                              {t}
                            </div>
                          ))}
                        </div>
                        {m.source && (
                          <div className="source-line">
                            {getSourceText(m.source)}
                          </div>
                        )}
                      </div>
                      <div style={{ marginLeft: 6 }}>
                        {formatTime(m.timestamp)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        <div className="privacy">
          All memories are stored locally on this device.
        </div>
      </div>
    </div>
  );
}

export default MemoryPanel;
