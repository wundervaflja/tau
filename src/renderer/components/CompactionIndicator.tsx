import React from "react";

interface CompactionIndicatorProps {
  reason?: string;
}

export function CompactionIndicator({ reason }: CompactionIndicatorProps) {
  const reasonText =
    reason === "overflow"
      ? "Context overflow detected. "
      : "";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 mx-4 my-2 rounded-lg animate-fade-in"
      style={{
        background: "var(--color-bg-tool)",
        border: "1px solid var(--color-border)",
      }}
    >
      {/* Animated dots spinner */}
      <div className="flex items-center gap-1 shrink-0">
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--color-text-accent)",
            animation: "compaction-pulse 1.4s ease-in-out infinite",
            animationDelay: "0s",
          }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--color-text-accent)",
            animation: "compaction-pulse 1.4s ease-in-out infinite",
            animationDelay: "0.2s",
          }}
        />
        <span
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--color-text-accent)",
            animation: "compaction-pulse 1.4s ease-in-out infinite",
            animationDelay: "0.4s",
          }}
        />
      </div>

      <span
        className="text-sm"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {reasonText}Compacting conversation...
      </span>
    </div>
  );
}

interface CompactionSummaryProps {
  summary: string;
  tokensBefore?: number;
}

export function CompactionSummary({ summary, tokensBefore }: CompactionSummaryProps) {
  const [expanded, setExpanded] = React.useState(false);

  return (
    <div
      className="mx-4 my-2 rounded-lg overflow-hidden animate-fade-in"
      style={{
        background: "var(--color-bg-tool)",
        border: "1px solid var(--color-border)",
      }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors"
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = "var(--color-bg-hover)")
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = "")}
      >
        {/* Compaction line decoration */}
        <div
          className="flex-1 h-px"
          style={{ background: "var(--color-border)" }}
        />
        <span
          className="shrink-0 px-2 text-xs font-medium"
          style={{ color: "var(--color-text-tertiary)" }}
        >
          Conversation compacted
          {tokensBefore ? ` (${Math.round(tokensBefore / 1000)}k tokens)` : ""}
        </span>
        <div
          className="flex-1 h-px"
          style={{ background: "var(--color-border)" }}
        />

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

      {expanded && (
        <div
          className="px-4 pb-3"
          style={{ borderTop: "1px solid var(--color-border)" }}
        >
          <div
            className="text-xs font-medium mb-1 mt-2"
            style={{ color: "var(--color-text-tertiary)" }}
          >
            Summary
          </div>
          <pre
            className="text-xs p-2 rounded-md whitespace-pre-wrap select-text"
            style={{
              background: "var(--color-bg-code)",
              color: "var(--color-text-secondary)",
              maxHeight: "200px",
              overflowY: "auto",
            }}
          >
            {summary}
          </pre>
        </div>
      )}
    </div>
  );
}
