import React from "react";
import { bridge } from '../bridge';

interface WelcomeScreenProps {
  onSend: (text: string) => void;
  cwd: string;
  hasProject: boolean;
}

// Local minimal types for bridge data
interface MemoryItem {
  id: string;
  type?: string;
  content?: string;
  tags?: string[];
  timestamp?: number | string;
  source?: string;
}

interface SkillDefinition {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
}

export function WelcomeScreen({ onSend, cwd, hasProject }: WelcomeScreenProps) {
  const projectName = (() => {
    if (!cwd) return "";
    const parts = cwd.replace(/\\/g, "/").split("/");
    return parts[parts.length - 1] || cwd;
  })();

  const title = hasProject ? "What can I help you with?" : "How can I help you today?";
  const subtitle = hasProject
    ? "I can read, write, and edit files, run commands, and help you code."
    : "I can help with writing, planning, research, file organization, and more.";

  // Briefing state
  const [memories, setMemories] = React.useState<MemoryItem[]>([]);
  const [skills, setSkills] = React.useState<SkillDefinition[]>([]);

  // Helper: normalize timestamps (accept number in seconds or ms, ISO string, or numeric string)
  const toTs = (val: any): number | null => {
    if (val == null) return null;
    if (typeof val === 'number') {
      // if it's in seconds (very small), convert to ms
      return val < 1e12 ? val * 1000 : val;
    }
    if (typeof val === 'string') {
      const asNum = Number(val);
      if (!isNaN(asNum)) {
        return asNum < 1e12 ? asNum * 1000 : asNum;
      }
      const parsed = Date.parse(val);
      return isNaN(parsed) ? null : parsed;
    }
    return null;
  };

  // Format relative times per requirements
  function formatRelativeTime(timestamp: number): string {
    if (!timestamp) return '';
    const ts = timestamp < 1e12 ? timestamp * 1000 : timestamp; // ensure ms
    const now = Date.now();
    const diff = ts - now;
    const abs = Math.abs(diff);

    if (diff > 0) {
      // future
      if (abs < 60 * 1000) return 'in a few seconds';
      if (abs < 60 * 60 * 1000) {
        const m = Math.round(abs / (60 * 1000));
        return `in ${m} minute${m === 1 ? '' : 's'}`;
      }
      if (abs <= 24 * 60 * 60 * 1000) {
        const h = Math.round(abs / (60 * 60 * 1000));
        return `in ${h} hour${h === 1 ? '' : 's'}`;
      }
      const d = new Date(ts);
      const timeStr = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      return `at ${timeStr}`;
    } else {
      // past
      if (abs < 60 * 1000) return 'just now';
      if (abs < 60 * 60 * 1000) {
        const m = Math.round(abs / (60 * 1000));
        return `${m} minute${m === 1 ? '' : 's'} ago`;
      }
      const h = Math.round(abs / (60 * 60 * 1000));
      return `${h} hour${h === 1 ? '' : 's'} ago`;
    }
  }

  const truncate = (text: string, n = 60) => {
    if (!text) return '';
    return text.length > n ? text.slice(0, n - 3) + '...' : text;
  };

  // Load briefing data on mount
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        if (!bridge) return;
        const mem = await bridge.memoryList?.();
        const skl = await bridge.skillList?.();
        if (!mounted) return;
        setMemories(mem || []);
        setSkills(skl || []);
      } catch (e) {
        // don't let bridge failures break the UI
        // eslint-disable-next-line no-console
        console.error('Failed to load briefing data', e);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // Derived briefing data
  const now = Date.now();

  const recentMemories = (memories || [])
    .map((m) => ({ ...m, ts: toTs(m.timestamp) }))
    .filter((m: any) => m.ts)
    .sort((a: any, b: any) => b.ts - a.ts)
    .slice(0, 3);

  const lastSummary = (memories || [])
    .map((m) => ({ ...m, ts: toTs(m.timestamp) }))
    .filter((m: any) => m.type === 'summary' && m.ts)
    .sort((a: any, b: any) => b.ts - a.ts)[0];

  const showBriefing = (recentMemories.length > 0) || (skills.length > 0);

  return (
    <div className="flex flex-col items-center justify-center h-full px-8 py-16">
      {/* Tau Symbol and Header */}
      <div className="mb-8 text-center">
        <div
          className="text-5xl font-bold mb-3"
          style={{
            background: "linear-gradient(135deg, var(--color-text-accent), var(--color-text-success))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          τ
        </div>

        <h1 className="text-xl font-semibold mb-2" style={{ color: "var(--color-text-primary)" }}>
          {title}
        </h1>

        <p className="text-sm max-w-md" style={{ color: "var(--color-text-tertiary)" }}>
          {subtitle}
        </p>

        {hasProject && projectName ? (
          <div
            className="mt-3 text-xs px-2 py-1 inline-block rounded"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
              color: "var(--color-text-secondary)",
            }}
          >
            {projectName}
          </div>
        ) : null}
      </div>

      {/* Briefing card (proactive) - render above suggestions when there is data */}
      {showBriefing ? (
        <div className="max-w-2xl w-full mb-4">
          <div
            className="rounded-xl p-4"
            style={{
              background: "var(--color-bg-elevated)",
              border: "1px solid var(--color-border)",
            }}
          >
            <div className="mb-3">
              <div className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>
                Today
              </div>
            </div>

            <div className="flex flex-col gap-3">
              {recentMemories.length > 0 && (
                <div>
                  <div className="text-xs mb-2" style={{ color: "var(--color-text-tertiary)", fontWeight: 600 }}>Recent context</div>
                  <div className="flex flex-col gap-1">
                    {recentMemories.map((m: any) => (
                      <div key={m.id} className="text-sm" style={{ color: "var(--color-text-primary)" }}>
                        {truncate(String(m.content || ''), 60)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {(lastSummary || (skills && skills.length > 0)) && (
                <div>
                  <div className="text-xs mb-2" style={{ color: "var(--color-text-tertiary)", fontWeight: 600 }}>Quick actions</div>
                  <div className="flex flex-wrap gap-2">
                    {lastSummary && (
                      <button
                        type="button"
                        onClick={() => onSend(String(lastSummary.content || ''))}
                        className="text-sm px-3 py-1 rounded-full transition"
                        style={{ background: "var(--color-bg-hover)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                      >
                        Continue where you left off
                      </button>
                    )}

                    {skills && skills.slice(0, 2).map((s: any) => (
                      <button
                        type="button"
                        key={s.id}
                        onClick={() => onSend(String(s.prompt || s.name || ''))}
                        className="text-sm px-3 py-1 rounded-full transition"
                        style={{ background: "var(--color-bg-hover)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

    </div>
  );
}
