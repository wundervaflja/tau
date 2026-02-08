import React, { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useMemoryFeature } from "../providers/FeatureProviders";
import type { MemoryItem, MemoryType } from "../../shared/types";

// ── Graph data types ─────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label: string;
  type: "memory" | "tag";
  memoryType?: MemoryType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  pinned?: boolean;
  data?: MemoryItem;
}

interface GraphEdge {
  source: string;
  target: string;
}

// ── Color palette ────────────────────────────────────────────────────

const MEMORY_COLORS: Record<MemoryType, string> = {
  fact: "#4a9eff",
  preference: "#e88a3a",
  decision: "#9b6ee8",
  summary: "#4ac78e",
  tag: "#888888",
};

const TAG_COLOR = "#e05577";

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

// ── Force simulation ─────────────────────────────────────────────────

function buildGraph(items: MemoryItem[]): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const tagSet = new Map<string, GraphNode>();

  // Create memory nodes
  for (const item of items) {
    nodes.push({
      id: item.id,
      label: truncate(item.content, 48),
      type: "memory",
      memoryType: item.type,
      x: Math.random() * 800 - 400,
      y: Math.random() * 600 - 300,
      vx: 0,
      vy: 0,
      radius: 8,
      data: item,
    });

    // Create tag nodes and edges
    for (const tag of item.tags ?? []) {
      const tagKey = `tag:${tag.toLowerCase()}`;
      if (!tagSet.has(tagKey)) {
        const tagNode: GraphNode = {
          id: tagKey,
          label: `#${tag}`,
          type: "tag",
          x: Math.random() * 800 - 400,
          y: Math.random() * 600 - 300,
          vx: 0,
          vy: 0,
          radius: 12,
        };
        tagSet.set(tagKey, tagNode);
        nodes.push(tagNode);
      }
      edges.push({ source: item.id, target: tagKey });
    }
  }

  return { nodes, edges };
}

function simulate(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
): void {
  const cx = width / 2;
  const cy = height / 2;
  const k = 0.005; // centering force
  const repulsion = 3000;
  const springLen = 120;
  const springK = 0.03;
  const damping = 0.85;

  // Reset forces
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx = 0;
    n.vy = 0;
  }

  // Centering
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx += (cx - n.x) * k;
    n.vy += (cy - n.y) * k;
  }

  // Repulsion (all pairs)
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i];
      const b = nodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = repulsion / (dist * dist);
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      if (!a.pinned) { a.vx -= fx; a.vy -= fy; }
      if (!b.pinned) { b.vx += fx; b.vy += fy; }
    }
  }

  // Spring (edges)
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  for (const e of edges) {
    const a = nodeMap.get(e.source);
    const b = nodeMap.get(e.target);
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const displacement = dist - springLen;
    const force = springK * displacement;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.pinned) { a.vx += fx; a.vy += fy; }
    if (!b.pinned) { b.vx -= fx; b.vy -= fy; }
  }

  // Integrate
  for (const n of nodes) {
    if (n.pinned) continue;
    n.vx *= damping;
    n.vy *= damping;
    n.x += n.vx;
    n.y += n.vy;
    // Keep in bounds with padding
    n.x = Math.max(40, Math.min(width - 40, n.x));
    n.y = Math.max(40, Math.min(height - 40, n.y));
  }
}

// ── Component ────────────────────────────────────────────────────────

export function KnowledgeView() {
  const memory = useMemoryFeature();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [dragNode, setDragNode] = useState<GraphNode | null>(null);

  // Camera / pan + zoom
  const [camera, setCamera] = useState({ x: 0, y: 0, zoom: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, cx: 0, cy: 0 });

  const graphRef = useRef<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });

  const items = memory?.items ?? [];

  // Rebuild graph when items change
  useEffect(() => {
    const graph = buildGraph(items);
    // Preserve positions of existing nodes
    const oldMap = new Map(graphRef.current.nodes.map((n) => [n.id, n]));
    for (const n of graph.nodes) {
      const old = oldMap.get(n.id);
      if (old) {
        n.x = old.x;
        n.y = old.y;
      }
    }
    graphRef.current = graph;
    setSelectedNode(null);
  }, [items.length, items.map((i) => i.id).join(",")]);

  // Resize observer
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Screen → graph coords
  const screenToGraph = useCallback(
    (sx: number, sy: number) => ({
      gx: (sx - camera.x) / camera.zoom,
      gy: (sy - camera.y) / camera.zoom,
    }),
    [camera],
  );

  // Hit test
  const hitTest = useCallback(
    (sx: number, sy: number): GraphNode | null => {
      const { gx, gy } = screenToGraph(sx, sy);
      const { nodes } = graphRef.current;
      // Reverse so top-drawn nodes are hit first
      for (let i = nodes.length - 1; i >= 0; i--) {
        const n = nodes[i];
        const dx = gx - n.x;
        const dy = gy - n.y;
        const hitR = n.radius + 6;
        if (dx * dx + dy * dy <= hitR * hitR) return n;
      }
      return null;
    },
    [screenToGraph],
  );

  // Mouse handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const node = hitTest(sx, sy);

      if (node) {
        node.pinned = true;
        setDragNode(node);
      } else {
        // Start panning
        isPanning.current = true;
        panStart.current = { x: e.clientX, y: e.clientY, cx: camera.x, cy: camera.y };
      }
    },
    [hitTest, camera],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (dragNode) {
        const { gx, gy } = screenToGraph(sx, sy);
        dragNode.x = gx;
        dragNode.y = gy;
        return;
      }

      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setCamera((c) => ({ ...c, x: panStart.current.cx + dx, y: panStart.current.cy + dy }));
        return;
      }

      const node = hitTest(sx, sy);
      setHoveredNode(node);
      if (canvasRef.current) {
        canvasRef.current.style.cursor = node ? "pointer" : "grab";
      }
    },
    [dragNode, hitTest, screenToGraph],
  );

  const handleMouseUp = useCallback(() => {
    if (dragNode) {
      dragNode.pinned = false;
      // If it was a click (not a drag), select it
      setDragNode(null);
    }
    isPanning.current = false;
  }, [dragNode]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const node = hitTest(sx, sy);
      setSelectedNode(node);
    },
    [hitTest],
  );

  // Attach wheel handler as non-passive so preventDefault works
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      setCamera((c) => {
        const newZoom = Math.max(0.2, Math.min(4, c.zoom * factor));
        const nx = mx - (mx - c.x) * (newZoom / c.zoom);
        const ny = my - (my - c.y) * (newZoom / c.zoom);
        return { x: nx, y: ny, zoom: newZoom };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Animation loop
  useEffect(() => {
    let running = true;

    function frame() {
      if (!running) return;
      const { nodes, edges } = graphRef.current;
      if (nodes.length > 0) {
        simulate(nodes, edges, size.w / camera.zoom, size.h / camera.zoom);
        draw();
      }
      animRef.current = requestAnimationFrame(frame);
    }

    function draw() {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const { w, h } = size;

      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Read theme colors from CSS variables
      const cs = getComputedStyle(canvas);
      const textPrimary = cs.getPropertyValue("--color-text-primary").trim() || "rgba(255,255,255,0.9)";
      const isDark = cs.getPropertyValue("color-scheme").trim() === "dark" ||
        textPrimary.includes("255");
      const edgeColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)";
      const edgeHighlight = isDark ? "rgba(255,255,255,0.35)" : "rgba(0,0,0,0.3)";
      const labelColor = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.75)";

      // Clear
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.translate(camera.x, camera.y);
      ctx.scale(camera.zoom, camera.zoom);

      const { nodes, edges } = graphRef.current;
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));

      // Draw edges
      ctx.lineWidth = 1;
      for (const e of edges) {
        const a = nodeMap.get(e.source);
        const b = nodeMap.get(e.target);
        if (!a || !b) continue;

        const isHighlighted =
          selectedNode && (selectedNode.id === a.id || selectedNode.id === b.id);

        ctx.strokeStyle = isHighlighted ? edgeHighlight : edgeColor;
        ctx.lineWidth = isHighlighted ? 1.5 : 0.8;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      // Draw nodes
      for (const n of nodes) {
        const isHovered = hoveredNode?.id === n.id;
        const isSelected = selectedNode?.id === n.id;
        const isConnected =
          selectedNode &&
          edges.some(
            (e) =>
              (e.source === selectedNode.id && e.target === n.id) ||
              (e.target === selectedNode.id && e.source === n.id),
          );

        const baseColor =
          n.type === "tag" ? TAG_COLOR : MEMORY_COLORS[n.memoryType ?? "fact"];

        const alpha =
          !selectedNode || isSelected || isConnected ? 1 : 0.25;

        ctx.globalAlpha = alpha;

        // Glow for hovered/selected
        if (isHovered || isSelected) {
          ctx.shadowColor = baseColor;
          ctx.shadowBlur = 16;
        } else {
          ctx.shadowColor = "transparent";
          ctx.shadowBlur = 0;
        }

        // Node circle
        ctx.fillStyle = baseColor;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
        ctx.fill();

        // Border
        if (isSelected) {
          ctx.strokeStyle = isDark ? "#ffffff" : "#000000";
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;

        // Label
        const fontSize = n.type === "tag" ? 11 : 10;
        ctx.font = `${n.type === "tag" ? "600" : "400"} ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.fillStyle = labelColor;
        ctx.globalAlpha = alpha;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText(truncate(n.label, 28), n.x, n.y + n.radius + 4);

        ctx.globalAlpha = 1;
      }

      ctx.restore();
    }

    animRef.current = requestAnimationFrame(frame);
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [size, camera, hoveredNode, selectedNode]);

  // Stats
  const tagCount = useMemo(
    () => new Set(items.flatMap((i) => (i.tags ?? []).map((t) => t.toLowerCase()))).size,
    [items],
  );

  if (!memory) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm" style={{ color: "var(--color-text-tertiary)" }}>Loading…</p>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="flex flex-col items-center gap-4" style={{ maxWidth: 480 }}>
          <div
            className="flex items-center justify-center w-12 h-12 rounded-xl"
            style={{ background: "var(--color-bg-hover)" }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                style={{ color: "var(--color-text-tertiary)" }}
              />
            </svg>
          </div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
            Knowledge Graph
          </h2>
          <p className="text-sm text-center" style={{ color: "var(--color-text-tertiary)", lineHeight: 1.6 }}>
            No memories yet. As you chat with Pi, it will learn facts, preferences, and decisions.
            They'll appear here as an interconnected graph linked by tags.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      {/* Stats bar */}
      <div
        className="absolute top-3 left-3 z-10 flex items-center gap-3 px-3 py-1.5 rounded-lg"
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          backdropFilter: "blur(8px)",
        }}
      >
        <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          {items.length} memories
        </span>
        <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          {tagCount} tags
        </span>
        <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>·</span>
        <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
          {graphRef.current.edges.length} connections
        </span>
      </div>

      {/* Legend */}
      <div
        className="absolute top-3 right-3 z-10 flex flex-col gap-1.5 px-3 py-2 rounded-lg"
        style={{
          background: "var(--color-bg-elevated)",
          border: "1px solid var(--color-border)",
          backdropFilter: "blur(8px)",
        }}
      >
        {(Object.entries(MEMORY_COLORS) as [MemoryType, string][]).map(([type, color]) => (
          <div key={type} className="flex items-center gap-2">
            <div className="rounded-full" style={{ width: 8, height: 8, background: color }} />
            <span className="text-xs capitalize" style={{ color: "var(--color-text-secondary)" }}>{type}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <div className="rounded-full" style={{ width: 8, height: 8, background: TAG_COLOR }} />
          <span className="text-xs" style={{ color: "var(--color-text-secondary)" }}>#tag</span>
        </div>
      </div>

      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
      />

      {/* Detail panel */}
      {selectedNode && (
        <div
          className="absolute bottom-4 left-4 right-4 z-10 mx-auto rounded-xl overflow-hidden"
          style={{
            maxWidth: 520,
            background: "var(--color-bg-elevated)",
            border: "1px solid var(--color-border-heavy)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div
                  className="rounded-full"
                  style={{
                    width: 10,
                    height: 10,
                    background:
                      selectedNode.type === "tag"
                        ? TAG_COLOR
                        : MEMORY_COLORS[selectedNode.memoryType ?? "fact"],
                  }}
                />
                <span
                  className="text-xs font-semibold uppercase"
                  style={{ color: "var(--color-text-secondary)" }}
                >
                  {selectedNode.type === "tag" ? "Tag" : selectedNode.memoryType}
                </span>
                {selectedNode.data?.source && (
                  <span className="text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                    · {selectedNode.data.source}
                  </span>
                )}
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                className="p-1 rounded-md transition-colors"
                style={{ color: "var(--color-text-tertiary)" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>

            <p className="text-sm mb-2" style={{ color: "var(--color-text-primary)", lineHeight: 1.5 }}>
              {selectedNode.type === "tag"
                ? `Connects ${graphRef.current.edges.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id).length} memories`
                : selectedNode.data?.content}
            </p>

            {selectedNode.data?.tags && selectedNode.data.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedNode.data.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-full text-xs"
                    style={{
                      background: "rgba(224, 85, 119, 0.15)",
                      color: TAG_COLOR,
                    }}
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            )}

            {selectedNode.data?.timestamp && (
              <div className="mt-2 text-xs" style={{ color: "var(--color-text-tertiary)" }}>
                {new Date(selectedNode.data.timestamp).toLocaleString()}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
