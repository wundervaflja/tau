import React, { useMemo, useState } from "react";
import type { SkillDefinition } from "../../shared/types";

interface SkillsPanelProps {
  skills: SkillDefinition[];
  onSave: (skill: SkillDefinition) => void;
  onDelete: (id: string) => void;
  onRun: (skill: SkillDefinition) => void;
}

export function SkillsPanel({
  skills,
  onSave,
  onDelete,
  onRun,
}: SkillsPanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [editing, setEditing] = useState<SkillDefinition | null>(null);

  // form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [filesystem, setFilesystem] = useState("");
  const [commands, setCommands] = useState("");
  const [network, setNetwork] = useState(false);

  function resetForm() {
    setEditing(null);
    setIsCreating(false);
    setName("");
    setDescription("");
    setPrompt("");
    setFilesystem("");
    setCommands("");
    setNetwork(false);
  }

  function openCreate() {
    resetForm();
    setIsCreating(true);
  }

  function startEdit(skill: SkillDefinition) {
    setEditing(skill);
    setIsCreating(true);
    setName(skill.name);
    setDescription(skill.description || "");
    setPrompt(skill.prompt || "");
    setFilesystem((skill.permissions.filesystem || []).join(", "));
    setCommands((skill.permissions.commands || []).join(", "));
    setNetwork(!!skill.permissions.network);
  }

  function handleSave() {
    if (!name.trim() || !prompt.trim()) return;
    const payload: SkillDefinition = {
      id: editing?.id || "",
      name: name.trim(),
      description: description.trim(),
      prompt: prompt.trim(),
      permissions: {
        filesystem: filesystem
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        commands: commands
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        network,
      },
      createdAt: editing?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };
    onSave(payload);
    resetForm();
  }

  function permissionSummary(p: SkillDefinition["permissions"]) {
    const parts: string[] = [];
    if (p.filesystem && p.filesystem.length > 0) parts.push("filesystem");
    if (p.commands && p.commands.length > 0) parts.push("commands");
    if (p.network) parts.push("network");
    return parts.join(", ");
  }

  const skillsList = useMemo(() => skills || [], [skills]);

  return (
    <div
      style={{
        padding: "24px",
        width: "100%",
        boxSizing: "border-box",
        display: "flex",
        justifyContent: "center",
      }}
    >
      <div style={{ width: "100%", maxWidth: 980 }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h2 style={{ margin: 0, fontSize: 20 }}>Skills</h2>
          <div>
            <button
              onClick={openCreate}
              className="tau-btn"
              style={{
                padding: "8px 12px",
                fontSize: 13,
                borderRadius: 6,
                background: "var(--color-bg-accent)",
                color: "var(--color-text-on-accent)",
                border: "1px solid var(--color-border)",
              }}
            >
              + Create skill
            </button>
          </div>
        </div>

        {/* Inline editor (create / edit) */}
        {isCreating && (
          <div
            style={{
              marginBottom: 18,
              padding: 16,
              borderRadius: 8,
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              boxShadow: "var(--shadow-elevated)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                {editing ? "Edit skill" : "Create skill"}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => {
                    resetForm();
                  }}
                  className="tau-btn"
                  style={{
                    padding: "6px 10px",
                    fontSize: 13,
                    borderRadius: 6,
                    background: "transparent",
                    color: "var(--color-text-secondary)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="tau-btn"
                  style={{
                    padding: "6px 10px",
                    fontSize: 13,
                    borderRadius: 6,
                    background: "var(--color-bg-accent)",
                    color: "var(--color-text-on-accent)",
                    border: "1px solid var(--color-border)",
                  }}
                >
                  Save
                </button>
              </div>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                style={{
                  padding: "8px 10px",
                  fontSize: 14,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-input)",
                }}
              />
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Short description"
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-input)",
                }}
              />
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Prompt or workflow instructions"
                rows={6}
                style={{
                  padding: "10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-input)",
                  resize: "vertical",
                }}
              />

              <div
                style={{ fontSize: 12, color: "var(--color-text-secondary)" }}
              >
                Permissions (comma-separated)
              </div>
              <input
                value={filesystem}
                onChange={(e) => setFilesystem(e.target.value)}
                placeholder="Filesystem paths (e.g. /Users/me/Projects)"
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-input)",
                }}
              />
              <input
                value={commands}
                onChange={(e) => setCommands(e.target.value)}
                placeholder="Allowed commands (e.g. git, npm)"
                style={{
                  padding: "8px 10px",
                  fontSize: 13,
                  borderRadius: 6,
                  border: "1px solid var(--color-border)",
                  background: "var(--color-bg-input)",
                }}
              />
              <label
                style={{
                  fontSize: 13,
                  color: "var(--color-text-secondary)",
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <input
                  type="checkbox"
                  checked={network}
                  onChange={(e) => setNetwork(e.target.checked)}
                />
                Allow network access
              </label>
            </div>
          </div>
        )}

        {/* Your skills section */}
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: 10,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600 }}>Your skills</div>
            <div style={{ fontSize: 12, color: "var(--color-text-secondary)" }}>
              {skillsList.length}
            </div>
          </div>

          <div style={{ display: "grid", gap: 10 }}>
            {skillsList.length === 0 ? (
              <div
                style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}
              >
                No skills yet. Skills are reusable automations that Tau can
                learn from your patterns.
              </div>
            ) : (
              skillsList.map((s) => (
                <div
                  key={s.id}
                  style={{
                    padding: 12,
                    borderRadius: 8,
                    background: "var(--color-bg-elevated)",
                    border: "1px solid var(--color-border)",
                    boxShadow: "var(--shadow-elevated)",
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 12,
                    alignItems: "flex-start",
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "baseline",
                        gap: 8,
                      }}
                    >
                      <div style={{ fontSize: 15, fontWeight: 700 }}>
                        {s.name}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--color-text-secondary)",
                        }}
                      >
                        {s.description || ""}
                      </div>
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 13,
                        color: "var(--color-text-secondary)",
                      }}
                    >
                      {s.prompt}
                    </div>
                    {permissionSummary(s.permissions) && (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: 12,
                          color: "var(--color-text-tertiary)",
                        }}
                      >
                        {permissionSummary(s.permissions)}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 8,
                      alignItems: "flex-end",
                    }}
                  >
                    <button
                      onClick={() => onRun(s)}
                      style={{
                        padding: "8px 12px",
                        borderRadius: 6,
                        background: "var(--color-bg-accent)",
                        color: "var(--color-text-on-accent)",
                        border: "1px solid var(--color-border)",
                        fontSize: 13,
                        fontWeight: 600,
                      }}
                    >
                      Run
                    </button>

                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={() => startEdit(s)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "transparent",
                          color: "var(--color-text-secondary)",
                          border: "1px solid var(--color-border)",
                          fontSize: 13,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => onDelete(s.id)}
                        style={{
                          padding: "6px 10px",
                          borderRadius: 6,
                          background: "transparent",
                          color: "var(--color-text-error)",
                          border: "1px solid var(--color-border)",
                          fontSize: 13,
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
