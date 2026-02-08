import { useState, useEffect, useCallback } from "react";
import type { CanvasSpec, CanvasInteraction } from "../../shared/canvas-types";
import { bridge } from "../bridge";

/**
 * Global canvas state — the latest spec pushed by the agent.
 * Uses a custom event bus so both useAgent (producer) and CanvasView (consumer) stay decoupled.
 */

let currentSpec: CanvasSpec | null = null;

/** Called from useAgent when a canvas_update event arrives. */
export function pushCanvasSpec(spec: CanvasSpec): void {
  currentSpec = spec;
  window.dispatchEvent(new CustomEvent("canvas:update", { detail: spec }));
}

/** Clear canvas. */
export function clearCanvas(): void {
  currentSpec = null;
  window.dispatchEvent(new CustomEvent("canvas:update", { detail: null }));
}

export function useCanvas() {
  const [spec, setSpec] = useState<CanvasSpec | null>(currentSpec);

  useEffect(() => {
    function onUpdate(e: Event) {
      setSpec((e as CustomEvent).detail);
    }
    window.addEventListener("canvas:update", onUpdate);
    return () => window.removeEventListener("canvas:update", onUpdate);
  }, []);

  /** Spawn a subagent to handle the canvas interaction. */
  const submitInteraction = useCallback(async (interaction: CanvasInteraction) => {
    const parts: string[] = [
      `[Canvas interaction]`,
      `Canvas: ${interaction.canvasId}`,
      `Action: ${interaction.action}`,
    ];

    const entries = Object.entries(interaction.values);
    if (entries.length > 0) {
      parts.push("Values:");
      for (const [key, value] of entries) {
        parts.push(`  ${key}: ${JSON.stringify(value)}`);
      }
    }

    if (interaction.selectedRows && interaction.selectedRows.length > 0) {
      parts.push(`Selected rows: ${interaction.selectedRows.join(", ")}`);
    }

    const task = parts.join("\n");
    const name = `canvas:${interaction.action}`;

    try {
      await bridge.spawnSubagents([{ name, task }]);
    } catch (err) {
      // Fallback to main agent if subagent spawn fails
      console.warn("[canvas] Subagent spawn failed, falling back to prompt:", err);
      await bridge.prompt(task);
    }
  }, []);

  const clear = useCallback(() => clearCanvas(), []);

  return { spec, submitInteraction, clear };
}
