import React, { useRef, useEffect, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { bridge } from "../bridge";

interface TerminalPanelProps {
  cwd: string;
  visible: boolean;
  onClose: () => void;
}

export function TerminalPanel({ cwd, visible, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const [height, setHeight] = useState(300);
  const dragging = useRef(false);
  const dragStartY = useRef(0);
  const dragStartHeight = useRef(0);

  // Initialize terminal
  useEffect(() => {
    if (!visible || !containerRef.current) return;
    if (termRef.current) return; // already initialized

    const term = new Terminal({
      fontSize: 13,
      fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
      cursorBlink: true,
      cursorStyle: "bar",
      theme: {
        background: "#1a1a2e",
        foreground: "#e0e0e0",
        cursor: "#e0e0e0",
        selectionBackground: "rgba(255, 255, 255, 0.2)",
        black: "#1a1a2e",
        red: "#ff6b6b",
        green: "#51cf66",
        yellow: "#ffd43b",
        blue: "#74c0fc",
        magenta: "#da77f2",
        cyan: "#66d9e8",
        white: "#e0e0e0",
        brightBlack: "#495057",
        brightRed: "#ff8787",
        brightGreen: "#69db7c",
        brightYellow: "#ffe066",
        brightBlue: "#91d5ff",
        brightMagenta: "#e599f7",
        brightCyan: "#99e9f2",
        brightWhite: "#f8f9fa",
      },
      scrollback: 5000,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    term.open(containerRef.current);
    fitAddon.fit();
    term.focus();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Create PTY
    const dims = fitAddon.proposeDimensions();
    bridge.ptyCreate(cwd, dims?.cols ?? 80, dims?.rows ?? 24).then((id: string) => {
      ptyIdRef.current = id;
    });

    // Send keystrokes to PTY
    term.onData((data) => {
      if (ptyIdRef.current) {
        bridge.ptyWrite(ptyIdRef.current, data);
      }
    });

    // Receive data from PTY
    const unsubData = bridge.onPtyData((id: string, data: string) => {
      if (id === ptyIdRef.current) {
        term.write(data);
      }
    });

    // Handle PTY exit
    const unsubExit = bridge.onPtyExit((id: string, code: number) => {
      if (id === ptyIdRef.current) {
        term.write(`\r\n\x1b[90m[Process exited with code ${code}]\x1b[0m\r\n`);
        ptyIdRef.current = null;
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        try {
          fitAddonRef.current.fit();
          const dims = fitAddonRef.current.proposeDimensions();
          if (dims && ptyIdRef.current) {
            bridge.ptyResize(ptyIdRef.current, dims.cols, dims.rows);
          }
        } catch {
          // ignore
        }
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      unsubData();
      unsubExit();
      if (ptyIdRef.current) {
        bridge.ptyClose(ptyIdRef.current);
        ptyIdRef.current = null;
      }
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [visible, cwd]);

  // Autofocus when terminal becomes visible
  useEffect(() => {
    if (visible && termRef.current) {
      termRef.current.focus();
    }
  }, [visible]);

  // Refit when height changes
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      const timer = setTimeout(() => {
        fitAddonRef.current?.fit();
        const dims = fitAddonRef.current?.proposeDimensions();
        if (dims && ptyIdRef.current) {
          bridge.ptyResize(ptyIdRef.current, dims.cols, dims.rows);
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [height, visible]);

  // Drag to resize
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;
      dragStartY.current = e.clientY;
      dragStartHeight.current = height;

      const handleDragMove = (e: MouseEvent) => {
        if (!dragging.current) return;
        const delta = dragStartY.current - e.clientY;
        const newHeight = Math.max(150, Math.min(600, dragStartHeight.current + delta));
        setHeight(newHeight);
      };

      const handleDragEnd = () => {
        dragging.current = false;
        document.removeEventListener("mousemove", handleDragMove);
        document.removeEventListener("mouseup", handleDragEnd);
      };

      document.addEventListener("mousemove", handleDragMove);
      document.addEventListener("mouseup", handleDragEnd);
    },
    [height],
  );

  if (!visible) return null;

  return (
    <div
      style={{
        height,
        borderTop: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        background: "#1a1a2e",
      }}
    >
      {/* Resize handle */}
      <div
        onMouseDown={handleDragStart}
        style={{
          height: 4,
          cursor: "ns-resize",
          background: "transparent",
          flexShrink: 0,
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-border)")}
        onMouseLeave={(e) => {
          if (!dragging.current) e.currentTarget.style.background = "transparent";
        }}
      />

      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "4px 12px",
          flexShrink: 0,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "rgba(255,255,255,0.5)",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Terminal
        </span>
        <button
          onClick={onClose}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            padding: "2px 4px",
            borderRadius: 4,
            display: "flex",
            alignItems: "center",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.8)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "rgba(255,255,255,0.4)")}
          title="Close terminal (⌘J)"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* Terminal container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          padding: "4px 8px",
          overflow: "hidden",
        }}
      />
    </div>
  );
}

export default TerminalPanel;
