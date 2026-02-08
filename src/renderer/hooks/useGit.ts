import { useState, useEffect, useCallback, useRef } from "react";
import { bridge } from "../bridge";
import type { GitStatusResult, GitBranchInfo } from "../../shared/types";

export function useGit(cwd: string, sessionVersion: number) {
  const [status, setStatus] = useState<GitStatusResult>({
    isRepo: false,
    branch: "",
    files: [],
    ahead: 0,
    behind: 0,
  });
  const [branches, setBranches] = useState<GitBranchInfo>({ current: "", branches: [] });
  const [loading, setLoading] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await bridge.gitStatus();
      setStatus(s);
    } catch {
      // ignore
    }
  }, []);

  const refreshBranches = useCallback(async () => {
    try {
      const b = await bridge.gitBranches();
      setBranches(b);
    } catch {
      // ignore
    }
  }, []);

  // Refresh on cwd change, session version change (agent did something), and git file changes
  useEffect(() => {
    refresh();
    refreshBranches();
  }, [cwd, sessionVersion, refresh, refreshBranches]);

  // Also refresh after agent_end events (sessionVersion tracks this)
  // And listen for .git directory changes
  useEffect(() => {
    const unsub = bridge.onGitChanged(() => {
      // Debounce slightly
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        refresh();
        refreshBranches();
      }, 500);
    });
    return () => {
      unsub();
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, [refresh, refreshBranches]);

  // Also poll every 5 seconds as a fallback (file changes outside .git)
  useEffect(() => {
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  const checkout = useCallback(async (target: string, isFile = false) => {
    setLoading(true);
    try {
      await bridge.gitCheckout(target, isFile);
      await refresh();
      await refreshBranches();
    } finally {
      setLoading(false);
    }
  }, [refresh, refreshBranches]);

  const checkoutNewBranch = useCallback(async (name: string) => {
    setLoading(true);
    try {
      await bridge.gitCheckoutNew(name);
      await refresh();
      await refreshBranches();
    } finally {
      setLoading(false);
    }
  }, [refresh, refreshBranches]);

  const stageFile = useCallback(async (file: string) => {
    await bridge.gitStage(file);
    await refresh();
  }, [refresh]);

  const unstageFile = useCallback(async (file: string) => {
    await bridge.gitUnstage(file);
    await refresh();
  }, [refresh]);

  const stageAll = useCallback(async () => {
    await bridge.gitStageAll();
    await refresh();
  }, [refresh]);

  const discardFile = useCallback(async (file: string) => {
    await bridge.gitDiscard(file);
    await refresh();
  }, [refresh]);

  const getDiff = useCallback(async (file: string, staged: boolean) => {
    return bridge.gitDiff(file, staged);
  }, []);

  return {
    status,
    branches,
    loading,
    refresh,
    checkout,
    checkoutNewBranch,
    stageFile,
    unstageFile,
    stageAll,
    discardFile,
    getDiff,
  };
}
