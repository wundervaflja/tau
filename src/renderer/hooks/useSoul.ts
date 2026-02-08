import { useState, useEffect, useCallback } from "react";
import { bridge } from "../bridge";
import type { SoulStatus, SoulProposalsFile } from "../../shared/soul-types";

export function useSoul() {
  const [status, setStatus] = useState<SoulStatus | null>(null);
  const [content, setContent] = useState<string>("");
  const [proposals, setProposals] = useState<SoulProposalsFile | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await bridge.soulStatus();
      setStatus(s || null);
    } catch {
      // ignore
    }
  }, []);

  const refreshContent = useCallback(async () => {
    try {
      const c = await bridge.soulRead();
      setContent(c || "");
    } catch {
      // ignore
    }
  }, []);

  const refreshProposals = useCallback(async () => {
    try {
      const p = await bridge.soulProposalsRead();
      setProposals(p || null);
    } catch {
      // ignore
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshStatus(), refreshContent(), refreshProposals()]);
  }, [refreshStatus, refreshContent, refreshProposals]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll every 30s
  useEffect(() => {
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const write = useCallback(async (newContent: string) => {
    await bridge.soulWrite(newContent);
    await refresh();
  }, [refresh]);

  const clearProposals = useCallback(async () => {
    await bridge.soulProposalsClear();
    await refreshProposals();
  }, [refreshProposals]);

  return {
    status,
    content,
    proposals,
    refresh,
    write,
    clearProposals,
    hasProposals: (proposals?.proposals?.length ?? 0) > 0,
    needsBootstrap: status?.needsBootstrap ?? false,
  };
}
