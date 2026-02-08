import React, { useState, useCallback, useRef, useEffect } from "react";
import { useCanvas } from "../hooks/useCanvas";
import type {
  CanvasComponent,
  CanvasInteraction,
} from "../../shared/canvas-types";

// ── Individual renderers ─────────────────────────────────────────────

function CText({ comp }: { comp: Extract<CanvasComponent, { type: "text" }> }) {
  const styles: Record<string, React.CSSProperties> = {
    title: {
      fontSize: 22,
      fontWeight: 700,
      color: "var(--color-text-primary)",
      marginBottom: 4,
    },
    subtitle: {
      fontSize: 16,
      fontWeight: 600,
      color: "var(--color-text-primary)",
      marginBottom: 2,
    },
    body: { fontSize: 14, color: "var(--color-text-primary)", lineHeight: 1.6 },
    caption: { fontSize: 12, color: "var(--color-text-tertiary)" },
    code: {
      fontSize: 13,
      fontFamily: "monospace",
      color: "var(--color-text-primary)",
      background: "var(--color-bg-code)",
      padding: "8px 12px",
      borderRadius: 8,
      whiteSpace: "pre-wrap",
      display: "block",
    },
  };
  return <div style={styles[comp.variant ?? "body"]}>{comp.content}</div>;
}

function CInput({
  comp,
  value,
  onChange,
}: {
  comp: Extract<CanvasComponent, { type: "input" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1" style={{ flex: 1 }}>
      <span
        className="text-xs font-medium"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {comp.label}
      </span>
      <input
        type={comp.inputType ?? "text"}
        placeholder={comp.placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg text-sm"
        style={{
          background: "var(--color-bg-input)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
          outline: "none",
        }}
        onFocus={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border-focus)")
        }
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border)")
        }
      />
    </label>
  );
}

function CTextarea({
  comp,
  value,
  onChange,
}: {
  comp: Extract<CanvasComponent, { type: "textarea" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span
        className="text-xs font-medium"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {comp.label}
      </span>
      <textarea
        placeholder={comp.placeholder}
        value={value}
        rows={comp.rows ?? 4}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg text-sm"
        style={{
          background: "var(--color-bg-input)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
          outline: "none",
          resize: "vertical",
        }}
        onFocus={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border-focus)")
        }
        onBlur={(e) =>
          (e.currentTarget.style.borderColor = "var(--color-border)")
        }
      />
    </label>
  );
}

function CSelect({
  comp,
  value,
  onChange,
}: {
  comp: Extract<CanvasComponent, { type: "select" }>;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1" style={{ flex: 1 }}>
      <span
        className="text-xs font-medium"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {comp.label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="px-3 py-2 rounded-lg text-sm"
        style={{
          background: "var(--color-bg-input)",
          border: "1px solid var(--color-border)",
          color: "var(--color-text-primary)",
          outline: "none",
        }}
      >
        <option value="">— Select —</option>
        {comp.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CCheckbox({
  comp,
  checked,
  onChange,
}: {
  comp: Extract<CanvasComponent, { type: "checkbox" }>;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 cursor-pointer py-1">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--color-bg-accent)" }}
      />
      <span className="text-sm" style={{ color: "var(--color-text-primary)" }}>
        {comp.label}
      </span>
    </label>
  );
}

const BUTTON_STYLES: Record<string, React.CSSProperties> = {
  primary: {
    background: "var(--color-bg-accent)",
    color: "var(--color-text-on-accent)",
    border: "1px solid transparent",
  },
  secondary: {
    background: "var(--color-bg-hover)",
    color: "var(--color-text-primary)",
    border: "1px solid var(--color-border)",
  },
  danger: {
    background: "#e02e2a",
    color: "#ffffff",
    border: "1px solid transparent",
  },
};

function CButton({
  comp,
  onClick,
}: {
  comp: Extract<CanvasComponent, { type: "button" }>;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 rounded-lg text-sm font-medium transition-opacity hover:opacity-90"
      style={BUTTON_STYLES[comp.variant ?? "primary"]}
    >
      {comp.label}
    </button>
  );
}

function CImage({
  comp,
}: {
  comp: Extract<CanvasComponent, { type: "image" }>;
}) {
  return (
    <img
      src={comp.src}
      alt={comp.alt ?? ""}
      style={{
        width: comp.width,
        height: comp.height,
        maxWidth: "100%",
        borderRadius: 8,
        border: "1px solid var(--color-border)",
      }}
    />
  );
}

function CTable({
  comp,
  selectedRows,
  onToggleRow,
}: {
  comp: Extract<CanvasComponent, { type: "table" }>;
  selectedRows: Set<number>;
  onToggleRow: (idx: number) => void;
}) {
  return (
    <div
      className="rounded-lg overflow-hidden"
      style={{ border: "1px solid var(--color-border)" }}
    >
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "var(--color-bg-hover)" }}>
            {comp.selectable && (
              <th style={{ width: 36, padding: "8px 4px" }} />
            )}
            {comp.columns.map((col) => (
              <th
                key={col.key}
                className="text-xs font-semibold text-left"
                style={{
                  padding: "8px 12px",
                  color: "var(--color-text-secondary)",
                  borderBottom: "1px solid var(--color-border)",
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comp.rows.map((row, idx) => (
            <tr
              key={idx}
              onClick={() => comp.selectable && onToggleRow(idx)}
              className="transition-colors"
              style={{
                background: selectedRows.has(idx)
                  ? "rgba(var(--color-accent-rgb), 0.1)"
                  : "transparent",
                cursor: comp.selectable ? "pointer" : "default",
                borderBottom:
                  idx < comp.rows.length - 1
                    ? "1px solid var(--color-border)"
                    : undefined,
              }}
            >
              {comp.selectable && (
                <td style={{ padding: "8px 4px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedRows.has(idx)}
                    onChange={() => onToggleRow(idx)}
                    style={{ accentColor: "var(--color-bg-accent)" }}
                  />
                </td>
              )}
              {comp.columns.map((col) => (
                <td
                  key={col.key}
                  className="text-sm"
                  style={{
                    padding: "8px 12px",
                    color: "var(--color-text-primary)",
                  }}
                >
                  {row[col.key] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Mermaid diagram renderer ─────────────────────────────────────────

let mermaidInitialized = false;

function CMermaid({
  comp,
}: {
  comp: Extract<CanvasComponent, { type: "mermaid" }>;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [svgHtml, setSvgHtml] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const panStart = useRef({ x: 0, y: 0 });

  useEffect(() => {
    let cancelled = false;

    async function renderDiagram() {
      try {
        const mermaid = (await import("mermaid")).default;

        if (!mermaidInitialized) {
          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            themeVariables: {
              primaryColor: "#6366f1",
              primaryTextColor: "#e2e8f0",
              primaryBorderColor: "#4f46e5",
              lineColor: "#64748b",
              secondaryColor: "#1e293b",
              tertiaryColor: "#0f172a",
              background: "#1e1e2e",
              mainBkg: "#1e293b",
              nodeBorder: "#4f46e5",
              clusterBkg: "#1e293b",
              titleColor: "#e2e8f0",
              edgeLabelBackground: "#1e293b",
            },
            er: { useMaxWidth: false },
            flowchart: { useMaxWidth: false, curve: "basis" },
            sequence: { useMaxWidth: false },
          });
          mermaidInitialized = true;
        }

        const id = `mermaid-${comp.id}-${Date.now()}`;
        const { svg } = await mermaid.render(id, comp.code);

        if (!cancelled) {
          setSvgHtml(svg);
          setError("");
        }
      } catch (err: any) {
        if (!cancelled) {
          setError(err.message || "Failed to render diagram");
          setSvgHtml("");
        }
      }
    }

    renderDiagram();
    return () => {
      cancelled = true;
    };
  }, [comp.code, comp.id]);

  // Wheel zoom (non-passive)
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setZoom((prev) => {
        const next = Math.max(0.1, Math.min(8, prev * factor));
        // Zoom toward mouse
        setPan((p) => ({
          x: mx - (mx - p.x) * (next / prev),
          y: my - (my - p.y) * (next / prev),
        }));
        return next;
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Mouse drag pan
  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      dragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      panStart.current = { ...pan };
      e.currentTarget.style.cursor = "grabbing";
    },
    [pan],
  );

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({
      x: panStart.current.x + (e.clientX - dragStart.current.x),
      y: panStart.current.y + (e.clientY - dragStart.current.y),
    });
  }, []);

  const onMouseUp = useCallback((e: React.MouseEvent) => {
    dragging.current = false;
    e.currentTarget.style.cursor = "grab";
  }, []);

  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  if (error) {
    return (
      <div
        className="rounded-lg p-4"
        style={{
          background: "var(--color-bg-surface)",
          border: "1px solid var(--color-border-error, #ef4444)",
        }}
      >
        <div
          className="text-xs font-medium mb-2"
          style={{ color: "var(--color-text-error, #ef4444)" }}
        >
          Mermaid render error
        </div>
        <pre
          className="text-xs"
          style={{
            color: "var(--color-text-tertiary)",
            fontFamily: "monospace",
            whiteSpace: "pre-wrap",
          }}
        >
          {error}
        </pre>
        <details className="mt-2">
          <summary
            className="text-xs cursor-pointer"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Show source
          </summary>
          <pre
            className="text-xs mt-1 p-2 rounded"
            style={{
              background: "var(--color-bg-code)",
              color: "var(--color-text-primary)",
              fontFamily: "monospace",
              whiteSpace: "pre-wrap",
            }}
          >
            {comp.code}
          </pre>
        </details>
      </div>
    );
  }

  return (
    <div
      className="relative rounded-lg"
      style={{ border: "1px solid var(--color-border)" }}
    >
      {/* Zoom controls */}
      <div
        className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded-lg px-1 py-0.5"
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
        }}
      >
        <button
          onClick={() => setZoom((z) => Math.min(8, z * 1.3))}
          className="px-2 py-0.5 rounded text-xs font-mono"
          style={{ color: "var(--color-text-primary)" }}
          title="Zoom in"
        >
          +
        </button>
        <span
          className="text-xs px-1 font-mono"
          style={{
            color: "var(--color-text-tertiary)",
            minWidth: 40,
            textAlign: "center",
          }}
        >
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={() => setZoom((z) => Math.max(0.1, z / 1.3))}
          className="px-2 py-0.5 rounded text-xs font-mono"
          style={{ color: "var(--color-text-primary)" }}
          title="Zoom out"
        >
          −
        </button>
        <button
          onClick={resetView}
          className="px-2 py-0.5 rounded text-xs"
          style={{ color: "var(--color-text-tertiary)" }}
          title="Reset view"
        >
          ⟳
        </button>
      </div>

      {/* Pannable/zoomable viewport */}
      <div
        ref={outerRef}
        className="overflow-hidden rounded-lg"
        style={{
          background: "var(--color-bg-surface)",
          cursor: "grab",
          minHeight: 300,
        }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <div
          ref={innerRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: "0 0",
            padding: 16,
            display: "inline-block",
          }}
          dangerouslySetInnerHTML={{ __html: svgHtml }}
        />
      </div>
    </div>
  );
}

function CDivider() {
  return (
    <hr
      style={{
        border: "none",
        borderTop: "1px solid var(--color-border)",
        margin: "4px 0",
      }}
    />
  );
}

// ── Recursive renderer ───────────────────────────────────────────────

function ComponentRenderer({
  comp,
  values,
  selectedRows,
  onValueChange,
  onToggleRow,
  onButtonClick,
}: {
  comp: CanvasComponent;
  values: Record<string, string | number | boolean>;
  selectedRows: Record<string, Set<number>>;
  onValueChange: (id: string, value: string | number | boolean) => void;
  onToggleRow: (tableId: string, idx: number) => void;
  onButtonClick: (action: string) => void;
}) {
  switch (comp.type) {
    case "text":
      return <CText comp={comp} />;
    case "input":
      return (
        <CInput
          comp={comp}
          value={(values[comp.id] as string) ?? comp.value ?? ""}
          onChange={(v) => onValueChange(comp.id, v)}
        />
      );
    case "textarea":
      return (
        <CTextarea
          comp={comp}
          value={(values[comp.id] as string) ?? comp.value ?? ""}
          onChange={(v) => onValueChange(comp.id, v)}
        />
      );
    case "select":
      return (
        <CSelect
          comp={comp}
          value={(values[comp.id] as string) ?? comp.value ?? ""}
          onChange={(v) => onValueChange(comp.id, v)}
        />
      );
    case "checkbox":
      return (
        <CCheckbox
          comp={comp}
          checked={(values[comp.id] as boolean) ?? comp.checked ?? false}
          onChange={(v) => onValueChange(comp.id, v)}
        />
      );
    case "button":
      return <CButton comp={comp} onClick={() => onButtonClick(comp.action)} />;
    case "image":
      return <CImage comp={comp} />;
    case "table":
      return (
        <CTable
          comp={comp}
          selectedRows={selectedRows[comp.id] ?? new Set()}
          onToggleRow={(idx) => onToggleRow(comp.id, idx)}
        />
      );
    case "mermaid":
      return <CMermaid comp={comp} />;
    case "divider":
      return <CDivider />;
    case "row":
      return (
        <div className="flex items-end gap-3" style={{ gap: comp.gap ?? 12 }}>
          {comp.children.map((child) => (
            <ComponentRenderer
              key={child.id}
              comp={child}
              values={values}
              selectedRows={selectedRows}
              onValueChange={onValueChange}
              onToggleRow={onToggleRow}
              onButtonClick={onButtonClick}
            />
          ))}
        </div>
      );
    case "card":
      return (
        <div
          className="rounded-xl p-4 flex flex-col gap-3"
          style={{
            background: "var(--color-bg-surface)",
            border: "1px solid var(--color-border)",
          }}
        >
          {comp.title && (
            <div
              className="text-sm font-semibold"
              style={{ color: "var(--color-text-primary)" }}
            >
              {comp.title}
            </div>
          )}
          {comp.children.map((child) => (
            <ComponentRenderer
              key={child.id}
              comp={child}
              values={values}
              selectedRows={selectedRows}
              onValueChange={onValueChange}
              onToggleRow={onToggleRow}
              onButtonClick={onButtonClick}
            />
          ))}
        </div>
      );
    default:
      return null;
  }
}

// ── Main CanvasView ──────────────────────────────────────────────────

export function CanvasView() {
  const { spec, submitInteraction, clear } = useCanvas();
  const [values, setValues] = useState<
    Record<string, string | number | boolean>
  >({});
  const [selectedRows, setSelectedRows] = useState<Record<string, Set<number>>>(
    {},
  );
  const prevSpecId = useRef<string | null>(null);

  // Reset form state when canvas spec changes
  if (spec && spec.id !== prevSpecId.current) {
    prevSpecId.current = spec?.id ?? null;
    // Initialize default values from spec
    const defaults: Record<string, string | number | boolean> = {};
    const collectDefaults = (components: CanvasComponent[]) => {
      for (const c of components) {
        if (c.type === "input" && c.value) defaults[c.id] = c.value;
        if (c.type === "textarea" && c.value) defaults[c.id] = c.value;
        if (c.type === "select" && c.value) defaults[c.id] = c.value;
        if (c.type === "checkbox") defaults[c.id] = c.checked ?? false;
        if (c.type === "row" || c.type === "card") collectDefaults(c.children);
      }
    };
    collectDefaults(spec.components);
    setValues(defaults);
    setSelectedRows({});
  }

  const handleValueChange = useCallback(
    (id: string, value: string | number | boolean) => {
      setValues((prev) => ({ ...prev, [id]: value }));
    },
    [],
  );

  const handleToggleRow = useCallback((tableId: string, idx: number) => {
    setSelectedRows((prev) => {
      const set = new Set(prev[tableId] ?? []);
      if (set.has(idx)) set.delete(idx);
      else set.add(idx);
      return { ...prev, [tableId]: set };
    });
  }, []);

  const handleButtonClick = useCallback(
    (action: string) => {
      if (!spec) return;

      // Collect selected rows
      const allSelectedRows: Record<string, number[]> = {};
      for (const [tableId, set] of Object.entries(selectedRows)) {
        if (set.size > 0) allSelectedRows[tableId] = [...set];
      }

      const interaction: CanvasInteraction = {
        canvasId: spec.id,
        action,
        values,
        selectedRows: Object.values(allSelectedRows).flat(),
      };

      submitInteraction(interaction);
    },
    [spec, values, selectedRows, submitInteraction],
  );

  // Empty state
  if (!spec) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div
          className="flex flex-col items-center gap-4"
          style={{ maxWidth: 480 }}
        >
          <div
            className="flex items-center justify-center w-12 h-12 rounded-xl"
            style={{ background: "var(--color-bg-hover)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <rect
                x="3"
                y="3"
                width="18"
                height="18"
                rx="2"
                stroke="currentColor"
                strokeWidth="1.5"
                style={{ color: "var(--color-text-tertiary)" }}
              />
              <path
                d="M3 9h18M9 3v18"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                style={{ color: "var(--color-text-tertiary)" }}
              />
            </svg>
          </div>
          <h2
            className="text-lg font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            Canvas
          </h2>
          <p
            className="text-sm text-center"
            style={{ color: "var(--color-text-tertiary)", lineHeight: 1.6 }}
          >
            Ask Tau to create an interactive UI — forms, tables, search
            interfaces, or any structured input. Tau will render it here for you
            to interact with.
          </p>
          <p
            className="text-xs text-center"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Try: &quot;Create a form to search for flights&quot; or &quot;Build
            a settings panel&quot;
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-5 py-3 shrink-0"
        style={{ borderBottom: "1px solid var(--color-border)" }}
      >
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full"
            style={{ background: "var(--color-bg-accent)" }}
          />
          <span
            className="text-sm font-semibold"
            style={{ color: "var(--color-text-primary)" }}
          >
            {spec.title || "Canvas"}
          </span>
          <span
            className="text-xs"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            {spec.components.length} component
            {spec.components.length !== 1 ? "s" : ""}
          </span>
        </div>
        <button
          onClick={clear}
          className="px-2 py-1 rounded-md text-xs transition-colors"
          style={{
            color: "var(--color-text-tertiary)",
            border: "1px solid var(--color-border)",
            background: "transparent",
          }}
          onMouseEnter={(e) =>
            (e.currentTarget.style.background = "var(--color-bg-hover)")
          }
          onMouseLeave={(e) =>
            (e.currentTarget.style.background = "transparent")
          }
        >
          Clear
        </button>
      </div>

      {/* Components */}
      <div className="flex-1 overflow-y-auto">
        <div
          className="flex flex-col gap-4 px-6 py-5"
          style={{ maxWidth: "100%" }}
        >
          {spec.components.map((comp) => (
            <ComponentRenderer
              key={comp.id}
              comp={comp}
              values={values}
              selectedRows={selectedRows}
              onValueChange={handleValueChange}
              onToggleRow={handleToggleRow}
              onButtonClick={handleButtonClick}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
