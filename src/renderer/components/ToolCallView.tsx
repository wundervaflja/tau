import React, { useState } from "react";
import type { ToolCall } from "../hooks/useAgent";

interface ToolCallViewProps {
  tool: ToolCall;
}



export function ToolCallView({ tool }: ToolCallViewProps) {
  const [expanded, setExpanded] = useState(false);
  // Format tool input for display
  const inputSummary = formatInput(tool.name, tool.input);

  return (
    <div
      className="rounded-lg overflow-hidden transition-colors animate-fade-in"
      style={{
        background: "var(--color-bg-tool)",
        border: "1px solid var(--color-border)",
      }}
    >
      {/* Header - always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors"
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--color-bg-hover)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
      >
        {/* Status indicator */}
        <div className="shrink-0">
          {!tool.isComplete ? (
            <div
              className="w-3 h-3 rounded-full animate-pulse"
              style={{ background: "var(--color-text-accent)" }}
            />
          ) : tool.isError ? (
            <div
              className="w-3 h-3 rounded-full"
              style={{ background: "var(--color-text-error)" }}
            />
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M3 8l3.5 3.5L13 5"
                stroke="var(--color-text-success)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {/* Name */}
        <span
          className="font-medium truncate"
          style={{ color: "var(--color-text-primary)" }}
        >
          {tool.name}
        </span>

        {/* Input summary */}
        <span
          className="truncate flex-1 font-mono text-xs"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          {inputSummary}
        </span>

        {/* Expand arrow */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          className="shrink-0 transition-transform"
          style={{
            transform: expanded ? "rotate(90deg)" : "",
            color: "var(--color-text-tertiary)",
          }}
        >
          <path
            d="M6 4l4 4-4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {/* Expanded content */}
      {expanded && (
        <div
          className="px-3 pb-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          {/* Input */}
          {tool.input && (
            <div className="mt-2">
              <div
                className="text-xs font-medium mb-1"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Input
              </div>
              <pre
                className="text-xs font-mono p-2 rounded-md overflow-x-auto select-text"
                style={{
                  background: "var(--color-bg-code)",
                  color: "var(--color-text-secondary)",
                  maxHeight: "200px",
                  overflowY: "auto",
                }}
              >
                {typeof tool.input === "string"
                  ? tool.input
                  : JSON.stringify(tool.input, null, 2)}
              </pre>
            </div>
          )}

          {/* Output */}
          {tool.output && (
            <div className="mt-2">
              <div
                className="text-xs font-medium mb-1"
                style={{ color: "var(--color-text-tertiary)" }}
              >
                Output
              </div>
              <pre
                className="text-xs font-mono p-2 rounded-md overflow-x-auto select-text"
                style={{
                  background: "var(--color-bg-code)",
                  color: tool.isError
                    ? "var(--color-text-error)"
                    : "var(--color-text-secondary)",
                  maxHeight: "300px",
                  overflowY: "auto",
                }}
              >
                {tool.output}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatInput(toolName: string, input: any): string {
  if (!input) return "";
  if (typeof input === "string") return input;

  switch (toolName.toLowerCase()) {
    case "read":
      return input.path || "";
    case "bash":
      return input.command || "";
    case "edit":
      return input.path || "";
    case "write":
      return input.path || "";
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}
