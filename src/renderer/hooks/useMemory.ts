import { useState, useEffect, useCallback } from "react";
import { bridge } from "../bridge";
import type { MemoryItem } from "../../shared/types";

export function useMemory() {
  const [items, setItems] = useState<MemoryItem[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await bridge.memoryList();
      setItems(list || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    const interval = setInterval(refresh, 10_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const add = useCallback(async (item: MemoryItem) => {
    const saved = await bridge.memoryAdd(item);
    await refresh();
    return saved as MemoryItem;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await bridge.memoryDelete(id);
    await refresh();
  }, [refresh]);

  return { items, refresh, add, remove };
}
