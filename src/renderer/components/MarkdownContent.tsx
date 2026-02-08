import React from "react";

interface MarkdownContentProps {
  content: string;
}

/**
 * Lightweight markdown renderer.
 * Handles: code blocks, inline code, bold, italic, headings, lists, links.
 * For a production app, swap this with react-markdown + remark-gfm.
 */
export function MarkdownContent({ content }: MarkdownContentProps) {
  const blocks = parseBlocks(content);

  return (
    <div className="markdown-content" style={{ color: "var(--color-text-primary)" }}>
      {blocks.map((block, i) => (
        <React.Fragment key={i}>{renderBlock(block)}</React.Fragment>
      ))}
    </div>
  );
}

type Block =
  | { type: "code"; lang?: string; content: string }
  | { type: "paragraph"; content: string }
  | { type: "heading"; level: number; content: string }
  | { type: "table"; headers: string[]; alignments: ("left" | "center" | "right" | null)[]; rows: string[][] }
  | { type: "list"; ordered: boolean; items: string[] };

function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code block
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      blocks.push({ type: "code", lang: lang || undefined, content: codeLines.join("\n") });
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        content: headingMatch[2],
      });
      i++;
      continue;
    }

    // Table (line with pipes, followed by separator line)
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*[-:]+[-|:\s]+$/.test(lines[i + 1])) {
      const parseRow = (row: string) =>
        row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
      const headers = parseRow(line);
      const sepCells = parseRow(lines[i + 1]);
      const alignments = sepCells.map((c): "left" | "center" | "right" | null => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        if (left) return "left";
        return null;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", headers, alignments, rows });
      continue;
    }

    // Unordered list
    if (/^[\s]*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    // Ordered list
    if (/^[\s]*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[\s]*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\s]*\d+[.)]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: true, items });
      continue;
    }

    // Paragraph (collect consecutive non-empty lines)
    if (line.trim()) {
      const paraLines: string[] = [];
      while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !lines[i].match(/^#{1,6}\s/)) {
        paraLines.push(lines[i]);
        i++;
      }
      blocks.push({ type: "paragraph", content: paraLines.join("\n") });
      continue;
    }

    i++;
  }

  return blocks;
}

function renderBlock(block: Block): React.ReactNode {
  switch (block.type) {
    case "code":
      return (
        <div className="my-3 rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
          {block.lang && (
            <div
              className="px-3 py-1.5 text-xs font-mono"
              style={{
                background: "var(--color-bg-code)",
                color: "var(--color-text-tertiary)",
                borderBottom: "1px solid var(--color-border)",
              }}
            >
              {block.lang}
            </div>
          )}
          <pre
            className="p-3 overflow-x-auto select-text text-xs leading-5"
            style={{
              background: "var(--color-bg-code)",
              fontFamily: "var(--font-mono)",
              color: "var(--color-text-primary)",
              margin: 0,
            }}
          >
            <code>{block.content}</code>
          </pre>
        </div>
      );

    case "heading": {
      const sizes: Record<number, string> = {
        1: "text-xl font-bold mt-6 mb-3",
        2: "text-lg font-semibold mt-5 mb-2",
        3: "text-base font-semibold mt-4 mb-2",
        4: "text-sm font-semibold mt-3 mb-1",
        5: "text-sm font-medium mt-2 mb-1",
        6: "text-xs font-medium mt-2 mb-1",
      };
      return (
        <div className={sizes[block.level] || sizes[3]}>
          {renderInline(block.content)}
        </div>
      );
    }

    case "table":
      return (
        <div className="my-3 overflow-x-auto rounded-lg" style={{ border: "1px solid var(--color-border)" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--color-bg-code)" }}>
                {block.headers.map((h, j) => (
                  <th
                    key={j}
                    className="px-3 py-2 font-semibold text-left"
                    style={{
                      textAlign: block.alignments[j] || "left",
                      borderBottom: "2px solid var(--color-border)",
                      color: "var(--color-text-primary)",
                    }}
                  >
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr
                  key={ri}
                  style={{
                    background: ri % 2 === 0 ? "transparent" : "var(--color-bg-code)",
                    borderBottom: "1px solid var(--color-border)",
                  }}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-1.5"
                      style={{
                        textAlign: block.alignments[ci] || "left",
                        color: "var(--color-text-primary)",
                      }}
                    >
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );

    case "list":
      if (block.ordered) {
        return (
          <ol className="my-2 pl-6 list-decimal leading-relaxed">
            {block.items.map((item, j) => (
              <li key={j} className="my-0.5">{renderInline(item)}</li>
            ))}
          </ol>
        );
      }
      return (
        <ul className="my-2 pl-6 list-disc leading-relaxed">
          {block.items.map((item, j) => (
            <li key={j} className="my-0.5">{renderInline(item)}</li>
          ))}
        </ul>
      );

    case "paragraph":
      return (
        <p className="my-2 leading-relaxed">
          {renderInline(block.content)}
        </p>
      );
  }
}

function renderInline(text: string): React.ReactNode {
  // Simple inline formatting
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code
          key={key++}
          className="px-1.5 py-0.5 rounded text-xs"
          style={{
            background: "var(--color-bg-code)",
            fontFamily: "var(--font-mono)",
            color: "var(--color-text-accent)",
          }}
        >
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*(.+?)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Link
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a
          key={key++}
          href={linkMatch[2]}
          style={{ color: "var(--color-text-accent)" }}
          className="underline"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Regular character
    // Find next special character
    const nextSpecial = remaining.search(/[`*[]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts;
}
