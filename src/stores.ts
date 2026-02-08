import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";
import { ensureDataDir } from "./daemon/paths";
import type {
  NoteItem,
  SkillDefinition,
  HeartbeatState,
  TelemetryEntry,
  ApiKeyEntry,
  ProviderId,
  ProjectContext,
} from "./shared/types";

type NoteStore = { items: NoteItem[] };
type SkillStore = { skills: SkillDefinition[] };
type HeartbeatStateStore = HeartbeatState;
type TelemetryStore = { entries: TelemetryEntry[] };
type ApiKeysStore = { keys: ApiKeyEntry[] };
type ProjectContextStore = { contexts: ProjectContext[] };
type SessionCounterStore = { count: number; lastEvolution: number };

const MAX_ENTRIES = 2000;

function generateId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  const dir = await ensureDataDir();
  const full = path.join(dir, file);
  try {
    const raw = await fs.readFile(full, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson<T>(file: string, data: T): Promise<void> {
  const dir = await ensureDataDir();
  const full = path.join(dir, file);
  const tmp = full + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, full);
}

class DataStore<T> {
  private cache: T | null = null;
  constructor(private file: string, private fallback: T) {}

  async get(): Promise<T> {
    if (this.cache) return this.cache;
    const data = await readJson<T>(this.file, this.fallback);
    this.cache = data;
    return data;
  }

  async set(data: T): Promise<void> {
    this.cache = data;
    await writeJson(this.file, data);
  }

  async update(mutator: (data: T) => T): Promise<T> {
    const current = await this.get();
    const next = mutator(structuredClone(current));
    await this.set(next);
    return next;
  }
}

const skillStore = new DataStore<SkillStore>("skills.json", { skills: [] });
const heartbeatStateStore = new DataStore<HeartbeatStateStore>("heartbeat-state.json", {
  enabled: true,
  intervalMs: 30 * 60 * 1000, // 30 minutes
  lastCheckAt: null,
  nextCheckAt: null,
  checkCount: 0,
});
const telemetryStore = new DataStore<TelemetryStore>("telemetry.json", { entries: [] });
const apiKeysStore = new DataStore<ApiKeysStore>("api-keys.json", { keys: [] });
const noteStore = new DataStore<NoteStore>("notes.json", { items: [] });
const projectContextStore = new DataStore<ProjectContextStore>("project-contexts.json", { contexts: [] });
const sessionCounterStore = new DataStore<SessionCounterStore>("session-counter.json", { count: 0, lastEvolution: 0 });

// Notes
export async function listNotes(): Promise<NoteItem[]> {
  return (await noteStore.get()).items;
}

export async function addNote(item: NoteItem): Promise<NoteItem> {
  const entry: NoteItem = {
    ...item,
    id: item.id || generateId(),
    timestamp: item.timestamp || Date.now(),
  };
  await noteStore.update((store) => {
    store.items.push(entry);
    return store;
  });
  return entry;
}

export async function deleteNote(id: string): Promise<void> {
  await noteStore.update((store) => {
    store.items = store.items.filter((i) => i.id !== id);
    return store;
  });
}

// Skills
export async function listSkills(): Promise<SkillDefinition[]> {
  return (await skillStore.get()).skills;
}

export async function saveSkill(skill: SkillDefinition): Promise<SkillDefinition> {
  const now = Date.now();
  const entry: SkillDefinition = {
    ...skill,
    id: skill.id || generateId(),
    createdAt: skill.createdAt || now,
    updatedAt: now,
    permissions: skill.permissions || {},
  };
  await skillStore.update((store) => {
    // Match by id first, then by name to prevent duplicates
    let idx = store.skills.findIndex((s) => s.id === entry.id);
    if (idx < 0) {
      idx = store.skills.findIndex((s) => s.name.toLowerCase() === entry.name.toLowerCase());
    }
    if (idx >= 0) {
      entry.id = store.skills[idx].id;
      entry.createdAt = store.skills[idx].createdAt;
      store.skills[idx] = entry;
    } else {
      store.skills.push(entry);
    }
    return store;
  });
  return entry;
}

export async function deleteSkill(id: string): Promise<void> {
  await skillStore.update((store) => {
    store.skills = store.skills.filter((s) => s.id !== id);
    return store;
  });
}

// Heartbeat State
export async function getHeartbeatState(): Promise<HeartbeatState> {
  return heartbeatStateStore.get();
}

export async function saveHeartbeatState(state: HeartbeatState): Promise<void> {
  await heartbeatStateStore.set(state);
}

// Telemetry
export async function listTelemetry(): Promise<TelemetryEntry[]> {
  return (await telemetryStore.get()).entries;
}

export async function addTelemetry(entry: TelemetryEntry): Promise<TelemetryEntry> {
  const item = { ...entry, id: entry.id || generateId(), timestamp: entry.timestamp || Date.now() };
  await telemetryStore.update((store) => {
    store.entries.push(item);
    if (store.entries.length > MAX_ENTRIES) store.entries = store.entries.slice(-MAX_ENTRIES);
    return store;
  });
  return item;
}

// API Keys (BYOK)
export async function listApiKeys(): Promise<ApiKeyEntry[]> {
  return (await apiKeysStore.get()).keys;
}

export async function setApiKey(provider: ProviderId, key: string, label: string): Promise<ApiKeyEntry> {
  const entry: ApiKeyEntry = {
    provider,
    key,
    label,
    updatedAt: Date.now(),
  };
  await apiKeysStore.update((store) => {
    const idx = store.keys.findIndex((k) => k.provider === provider);
    if (idx >= 0) {
      store.keys[idx] = entry;
    } else {
      store.keys.push(entry);
    }
    return store;
  });
  return entry;
}

export async function deleteApiKey(provider: ProviderId): Promise<void> {
  await apiKeysStore.update((store) => {
    store.keys = store.keys.filter((k) => k.provider !== provider);
    return store;
  });
}

// Project Context
export async function getProjectContext(workspace: string): Promise<ProjectContext | null> {
  const store = await projectContextStore.get();
  return store.contexts.find((c) => c.workspace === workspace) || null;
}

export async function setProjectContext(ctx: ProjectContext): Promise<ProjectContext> {
  const entry: ProjectContext = { ...ctx, updatedAt: Date.now() };
  await projectContextStore.update((store) => {
    const idx = store.contexts.findIndex((c) => c.workspace === entry.workspace);
    if (idx >= 0) {
      store.contexts[idx] = entry;
    } else {
      store.contexts.push(entry);
    }
    return store;
  });
  return entry;
}

export async function listProjectContexts(): Promise<ProjectContext[]> {
  return (await projectContextStore.get()).contexts;
}

// Session Counter (for soul evolution triggers)
export async function incrementSessionCount(): Promise<number> {
  const store = await sessionCounterStore.update((s) => {
    s.count += 1;
    return s;
  });
  return store.count;
}

export async function getSessionCount(): Promise<{ count: number; lastEvolution: number }> {
  return sessionCounterStore.get();
}

export async function resetEvolutionCounter(): Promise<void> {
  await sessionCounterStore.update((s) => {
    s.count = 0;
    s.lastEvolution = Date.now();
    return s;
  });
}
