import React, { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { ApiKeyEntry, ProviderInfo } from "../../shared/types";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * BYOK Settings Modal — allows users to configure API keys for various providers.
 * Keys are persisted to disk and applied to the agent's auth storage at runtime.
 */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [storedKeys, setStoredKeys] = useState<ApiKeyEntry[]>([]);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedProvider, setSavedProvider] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load providers and stored keys
  useEffect(() => {
    if (!isOpen) return;
    bridge.apiKeysProviders().then(setProviders);
    bridge.apiKeysList().then(setStoredKeys);
  }, [isOpen]);

  // Focus input when editing
  useEffect(() => {
    if (editingProvider && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingProvider]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (editingProvider) {
          setEditingProvider(null);
          setKeyInput("");
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, editingProvider, onClose]);

  // Close on click outside
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    },
    [onClose],
  );

  const startEditing = useCallback((providerId: string) => {
    setEditingProvider(providerId);
    // Pre-fill with existing key (masked)
    const existing = storedKeys.find((k) => k.provider === providerId);
    setKeyInput(existing?.key || "");
    setSavedProvider(null);
  }, [storedKeys]);

  const cancelEditing = useCallback(() => {
    setEditingProvider(null);
    setKeyInput("");
  }, []);

  const saveKey = useCallback(async () => {
    if (!editingProvider || !keyInput.trim()) return;
    setSaving(true);
    try {
      const provider = providers.find((p) => p.id === editingProvider);
      await bridge.apiKeysSet(editingProvider, keyInput.trim(), provider?.label || editingProvider);
      // Refresh stored keys
      const updated = await bridge.apiKeysList();
      setStoredKeys(updated);
      setSavedProvider(editingProvider);
      setEditingProvider(null);
      setKeyInput("");
      // Clear "saved" indicator after a moment
      setTimeout(() => setSavedProvider(null), 2000);
    } finally {
      setSaving(false);
    }
  }, [editingProvider, keyInput, providers]);

  const deleteKey = useCallback(async (providerId: string) => {
    await bridge.apiKeysDelete(providerId);
    const updated = await bridge.apiKeysList();
    setStoredKeys(updated);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveKey();
      }
    },
    [saveKey],
  );

  if (!isOpen) return null;

  const getStoredKey = (providerId: string) =>
    storedKeys.find((k) => k.provider === providerId);

  const maskKey = (key: string) => {
    if (key.length <= 8) return "•".repeat(key.length);
    return key.slice(0, 4) + "•".repeat(Math.min(key.length - 8, 20)) + key.slice(-4);
  };

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
          width: 520,
          maxHeight: "80vh",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid var(--color-border)" }}
        >
          <div>
            <h2
              className="text-sm font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              Settings
            </h2>
            <p
              className="text-xs mt-0.5"
              style={{ color: "var(--color-text-tertiary)" }}
            >
              Configure API keys for AI providers
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

        {/* Content */}
        <div className="overflow-y-auto" style={{ maxHeight: "calc(80vh - 70px)" }}>
          {/* API Keys Section */}
          <div className="px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" style={{ color: "var(--color-text-secondary)" }}>
                <path
                  d="M10.5 1.5a3.5 3.5 0 0 1 .874 6.892L8.5 11.268V13.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-1H3.5a1 1 0 0 1-1-1V10a1 1 0 0 1 .293-.707l4.815-4.815A3.5 3.5 0 0 1 10.5 1.5z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  fill="none"
                />
                <circle cx="11" cy="5" r="1" fill="currentColor" />
              </svg>
              <span
                className="text-xs font-medium"
                style={{ color: "var(--color-text-secondary)" }}
              >
                API Keys
              </span>
            </div>

            <p
              className="text-xs mb-4"
              style={{ color: "var(--color-text-tertiary)", lineHeight: 1.5 }}
            >
              Add your own API keys to use different AI providers. Keys are stored
              locally and take priority over environment variables.
            </p>

            <div className="space-y-1">
              {providers.map((provider) => {
                const stored = getStoredKey(provider.id);
                const isEditing = editingProvider === provider.id;
                const justSaved = savedProvider === provider.id;

                return (
                  <div
                    key={provider.id}
                    className="rounded-lg px-3 py-2.5 transition-colors"
                    style={{
                      background: isEditing ? "var(--color-bg-hover)" : undefined,
                      border: isEditing
                        ? "1px solid var(--color-border-heavy)"
                        : "1px solid transparent",
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        {/* Status indicator */}
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{
                            background: stored
                              ? "var(--color-success, #22c55e)"
                              : "var(--color-text-tertiary)",
                            opacity: stored ? 1 : 0.3,
                          }}
                          title={stored ? "Key configured" : "No key set"}
                        />
                        <div>
                          <span
                            className="text-xs font-medium"
                            style={{ color: "var(--color-text-primary)" }}
                          >
                            {provider.label}
                          </span>
                          <span
                            className="text-xs ml-2"
                            style={{ color: "var(--color-text-tertiary)", fontSize: 10 }}
                          >
                            {provider.envVar}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {justSaved && (
                          <span
                            className="text-xs animate-fade-in"
                            style={{ color: "var(--color-success, #22c55e)", fontSize: 10 }}
                          >
                            ✓ Saved
                          </span>
                        )}

                        {stored && !isEditing && (
                          <span
                            className="text-xs font-mono"
                            style={{
                              color: "var(--color-text-tertiary)",
                              fontSize: 10,
                              letterSpacing: "0.05em",
                            }}
                          >
                            {maskKey(stored.key)}
                          </span>
                        )}

                        {!isEditing && (
                          <>
                            <button
                              onClick={() => startEditing(provider.id)}
                              className="px-2 py-1 rounded-md text-xs transition-colors"
                              style={{ color: "var(--color-text-secondary)" }}
                              onMouseEnter={(e) =>
                                (e.currentTarget.style.background = "var(--color-bg-hover)")
                              }
                              onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                            >
                              {stored ? "Edit" : "Add"}
                            </button>
                            {stored && (
                              <button
                                onClick={() => deleteKey(provider.id)}
                                className="px-1.5 py-1 rounded-md text-xs transition-colors"
                                style={{ color: "var(--color-text-tertiary)" }}
                                onMouseEnter={(e) => {
                                  e.currentTarget.style.background = "var(--color-bg-hover)";
                                  e.currentTarget.style.color = "var(--color-danger, #ef4444)";
                                }}
                                onMouseLeave={(e) => {
                                  e.currentTarget.style.background = "";
                                  e.currentTarget.style.color = "var(--color-text-tertiary)";
                                }}
                                title="Remove key"
                              >
                                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                                  <path
                                    d="M5 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1m-8 0h12M6 3v10h4V3"
                                    stroke="currentColor"
                                    strokeWidth="1.2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    {/* Inline edit form */}
                    {isEditing && (
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          ref={inputRef}
                          type="password"
                          value={keyInput}
                          onChange={(e) => setKeyInput(e.target.value)}
                          onKeyDown={handleKeyDown}
                          placeholder={provider.placeholder}
                          className="flex-1 px-2.5 py-1.5 rounded-md text-xs font-mono outline-none transition-colors"
                          style={{
                            background: "var(--color-bg-app)",
                            border: "1px solid var(--color-border)",
                            color: "var(--color-text-primary)",
                          }}
                          onFocus={(e) =>
                            (e.currentTarget.style.borderColor = "var(--color-border-heavy)")
                          }
                          onBlur={(e) =>
                            (e.currentTarget.style.borderColor = "var(--color-border)")
                          }
                          autoComplete="off"
                          spellCheck={false}
                        />
                        <button
                          onClick={saveKey}
                          disabled={saving || !keyInput.trim()}
                          className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                          style={{
                            background: "var(--color-bg-accent)",
                            color: "var(--color-text-on-accent)",
                            opacity: saving || !keyInput.trim() ? 0.5 : 1,
                          }}
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                        <button
                          onClick={cancelEditing}
                          className="px-2 py-1.5 rounded-md text-xs transition-colors"
                          style={{ color: "var(--color-text-tertiary)" }}
                          onMouseEnter={(e) =>
                            (e.currentTarget.style.background = "var(--color-bg-hover)")
                          }
                          onMouseLeave={(e) => (e.currentTarget.style.background = "")}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Info footer */}
          <div
            className="px-5 py-3"
            style={{
              borderTop: "1px solid var(--color-border)",
              background: "var(--color-bg-surface)",
            }}
          >
            <p
              className="text-xs"
              style={{ color: "var(--color-text-tertiary)", lineHeight: 1.5 }}
            >
              💡 Keys are stored locally in{" "}
              <code
                className="px-1 py-0.5 rounded text-xs"
                style={{ background: "var(--color-bg-hover)" }}
              >
                api-keys.json
              </code>{" "}
              and take priority over environment variables and{" "}
              <code
                className="px-1 py-0.5 rounded text-xs"
                style={{ background: "var(--color-bg-hover)" }}
              >
                ~/.tau/agent/auth.json
              </code>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
