import { useState, useEffect, useCallback } from "react";
import { bridge } from "../bridge";
import type { SkillDefinition } from "../../shared/types";

export function useSkills() {
  const [skills, setSkills] = useState<SkillDefinition[]>([]);

  const refresh = useCallback(async () => {
    try {
      const list = await bridge.skillList();
      setSkills(list || []);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const save = useCallback(async (skill: SkillDefinition) => {
    const saved = await bridge.skillSave(skill);
    await refresh();
    return saved as SkillDefinition;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await bridge.skillDelete(id);
    await refresh();
  }, [refresh]);

  const run = useCallback(async (id: string) => {
    return bridge.skillRun(id);
  }, []);

  return {
    skills,
    refresh,
    save,
    remove,
    run,
  };
}
