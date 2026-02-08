import React, { createContext, useContext, type ReactNode } from "react";
import { useAgentContext } from "../contexts/AgentContext";
import { useGit } from "../hooks/useGit";
import { useMemory } from "../hooks/useMemory";
import { useSkills } from "../hooks/useSkills";
import { useSubagents } from "../hooks/useSubagents";
import { useSoul } from "../hooks/useSoul";
import { useVault } from "../hooks/useVault";

// --- Individual feature contexts ---

type GitValue = ReturnType<typeof useGit>;
type MemoryValue = ReturnType<typeof useMemory>;
type SkillsValue = ReturnType<typeof useSkills>;
type SubagentsValue = ReturnType<typeof useSubagents>;
type SoulValue = ReturnType<typeof useSoul>;
type VaultValue = ReturnType<typeof useVault>;

const GitContext = createContext<GitValue | null>(null);
const MemoryContext = createContext<MemoryValue | null>(null);
const SkillsContext = createContext<SkillsValue | null>(null);
const SubagentsContext = createContext<SubagentsValue | null>(null);
const SoulContext = createContext<SoulValue | null>(null);
const VaultContext = createContext<VaultValue | null>(null);

// --- Consumer hooks ---

export function useGitFeature(): GitValue | null {
  return useContext(GitContext);
}

export function useMemoryFeature(): MemoryValue | null {
  return useContext(MemoryContext);
}

export function useSkillsFeature(): SkillsValue | null {
  return useContext(SkillsContext);
}

export function useSubagentsFeature(): SubagentsValue | null {
  return useContext(SubagentsContext);
}

export function useSoulFeature(): SoulValue | null {
  return useContext(SoulContext);
}

export function useVaultFeature(): VaultValue | null {
  return useContext(VaultContext);
}

// --- Provider components ---

function GitProvider({ cwd, sessionVersion, children }: { cwd: string; sessionVersion: number; children: ReactNode }) {
  const git = useGit(cwd, sessionVersion);
  return <GitContext.Provider value={git}>{children}</GitContext.Provider>;
}

function MemoryProvider({ children }: { children: ReactNode }) {
  const memory = useMemory();
  return <MemoryContext.Provider value={memory}>{children}</MemoryContext.Provider>;
}

function SkillsProvider({ children }: { children: ReactNode }) {
  const skills = useSkills();
  return <SkillsContext.Provider value={skills}>{children}</SkillsContext.Provider>;
}

function SubagentsProvider({ children }: { children: ReactNode }) {
  const subagents = useSubagents();
  return <SubagentsContext.Provider value={subagents}>{children}</SubagentsContext.Provider>;
}

function SoulProvider({ children }: { children: ReactNode }) {
  const soul = useSoul();
  return <SoulContext.Provider value={soul}>{children}</SoulContext.Provider>;
}

function VaultProvider({ children }: { children: ReactNode }) {
  const vault = useVault();
  return <VaultContext.Provider value={vault}>{children}</VaultContext.Provider>;
}

// --- Main compositor ---

/**
 * Mounts all feature providers unconditionally.
 * Must be rendered inside AgentProvider.
 */
export function FeatureProviders({ children }: { children: ReactNode }) {
  const agent = useAgentContext();

  return (
    <SoulProvider>
      <VaultProvider>
        <MemoryProvider>
          <SkillsProvider>
            <SubagentsProvider>
              <GitProvider cwd={agent.status.cwd} sessionVersion={agent.sessionVersion}>
                {children}
              </GitProvider>
            </SubagentsProvider>
          </SkillsProvider>
        </MemoryProvider>
      </VaultProvider>
    </SoulProvider>
  );
}
