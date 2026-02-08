/**
 * Canvas component spec — declarative UI that the agent can render.
 *
 * The agent calls `render_canvas` with a CanvasSpec, which the renderer
 * turns into interactive React components. User interactions fire events
 * back to the agent as chat messages.
 */

// ── Primitive widget types ───────────────────────────────────────────

export interface CanvasText {
  type: "text";
  id: string;
  content: string;
  variant?: "title" | "subtitle" | "body" | "caption" | "code";
}

export interface CanvasInput {
  type: "input";
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  inputType?: "text" | "number" | "email" | "url" | "date" | "time";
}

export interface CanvasTextarea {
  type: "textarea";
  id: string;
  label: string;
  placeholder?: string;
  value?: string;
  rows?: number;
}

export interface CanvasSelect {
  type: "select";
  id: string;
  label: string;
  options: { label: string; value: string }[];
  value?: string;
}

export interface CanvasCheckbox {
  type: "checkbox";
  id: string;
  label: string;
  checked?: boolean;
}

export interface CanvasButton {
  type: "button";
  id: string;
  label: string;
  variant?: "primary" | "secondary" | "danger";
  /** When clicked, this action string + current form values are sent to the agent */
  action: string;
}

export interface CanvasImage {
  type: "image";
  id: string;
  src: string;
  alt?: string;
  width?: number;
  height?: number;
}

export interface CanvasTable {
  type: "table";
  id: string;
  columns: { key: string; label: string }[];
  rows: Record<string, string | number>[];
  /** If set, rows are selectable and selection is sent with button actions */
  selectable?: boolean;
}

export interface CanvasDivider {
  type: "divider";
  id: string;
}

export interface CanvasRow {
  type: "row";
  id: string;
  children: CanvasComponent[];
  gap?: number;
}

export interface CanvasCard {
  type: "card";
  id: string;
  title?: string;
  children: CanvasComponent[];
}

export interface CanvasMermaid {
  type: "mermaid";
  id: string;
  /** Mermaid diagram definition (e.g. erDiagram, flowchart, sequenceDiagram, etc.) */
  code: string;
}

// ── Union ────────────────────────────────────────────────────────────

export type CanvasComponent =
  | CanvasText
  | CanvasInput
  | CanvasTextarea
  | CanvasSelect
  | CanvasCheckbox
  | CanvasButton
  | CanvasImage
  | CanvasTable
  | CanvasDivider
  | CanvasRow
  | CanvasCard
  | CanvasMermaid;

// ── Top-level spec ───────────────────────────────────────────────────

export interface CanvasSpec {
  /** Unique id for this canvas render (allows updates) */
  id: string;
  title?: string;
  components: CanvasComponent[];
}

// ── Events sent back to agent ────────────────────────────────────────

export interface CanvasInteraction {
  canvasId: string;
  action: string;
  values: Record<string, string | number | boolean>;
  /** For tables with selectable rows */
  selectedRows?: number[];
}
