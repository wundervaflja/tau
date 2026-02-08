import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { SessionTreeNodeInfo, TreeNavigateResult } from "../../shared/types";

interface TreeNavigatorProps {
  isOpen: boolean;
  onClose: () => void;
  onEditorText: (text: string) => void;
}

interface FlatNode {
  node: SessionTreeNodeInfo;
  depth: number;
}

function flattenTree(nodes: SessionTreeNodeInfo[], depth = 0): FlatNode[] {
  const result: FlatNode[] = [];
  for (const node of nodes) {
    result.push({ node, depth });
    if (node.children.length > 0) {
      result.push(...flattenTree(node.children, depth + 1));
    }
  }
  return result;
}

type ConfirmPhase = "idle" | "confirm" | "instructions";

export function TreeNavigator({ isOpen, onClose, onEditorText }: TreeNavigatorProps) {
  const [flatNodes, setFlatNodes] = useState<FlatNode[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [confirmPhase, setConfirmPhase] = useState<ConfirmPhase>("idle");
  const [pendingTargetId, setPendingTargetId] = useState<string | null>(null);
  const [customInstructions, setCustomInstructions] = useState("");
  const [showUserOnly, setShowUserOnly] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const instructionsRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setConfirmPhase("idle");
    setPendingTargetId(null);
    setCustomInstructions("");
    setShowUserOnly(false);
    loadTree();
    requestAnimationFrame(() => containerRef.current?.focus());
  }, [isOpen]);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const tree = await bridge.getSessionTree();
      const flat = flattenTree(tree);
      setFlatNodes(flat);
      const activeIdx = flat.findIndex((f) => f.node.isActive);
      setSelectedIndex(activeIdx >= 0 ? activeIdx : 0);
    } catch (err) {
      console.error("Failed to load session tree:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const displayNodes = showUserOnly
    ? flatNodes.filter((f) => f.node.entryType === "message" && f.node.role === "user")
    : flatNodes.filter((f) => {
        const t = f.node.entryType;
        return t === "message" || t === "compaction" || t === "branch_summary";
      });

  useEffect(() => {
    if (selectedIndex >= displayNodes.length) {
      setSelectedIndex(Math.max(0, displayNodes.length - 1));
    }
  }, [displayNodes.length, selectedIndex]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  useEffect(() => {
    if (confirmPhase === "instructions") {
      requestAnimationFrame(() => instructionsRef.current?.focus());
    }
  }, [confirmPhase]);

  function selectNode() {
    const entry = displayNodes[selectedIndex];
    if (!entry) return;
    if (entry.node.isActive) return;
    setPendingTargetId(entry.node.id);
    setConfirmPhase("confirm");
  }

  async function doNavigate(summarize: boolean, instructions?: string) {
    if (!pendingTargetId) return;
    setLoading(true);
    try {
      const result: TreeNavigateResult = await bridge.navigateTree(pendingTargetId, {
        summarize,
        customInstructions: instructions,
      });
      if (!result.cancelled && result.editorText) {
        onEditorText(result.editorText);
      }
      onClose();
    } catch (err) {
      console.error("Tree navigation failed:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (confirmPhase === "instructions") {
      if (e.key === "Enter") { e.preventDefault(); doNavigate(true, customInstructions); return; }
      if (e.key === "Escape") { e.preventDefault(); setConfirmPhase("idle"); return; }
      return;
    }
    if (confirmPhase === "confirm") {
      if (e.key === "Escape") { e.preventDefault(); setConfirmPhase("idle"); return; }
      if (e.key === "1" || e.key === "Enter") { e.preventDefault(); doNavigate(false); return; }
      if (e.key === "2" || e.key === "s") { e.preventDefault(); doNavigate(true); return; }
      if (e.key === "3" || e.key === "c") { e.preventDefault(); setConfirmPhase("instructions"); return; }
      return;
    }
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      setSelectedIndex((i) => (i < displayNodes.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : displayNodes.length - 1));
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); selectNode(); return; }
    if (e.ctrlKey && e.key === "u") {
      e.preventDefault();
      setShowUserOnly((v) => !v);
      setSelectedIndex(0);
      return;
    }
  }

  if (!isOpen) return null;

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", justifyContent: "center", paddingTop: 60 }}
    >
      {/* Backdrop */}
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }} />

      {/* Modal */}
      <div
        ref={containerRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        data-tree-navigator=""
        style={{
          position: "relative", width: "100%", maxWidth: 640, maxHeight: "min(600px, 75vh)",
          borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 16px 48px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
          outline: "none",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "12px 16px",
          borderBottom: "1px solid var(--color-border-heavy)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)" }}>Session Tree</span>
          <button
            onClick={() => { setShowUserOnly((v) => !v); setSelectedIndex(0); }}
            style={{
              fontSize: 11, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
              border: "1px solid var(--color-border-heavy)",
              background: showUserOnly ? "var(--color-bg-accent)" : "transparent",
              color: showUserOnly ? "var(--color-text-on-accent)" : "var(--color-text-secondary)",
            }}
          >
            User only
          </button>
        </div>

        {/* Tree list */}
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {loading && displayNodes.length === 0 && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--color-text-secondary)" }}>
              Loading tree…
            </div>
          )}
          {!loading && displayNodes.length === 0 && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--color-text-secondary)" }}>
              Empty session tree
            </div>
          )}
          {displayNodes.map((f, idx) => {
            const isSelected = idx === selectedIndex;
            const n = f.node;
            const isUser = n.role === "user";
            const isAssistant = n.role === "assistant";

            return (
              <div
                key={n.id}
                onClick={() => { setSelectedIndex(idx); selectNode(); }}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  padding: "8px 16px",
                  paddingLeft: 16,
                  cursor: "pointer",
                  background: isSelected ? "var(--color-bg-active)" : "transparent",
                  borderLeft: n.isActive ? "3px solid var(--color-bg-accent)" : "3px solid transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {/* Role / type badge */}
                  {isUser && (
                    <span style={{
                      display: "inline-block",
                      fontSize: 10, fontWeight: 600, lineHeight: 1,
                      padding: "2px 6px", borderRadius: 3,
                      background: "var(--color-bg-accent)",
                      color: "var(--color-text-on-accent)",
                      flexShrink: 0,
                    }}>
                      you
                    </span>
                  )}
                  {isAssistant && (
                    <span style={{
                      display: "inline-block",
                      fontSize: 10, fontWeight: 600, lineHeight: 1,
                      padding: "2px 6px", borderRadius: 3,
                      background: "var(--color-bg-active)",
                      color: "var(--color-text-secondary)",
                      flexShrink: 0,
                    }}>
                      agent
                    </span>
                  )}
                  {!isUser && !isAssistant && (
                    <span style={{
                      display: "inline-block",
                      fontSize: 10, fontWeight: 500, lineHeight: 1,
                      padding: "2px 6px", borderRadius: 3,
                      background: "var(--color-bg-code)",
                      color: "var(--color-text-secondary)",
                      flexShrink: 0,
                    }}>
                      {n.entryType}
                    </span>
                  )}

                  {/* Active indicator */}
                  {n.isActive && (
                    <span style={{
                      fontSize: 10, fontWeight: 600,
                      padding: "2px 6px", borderRadius: 3,
                      color: "var(--color-text-accent)",
                      background: "var(--color-bg-hover)",
                      flexShrink: 0,
                    }}>
                      {"← current"}
                    </span>
                  )}

                  {n.label && (
                    <span style={{ fontSize: 10, color: "var(--color-text-warning)", flexShrink: 0 }}>
                      {"[" + n.label + "]"}
                    </span>
                  )}
                </div>

                {/* Text preview on its own line */}
                <div style={{
                  marginTop: 3,
                  fontSize: 12,
                  fontFamily: "var(--font-mono, monospace)",
                  color: "var(--color-text-primary)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}>
                  {n.text || "(empty)"}
                </div>
              </div>
            );
          })}
        </div>

        {/* Confirm bar */}
        {confirmPhase === "confirm" && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border-heavy)" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 10 }}>
              Navigate to this point?
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <ConfirmBtn label="Switch (1)" onClick={() => doNavigate(false)} />
              <ConfirmBtn label="Switch & Summarize (2)" onClick={() => doNavigate(true)} accent />
              <ConfirmBtn label="Custom instructions (3)" onClick={() => setConfirmPhase("instructions")} />
              <ConfirmBtn label="Cancel (Esc)" onClick={() => setConfirmPhase("idle")} />
            </div>
          </div>
        )}

        {confirmPhase === "instructions" && (
          <div style={{ padding: "12px 16px", borderTop: "1px solid var(--color-border-heavy)" }}>
            <div style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)", marginBottom: 6 }}>
              Custom summarization instructions:
            </div>
            <input
              ref={instructionsRef}
              value={customInstructions}
              onChange={(e) => setCustomInstructions(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); doNavigate(true, customInstructions); }
                if (e.key === "Escape") { e.preventDefault(); setConfirmPhase("idle"); }
                e.stopPropagation();
              }}
              placeholder="Focus on…"
              style={{
                width: "100%", padding: "6px 10px", borderRadius: 6,
                border: "1px solid var(--color-border-heavy)", background: "var(--color-bg-input)",
                color: "var(--color-text-primary)", fontSize: 13, outline: "none",
                fontFamily: "var(--font-sans)",
              }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <ConfirmBtn label="Summarize & switch" onClick={() => doNavigate(true, customInstructions)} accent />
              <ConfirmBtn label="Cancel" onClick={() => setConfirmPhase("idle")} />
            </div>
          </div>
        )}

        {/* Footer */}
        {confirmPhase === "idle" && (
          <div style={{
            padding: "8px 16px",
            borderTop: "1px solid var(--color-border-heavy)",
            display: "flex", gap: 16, fontSize: 11,
            color: "var(--color-text-secondary)",
          }}>
            <span>{"↑↓ navigate"}</span>
            <span>{"Enter select"}</span>
            <span>{"Ctrl+U user only"}</span>
            <span>{"Esc close"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmBtn({ label, onClick, accent }: { label: string; onClick: () => void; accent?: boolean }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 12, padding: "5px 12px", borderRadius: 6, cursor: "pointer",
        border: accent ? "none" : "1px solid var(--color-border-heavy)",
        background: accent ? "var(--color-bg-accent)" : "transparent",
        color: accent ? "var(--color-text-on-accent)" : "var(--color-text-primary)",
        fontWeight: 500,
      }}
    >
      {label}
    </button>
  );
}
