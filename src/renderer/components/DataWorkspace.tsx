import React, { useRef, useState, useCallback } from "react";
import { parseCSV, parseJSON, isNumericColumn, columnStats } from "../../shared/data-parsers";

interface DataWorkspaceProps {
  onSend: (text: string) => void;
}

interface LoadedDataset {
  id: string;
  name: string;
  type: string;
  size: number;
  headers?: string[];
  rows?: string[][];
  rawJson?: any;
  rowCount?: number;
  colCount?: number;
}

function detectTypeFromName(name: string, mime?: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".csv") || mime === "text/csv") return "CSV";
  if (n.endsWith(".json") || mime === "application/json") return "JSON";
  if (n.endsWith(".tsv")) return "TSV";
  if (n.endsWith(".sqlite") || n.endsWith(".db")) return "SQLite";
  if (n.endsWith(".parquet")) return "Parquet";
  return "Unknown";
}

export function DataWorkspace({ onSend }: DataWorkspaceProps) {
  const [dragOver, setDragOver] = useState(false);
  const [datasets, setDatasets] = useState<LoadedDataset[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleRows, setVisibleRows] = useState<Record<string, number>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const readAndParseFile = useCallback((file: File) => {
    const type = detectTypeFromName(file.name, file.type);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (type === "CSV" || type === "TSV" || type === "JSON") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        let dataset: LoadedDataset;

        if (type === "CSV" || type === "TSV") {
          const delimiter = type === "TSV" ? "\t" : ",";
          const parsed = parseCSV(text, delimiter);
          dataset = {
            id, name: file.name, type, size: file.size,
            headers: parsed.headers, rows: parsed.rows,
            rowCount: parsed.rows.length, colCount: parsed.headers.length,
          };
        } else {
          // JSON
          try {
            const parsed = parseJSON(text);
            dataset = {
              id, name: file.name, type, size: file.size,
              headers: parsed.headers, rows: parsed.rows,
              rawJson: parsed.raw,
              rowCount: parsed.rows.length, colCount: parsed.headers.length,
            };
          } catch {
            dataset = { id, name: file.name, type, size: file.size };
          }
        }

        setDatasets((prev) => [dataset, ...prev]);
        setExpandedId(id);
      };
      reader.readAsText(file);
    } else {
      // Non-parseable type -- just record metadata
      setDatasets((prev) => [{ id, name: file.name, type, size: file.size }, ...prev]);
    }
  }, []);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(readAndParseFile);
  }

  function removeDataset(id: string) {
    setDatasets((prev) => prev.filter((d) => d.id !== id));
    if (expandedId === id) setExpandedId(null);
  }

  const DEFAULT_VISIBLE = 100;

  function getVisibleRowCount(id: string): number {
    return visibleRows[id] || DEFAULT_VISIBLE;
  }

  function showMore(id: string) {
    setVisibleRows((prev) => ({ ...prev, [id]: (prev[id] || DEFAULT_VISIBLE) + 100 }));
  }

  return (
    <div style={{ padding: 24, width: "100%", boxSizing: "border-box", display: "flex", justifyContent: "center" }}>
      <div style={{ width: "100%", maxWidth: 920 }}>
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--color-text-primary)" }}>Data Workspace</div>
          <div style={{ fontSize: 13, color: "var(--color-text-secondary)", marginTop: 2 }}>Load, query, and transform data</div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
          style={{
            border: dragOver ? "2px dashed var(--color-border-focus)" : "2px dashed var(--color-border)",
            borderRadius: 10,
            padding: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            background: dragOver ? "var(--color-bg-hover)" : "var(--color-bg-elevated)",
            marginBottom: 16,
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 4 }}>Load Data</div>
            <div style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              Drop files here or{" "}
              <button
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
                  background: "transparent", color: "var(--color-text-secondary)", cursor: "pointer", fontSize: 13,
                }}
              >
                Browse
              </button>
            </div>
            <div style={{ fontSize: 12, color: "var(--color-text-tertiary)", marginTop: 6 }}>
              Supports: CSV, JSON, TSV, SQLite, Parquet
            </div>
          </div>
          <div style={{ fontSize: 12, color: "var(--color-text-tertiary)" }}>
            {datasets.length > 0 ? `${datasets.length} dataset${datasets.length !== 1 ? "s" : ""} loaded` : "No files loaded"}
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          style={{ display: "none" }}
          onChange={(e) => { handleFiles(e.target.files); if (fileInputRef.current) fileInputRef.current.value = ""; }}
          multiple
          accept=".csv,.json,.tsv,.sqlite,.db,.parquet"
        />

        {/* Quick Actions */}
        <div style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", padding: 12, borderRadius: 10, marginBottom: 16 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--color-text-primary)" }}>Quick Actions</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { label: "Analyze CSV", prompt: "Analyze the CSV file I just loaded and give me a summary of columns, types, and basic statistics." },
              { label: "JSON to table", prompt: "Convert the JSON data into a readable table format." },
              { label: "Run SQL query", prompt: "I want to run a SQL query on my data. Help me write and execute it." },
              { label: "Summarize data", prompt: "Give me a comprehensive summary of the loaded dataset including row count, column types, missing values, and key statistics." },
            ].map((a) => (
              <button
                key={a.label}
                onClick={() => onSend(a.prompt)}
                style={{
                  padding: "8px 12px", borderRadius: 8, fontSize: 13, cursor: "pointer",
                  border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text-secondary)",
                }}
              >
                {a.label}
              </button>
            ))}
          </div>
        </div>

        {/* Loaded Datasets */}
        <div style={{ background: "var(--color-bg-elevated)", border: "1px solid var(--color-border)", padding: 12, borderRadius: 10 }}>
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "var(--color-text-primary)" }}>Loaded Datasets</div>

          {datasets.length === 0 ? (
            <div style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>
              No datasets loaded yet. Drop a data file above to get started.
            </div>
          ) : (
            datasets.map((d) => {
              const isExpanded = expandedId === d.id;
              const maxRows = getVisibleRowCount(d.id);
              const hasData = d.headers && d.rows && d.rows.length > 0;

              return (
                <div key={d.id} style={{ borderBottom: "1px solid var(--color-border)", paddingBottom: 8, marginBottom: 8 }}>
                  {/* Dataset header */}
                  <div
                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: hasData ? "pointer" : "default", padding: "6px 0" }}
                    onClick={() => hasData && setExpandedId(isExpanded ? null : d.id)}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--color-text-primary)" }}>
                        {hasData && (
                          <span style={{ display: "inline-block", width: 16, fontSize: 11, color: "var(--color-text-tertiary)" }}>
                            {isExpanded ? "v" : ">"}
                          </span>
                        )}
                        {d.name}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginTop: 2 }}>
                        {d.type} -- {Math.round(d.size / 1024)} KB
                        {d.rowCount != null && ` -- ${d.rowCount} rows`}
                        {d.colCount != null && `, ${d.colCount} columns`}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); removeDataset(d.id); }}
                      style={{
                        padding: "4px 10px", borderRadius: 6, border: "1px solid var(--color-border)",
                        background: "transparent", color: "var(--color-text-error)", cursor: "pointer", fontSize: 12,
                      }}
                    >
                      Remove
                    </button>
                  </div>

                  {/* Data table (expanded) */}
                  {isExpanded && hasData && (
                    <div style={{ marginTop: 8 }}>
                      <DataTable headers={d.headers!} rows={d.rows!} maxRows={maxRows} />
                      {d.rows!.length > maxRows && (
                        <button
                          onClick={() => showMore(d.id)}
                          style={{
                            marginTop: 6, padding: "6px 12px", borderRadius: 6, border: "1px solid var(--color-border)",
                            background: "transparent", color: "var(--color-text-accent)", cursor: "pointer", fontSize: 12,
                          }}
                        >
                          Show more ({d.rows!.length - maxRows} remaining)
                        </button>
                      )}
                      {/* Numeric column stats */}
                      <ColumnStatsBar headers={d.headers!} rows={d.rows!} />
                    </div>
                  )}

                  {/* Raw JSON fallback */}
                  {isExpanded && d.rawJson !== undefined && (
                    <pre style={{
                      marginTop: 8, padding: 12, borderRadius: 8,
                      background: "var(--color-bg-code)", color: "var(--color-text-primary)",
                      fontSize: 12, fontFamily: "var(--font-mono)", overflow: "auto", maxHeight: 300,
                    }}>
                      {JSON.stringify(d.rawJson, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

/* ---- DataTable sub-component ---- */

function DataTable({ headers, rows, maxRows }: { headers: string[]; rows: string[][]; maxRows: number }) {
  const displayRows = rows.slice(0, maxRows);

  return (
    <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--color-border)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, fontFamily: "var(--font-mono)" }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th
                key={i}
                style={{
                  textAlign: "left", padding: "6px 10px",
                  borderBottom: "2px solid var(--color-border)",
                  background: "var(--color-bg-active)",
                  color: "var(--color-text-primary)",
                  fontWeight: 600, whiteSpace: "nowrap",
                  position: "sticky", top: 0, zIndex: 1,
                }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map((row, ri) => (
            <tr key={ri} style={{ background: ri % 2 === 0 ? "transparent" : "var(--color-bg-hover)" }}>
              {headers.map((_, ci) => (
                <td
                  key={ci}
                  style={{
                    padding: "4px 10px",
                    borderBottom: "1px solid var(--color-border)",
                    color: "var(--color-text-secondary)",
                    whiteSpace: "nowrap", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {row[ci] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: "var(--color-text-tertiary)", padding: "6px 10px" }}>
        Showing {Math.min(displayRows.length, rows.length)} of {rows.length} rows, {headers.length} columns
      </div>
    </div>
  );
}

/* ---- Column stats bar ---- */

function ColumnStatsBar({ headers, rows }: { headers: string[]; rows: string[][] }) {
  const numericCols: { name: string; stats: { min: number; max: number; mean: number; count: number } }[] = [];

  for (let i = 0; i < headers.length; i++) {
    if (isNumericColumn(rows, i)) {
      numericCols.push({ name: headers[i], stats: columnStats(rows, i) });
    }
  }

  if (numericCols.length === 0) return null;

  return (
    <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
      {numericCols.slice(0, 6).map((col) => (
        <div
          key={col.name}
          style={{
            padding: "6px 10px", borderRadius: 6,
            background: "var(--color-bg-hover)", border: "1px solid var(--color-border)",
            fontSize: 11, color: "var(--color-text-secondary)",
          }}
        >
          <div style={{ fontWeight: 600, color: "var(--color-text-primary)", marginBottom: 2 }}>{col.name}</div>
          <div>Min: {col.stats.min} | Max: {col.stats.max} | Mean: {col.stats.mean}</div>
        </div>
      ))}
    </div>
  );
}

export default DataWorkspace;
