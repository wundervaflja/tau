import { useState, useEffect, useCallback } from "react";
import { bridge } from "../bridge";
import type { VaultNoteListItem, VaultNote, VaultSearchResult, VaultGraphNode } from "../../shared/vault-types";

export function useVault() {
  const [notes, setNotes] = useState<VaultNoteListItem[]>([]);
  const [searchResults, setSearchResults] = useState<VaultSearchResult[]>([]);
  const [graph, setGraph] = useState<VaultGraphNode[]>([]);

  const refresh = useCallback(async (opts?: any) => {
    try {
      const list = await bridge.vaultList(opts);
      setNotes(list || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll every 15s
  useEffect(() => {
    const interval = setInterval(() => refresh(), 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const read = useCallback(async (slug: string, scope: string): Promise<VaultNote | null> => {
    try {
      return await bridge.vaultRead(slug, scope);
    } catch {
      return null;
    }
  }, []);

  const create = useCallback(async (opts: any) => {
    const note = await bridge.vaultCreate(opts);
    await refresh();
    return note;
  }, [refresh]);

  const update = useCallback(async (slug: string, scope: string, body: string) => {
    await bridge.vaultUpdate(slug, scope, body);
    await refresh();
  }, [refresh]);

  const remove = useCallback(async (slug: string, scope: string) => {
    await bridge.vaultDelete(slug, scope);
    await refresh();
  }, [refresh]);

  const search = useCallback(async (query: string, opts?: any) => {
    try {
      const results = await bridge.vaultSearch(query, opts);
      setSearchResults(results || []);
      return results || [];
    } catch {
      setSearchResults([]);
      return [];
    }
  }, []);

  const capture = useCallback(async (content: string, scope: string) => {
    await bridge.vaultCapture(content, scope);
  }, []);

  const refreshGraph = useCallback(async () => {
    try {
      const g = await bridge.vaultGraph();
      setGraph(g || []);
      return g || [];
    } catch {
      setGraph([]);
      return [];
    }
  }, []);

  const reinforce = useCallback(async (slug: string, scope: string) => {
    await bridge.vaultReinforce(slug, scope);
  }, []);

  const runDecay = useCallback(async () => {
    return await bridge.vaultDecayRun();
  }, []);

  const archiveList = useCallback(async () => {
    try {
      return await bridge.vaultArchiveList();
    } catch {
      return [];
    }
  }, []);

  const restore = useCallback(async (slug: string, scope: string) => {
    await bridge.vaultRestore(slug, scope);
    await refresh();
  }, [refresh]);

  return {
    notes,
    searchResults,
    graph,
    refresh,
    read,
    create,
    update,
    remove,
    search,
    capture,
    refreshGraph,
    reinforce,
    runDecay,
    archiveList,
    restore,
  };
}
