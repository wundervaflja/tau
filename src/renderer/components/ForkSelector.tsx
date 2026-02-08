import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { ForkableMessage } from "../../shared/types";

interface ForkSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onEditorText: (text: string) => void;
}

export function ForkSelector({ isOpen, onClose, onEditorText }: ForkSelectorProps) {
  const [messages, setMessages] = useState<ForkableMessage[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setQuery("");
    setSelectedIndex(0);
    loadMessages();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [isOpen]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const msgs = await bridge.getForkMessages();
      setMessages(msgs);
    } catch (err) {
      console.error("Failed to load fork messages:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const filtered = query.trim()
    ? messages.filter((m) => m.text.toLowerCase().includes(query.toLowerCase()))
    : messages;

  useEffect(() => {
    if (selectedIndex >= filtered.length) {
      setSelectedIndex(Math.max(0, filtered.length - 1));
    }
  }, [filtered.length, selectedIndex]);

  useEffect(() => {
    if (!listRef.current) return;
    const el = listRef.current.children[selectedIndex] as HTMLElement;
    el?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  async function doFork(entryId: string) {
    setLoading(true);
    try {
      const result = await bridge.forkSession(entryId);
      if (!result.cancelled && result.selectedText) {
        onEditorText(result.selectedText);
      }
      onClose();
    } catch (err) {
      console.error("Fork failed:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => (i < filtered.length - 1 ? i + 1 : 0));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => (i > 0 ? i - 1 : filtered.length - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const msg = filtered[selectedIndex];
      if (msg) doFork(msg.entryId);
      return;
    }
  }

  if (!isOpen) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, display: "flex", justifyContent: "center", paddingTop: 80 }}>
      <div onClick={onClose} style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }} />
      <div
        data-fork-selector=""
        style={{
          position: "relative", width: "100%", maxWidth: 560, maxHeight: "min(520px, 70vh)",
          borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column",
          boxShadow: "0 16px 48px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.05)",
        }}
      >
        {/* Search */}
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)" }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-tertiary)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Fork from message
          </div>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search messages\u2026"
            style={{ width: "100%", background: "transparent", border: "none", outline: "none", fontSize: 14, color: "var(--color-text-primary)", fontFamily: "var(--font-sans)" }}
          />
        </div>

        {/* Message list */}
        <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
          {loading && filtered.length === 0 && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--color-text-tertiary)" }}>Loading messages\u2026</div>
          )}
          {!loading && filtered.length === 0 && (
            <div style={{ padding: "20px 16px", textAlign: "center", color: "var(--color-text-tertiary)" }}>No user messages to fork from</div>
          )}
          {filtered.map((msg, idx) => {
            const isSelected = idx === selectedIndex;
            const preview = msg.text.length > 120 ? msg.text.slice(0, 120) + "…" : msg.text;
            return (
              <div
                key={msg.entryId}
                onClick={() => doFork(msg.entryId)}
                onMouseEnter={() => setSelectedIndex(idx)}
                style={{
                  padding: "10px 16px", cursor: "pointer",
                  background: isSelected ? "var(--color-bg-active)" : "transparent",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                <div style={{ fontSize: 13, color: "var(--color-text-primary)", lineHeight: 1.5 }}>
                  {preview}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: "8px 16px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 16, fontSize: 11, color: "var(--color-text-secondary)" }}>
          <span>{"↑↓ navigate"}</span><span>{"Enter fork"}</span><span>{"Esc cancel"}</span>
        </div>
      </div>
    </div>
  );
}
