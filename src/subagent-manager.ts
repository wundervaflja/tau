import type {
  SubagentSpawnConfig,
  SubagentInfo,
  SubagentEvent,
  BusMessage,
  HistoryMessage,
  HistoryToolCall,
} from "./shared/types";

// Dynamic SDK import (same pattern as agent-manager)
let piSdk: any = null;
async function loadPiSdk() {
  if (piSdk) return piSdk;
  piSdk = await import("@mariozechner/pi-coding-agent");
  return piSdk;
}

// ---------------------------------------------------------------------------
// MessageBus — inter-agent communication
// ---------------------------------------------------------------------------

class MessageBus {
  private handlers = new Map<string, (msg: BusMessage) => void>();
  private history: BusMessage[] = [];

  subscribe(agentId: string, handler: (msg: BusMessage) => void): () => void {
    this.handlers.set(agentId, handler);
    return () => this.handlers.delete(agentId);
  }

  send(msg: BusMessage): void {
    this.history.push(msg);

    if (msg.toId === "*") {
      // Broadcast — deliver to all except sender
      for (const [id, handler] of this.handlers) {
        if (id !== msg.fromId) handler(msg);
      }
    } else {
      const handler = this.handlers.get(msg.toId);
      if (handler) handler(msg);
    }
  }

  getHistory(): BusMessage[] {
    return [...this.history];
  }

  clear(): void {
    this.history = [];
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// SubagentInstance — wraps a single AgentSession
// ---------------------------------------------------------------------------

interface SubagentInstance {
  id: string;
  name: string;
  session: any; // AgentSession
  unsubscribe: () => void;
  busUnsubscribe: () => void;
  createdAt: number;
  persistent: boolean;
  messageCount: number;
  finished: boolean;
}

// ---------------------------------------------------------------------------
// SubagentManager
// ---------------------------------------------------------------------------

const MAX_SUBAGENTS = 10;
const MAX_DEPTH = 2; // subagents can spawn sub-subagents up to this depth

export class SubagentManager {
  private agents = new Map<string, SubagentInstance>();
  private bus = new MessageBus();
  private cwd: string;
  private authStorage: any;
  private modelRegistry: any;
  private onEvent: (evt: SubagentEvent) => void;
  private onBusMessage: (msg: BusMessage) => void;
  private depth: number;
  /** Extra tools injected into every subagent (e.g. create_memory, save_note) */
  private extraTools: any[];

  constructor(config: {
    cwd: string;
    authStorage: any;
    modelRegistry: any;
    onEvent: (evt: SubagentEvent) => void;
    onBusMessage: (msg: BusMessage) => void;
    depth?: number;
    extraTools?: any[];
  }) {
    this.cwd = config.cwd;
    this.authStorage = config.authStorage;
    this.modelRegistry = config.modelRegistry;
    this.onEvent = config.onEvent;
    this.onBusMessage = config.onBusMessage;
    this.depth = config.depth ?? 0;
    this.extraTools = config.extraTools ?? [];
  }

  // ------- Spawn -------

  async spawn(configs: SubagentSpawnConfig[]): Promise<SubagentInfo[]> {
    // Purge finished (non-persistent) agents to free slots
    for (const [id, agent] of this.agents) {
      if (agent.finished && !agent.persistent) {
        this.close(id);
      }
    }

    if (this.agents.size + configs.length > MAX_SUBAGENTS) {
      throw new Error(
        `Cannot spawn ${configs.length} agents: would exceed limit of ${MAX_SUBAGENTS} (currently ${this.agents.size})`
      );
    }

    const results: SubagentInfo[] = [];

    for (const cfg of configs) {
      const id = `sub-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const sdk = await loadPiSdk();
      const { createAgentSession, SessionManager } = sdk;

      // Build custom tools for inter-agent communication
      const customTools = this.buildToolsForAgent(id, cfg.name, cfg.canSpawn);

      const sessionManager = cfg.persistent
        ? SessionManager.create(this.cwd)
        : SessionManager.inMemory(this.cwd);

      const createOpts: any = {
        cwd: this.cwd,
        authStorage: this.authStorage,
        modelRegistry: this.modelRegistry,
        sessionManager,
        customTools,
      };

      // Set model if specified
      if (cfg.model) {
        const [provider, ...rest] = cfg.model.split("/");
        const modelId = rest.join("/");
        const model = this.modelRegistry.find(provider, modelId);
        if (model) createOpts.model = model;
      }

      if (cfg.thinkingLevel) {
        createOpts.thinkingLevel = cfg.thinkingLevel;
      }

      const { session } = await createAgentSession(createOpts);

      // Subscribe to session events and forward to renderer with subagent ID
      const unsubscribe = session.subscribe((event: any) => {
        this.forwardEvent(id, event);
      });

      // Subscribe to bus messages — deliver to this agent
      const busUnsubscribe = this.bus.subscribe(id, (msg: BusMessage) => {
        this.deliverBusMessage(id, msg);
      });

      const instance: SubagentInstance = {
        id,
        name: cfg.name,
        session,
        unsubscribe,
        busUnsubscribe,
        createdAt: Date.now(),
        persistent: cfg.persistent ?? false,
        messageCount: 0,
        finished: false,
      };

      this.agents.set(id, instance);

      const info = this.getInfo(instance);
      results.push(info);

      // Emit spawned event to renderer
      this.onEvent({
        subagentId: id,
        event: { type: "status", data: info } as any,
      });

      // Auto-prompt with task if provided
      if (cfg.task) {
        // Don't await — let it run in parallel
        session.prompt(cfg.task).catch((err: any) => {
          console.error(`[subagent ${cfg.name}] prompt error:`, err);
        });
      }
    }

    return results;
  }

  // ------- Event forwarding -------

  private forwardEvent(id: string, event: any): void {
    const instance = this.agents.get(id);
    if (!instance) return;

    switch (event.type) {
      case "message_update":
        if (event.assistantMessageEvent.type === "text_delta") {
          this.onEvent({
            subagentId: id,
            event: {
              type: "text_delta",
              data: { delta: event.assistantMessageEvent.delta },
            },
          });
        } else if (event.assistantMessageEvent.type === "thinking_delta") {
          this.onEvent({
            subagentId: id,
            event: {
              type: "thinking_delta",
              data: { delta: event.assistantMessageEvent.delta },
            },
          });
        }
        break;

      case "tool_execution_start":
        this.onEvent({
          subagentId: id,
          event: {
            type: "tool_start",
            data: {
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              input: event.input,
            },
          },
        });
        break;

      case "tool_execution_update":
        this.onEvent({
          subagentId: id,
          event: {
            type: "tool_update",
            data: {
              toolCallId: event.toolCallId,
              output: event.output,
            },
          },
        });
        break;

      case "tool_execution_end":
        this.onEvent({
          subagentId: id,
          event: {
            type: "tool_end",
            data: {
              toolCallId: event.toolCallId,
              isError: event.isError,
              result: event.result,
            },
          },
        });
        break;

      case "message_start":
        this.onEvent({
          subagentId: id,
          event: { type: "message_start", data: {} },
        });
        break;

      case "message_end":
        if (instance) instance.messageCount++;
        this.onEvent({
          subagentId: id,
          event: { type: "message_end", data: {} },
        });
        break;

      case "agent_start":
        this.onEvent({
          subagentId: id,
          event: { type: "agent_start", data: {} },
        });
        break;

      case "agent_end":
        if (instance) instance.finished = true;
        this.onEvent({
          subagentId: id,
          event: {
            type: "agent_end",
            data: { messages: event.messages },
          },
        });
        // Send updated status
        if (instance) {
          this.onEvent({
            subagentId: id,
            event: { type: "status", data: this.getInfo(instance) } as any,
          });
        }
        break;
    }
  }

  // ------- Inter-agent messaging -------

  async sendAgentMessage(
    fromId: string,
    toNameOrId: string,
    message: string
  ): Promise<string> {
    const fromAgent = fromId === "main" ? null : this.agents.get(fromId);
    const fromName = fromId === "main" ? "Main" : fromAgent?.name ?? fromId;

    // Resolve target
    let toId: string;
    let toName: string;

    if (toNameOrId === "*" || toNameOrId.toLowerCase() === "all") {
      toId = "*";
      toName = "all";
    } else {
      // Find by name or ID
      const target = this.findAgent(toNameOrId);
      if (!target && toNameOrId.toLowerCase() !== "main") {
        return `Agent "${toNameOrId}" not found. Available: ${this.listNames().join(", ")}`;
      }
      if (toNameOrId.toLowerCase() === "main") {
        toId = "main";
        toName = "Main";
      } else {
        toId = target!.id;
        toName = target!.name;
      }
    }

    const busMsg: BusMessage = {
      from: fromName,
      fromId,
      to: toName,
      toId,
      content: message,
      timestamp: Date.now(),
    };

    this.bus.send(busMsg);
    this.onBusMessage(busMsg);

    // If target is "main", we don't deliver via session (the renderer handles it)
    // The main agent-manager will pick it up

    return toId === "*"
      ? `Broadcast message sent to all agents`
      : `Message sent to @${toName}`;
  }

  private deliverBusMessage(targetId: string, msg: BusMessage): void {
    const target = this.agents.get(targetId);
    if (!target) return;

    const prefixed = `[From @${msg.from}]: ${msg.content}`;

    if (target.session.isStreaming) {
      // Steer — interrupt to inject context
      target.session.steer(prefixed).catch((err: any) => {
        console.error(`[subagent ${target.name}] steer error:`, err);
      });
    } else {
      // Prompt — start a new turn
      target.session.prompt(prefixed).catch((err: any) => {
        console.error(`[subagent ${target.name}] prompt error:`, err);
      });
    }
  }

  // Called by AgentManager when a bus message targets "main"
  deliverToMainSession(mainSession: any, msg: BusMessage): void {
    const prefixed = `[From @${msg.from}]: ${msg.content}`;
    if (mainSession.isStreaming) {
      mainSession.steer(prefixed).catch(() => {});
    } else {
      mainSession.prompt(prefixed).catch(() => {});
    }
  }

  // ------- Prompt / Abort / Close -------

  async prompt(id: string, text: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) throw new Error(`Subagent ${id} not found`);

    if (agent.session.isStreaming) {
      await agent.session.followUp(text);
    } else {
      await agent.session.prompt(text);
    }
  }

  async abort(id: string): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) return;
    await agent.session.abort();
  }

  close(id: string): void {
    const agent = this.agents.get(id);
    if (!agent) return;
    agent.unsubscribe();
    agent.busUnsubscribe();
    agent.session.dispose();
    this.agents.delete(id);
  }

  disposeAll(): void {
    for (const [id] of this.agents) {
      this.close(id);
    }
    this.bus.clear();
  }

  // ------- Status / History -------

  private getInfo(instance: SubagentInstance): SubagentInfo {
    return {
      id: instance.id,
      name: instance.name,
      model: instance.session.model
        ? `${instance.session.model.provider}/${instance.session.model.id}`
        : undefined,
      isStreaming: instance.session.isStreaming,
      messageCount: instance.messageCount,
      createdAt: instance.createdAt,
    };
  }

  getStatus(id: string): SubagentInfo | null {
    const agent = this.agents.get(id);
    return agent ? this.getInfo(agent) : null;
  }

  listAll(): SubagentInfo[] {
    return Array.from(this.agents.values()).map((a) => this.getInfo(a));
  }

  private listNames(): string[] {
    return Array.from(this.agents.values()).map((a) => a.name);
  }

  private findAgent(nameOrId: string): SubagentInstance | undefined {
    // By ID
    const byId = this.agents.get(nameOrId);
    if (byId) return byId;
    // By name (case-insensitive)
    const lower = nameOrId.toLowerCase();
    for (const agent of this.agents.values()) {
      if (agent.name.toLowerCase() === lower) return agent;
    }
    return undefined;
  }

  getHistory(id: string): HistoryMessage[] {
    const agent = this.agents.get(id);
    if (!agent) return [];

    try {
      const sm = agent.session.sessionManager;
      const entries = sm.getBranch();
      return this.entriesToHistory(entries);
    } catch {
      return [];
    }
  }

  getBusHistory(): BusMessage[] {
    return this.bus.getHistory();
  }

  private entriesToHistory(entries: any[]): HistoryMessage[] {
    const history: HistoryMessage[] = [];
    const toolResults = new Map<string, { content: string; isError: boolean }>();

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const msg = entry.message;

      if (msg.role === "user") {
        const content =
          typeof msg.content === "string"
            ? msg.content
            : (msg.content || [])
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");
        if (content) {
          history.push({ role: "user", content, timestamp: msg.timestamp || 0 });
        }
      } else if (msg.role === "toolResult") {
        const resultText =
          typeof msg.content === "string"
            ? msg.content
            : (msg.content || [])
                .filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("\n");
        toolResults.set(msg.toolCallId, {
          content: resultText,
          isError: !!msg.isError,
        });
      } else if (msg.role === "assistant") {
        let content = "";
        let thinking = "";
        const tools: HistoryToolCall[] = [];

        for (const part of msg.content || []) {
          if (part.type === "text") content += part.text;
          else if (part.type === "thinking") thinking += part.thinking;
          else if (part.type === "toolCall") {
            const result = toolResults.get(part.id);
            tools.push({
              id: part.id,
              name: part.name,
              input: part.arguments,
              output: result?.content || "",
              isError: result?.isError || false,
            });
          }
        }

        history.push({
          role: "assistant",
          content,
          thinking: thinking || undefined,
          tools: tools.length > 0 ? tools : undefined,
          timestamp: msg.timestamp || 0,
        });
      }
    }
    return history;
  }

  // ------- Custom tools for agents -------

  /**
   * Build ToolDefinition[] that get injected into an AgentSession.
   * These let the LLM spawn subagents and send inter-agent messages.
   */
  buildToolsForAgent(agentId: string, agentName: string, canSpawnOverride?: boolean): any[] {
    // Don't give spawn capability if we're at max depth or explicitly disabled
    const canSpawn = canSpawnOverride !== false && this.depth < MAX_DEPTH;

    const tools: any[] = [];

    if (canSpawn) {
      tools.push(this.buildSpawnTool());
    }

    tools.push(this.buildMessageTool(agentId, agentName));
    tools.push(this.buildWaitTool());
    tools.push(this.buildListAgentsTool());
    tools.push(this.buildRequestInputTool(agentId));

    // Inject extra tools (create_memory, save_note, etc.)
    tools.push(...this.extraTools);

    return tools;
  }

  /**
   * Build tools for the main session.
   */
  buildMainTools(): any[] {
    const tools: any[] = [];
    // Note: spawn_agents is intentionally excluded from the main session.
    // Subagents are only spawned via explicit user action (UI spawn dialog,
    // task board, or canvas). The LLM should not auto-spawn on its own.
    tools.push(this.buildMessageTool("main", "Main"));
    tools.push(this.buildWaitTool());
    tools.push(this.buildListAgentsTool());
    return tools;
  }

  private buildSpawnTool(): any {
    const self = this;
    // Use dynamic import for TypeBox since it may not be available at module level
    return {
      name: "spawn_agents",
      label: "Spawn Agents",
      description: `Spawn one or more parallel subagents to work on tasks concurrently. Each agent gets its own context and can use all standard tools (read, write, bash, edit). Use this when work can be parallelized — e.g. researching different parts of a codebase, running tests while fixing code, etc. Each agent works independently and can communicate via the message_agent tool.`,
      parameters: {
        type: "object" as const,
        properties: {
          agents: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                name: {
                  type: "string" as const,
                  description: "Short descriptive name for the agent (e.g. 'Research auth', 'Fix tests')",
                },
                task: {
                  type: "string" as const,
                  description: "Detailed instructions/prompt for what this agent should do",
                },
              },
              required: ["name", "task"],
            },
            description: "Array of agents to spawn with their names and tasks",
          },
        },
        required: ["agents"],
      },
      async execute(
        _toolCallId: string,
        params: { agents: Array<{ name: string; task: string }> },
      ) {
        try {
          const configs: SubagentSpawnConfig[] = params.agents.map((a) => ({
            name: a.name,
            task: a.task,
          }));
          const infos = await self.spawn(configs);
          const names = infos.map((i) => `@${i.name} (${i.id})`).join(", ");
          return {
            content: [
              {
                type: "text" as const,
                text: `Spawned ${infos.length} agent(s): ${names}\n\nThey are now working on their tasks. Use message_agent to communicate with them, or wait_for_agents to wait for results.`,
              },
            ],
            details: { agentIds: infos.map((i) => i.id) },
          };
        } catch (err: any) {
          return {
            content: [{ type: "text" as const, text: `Error spawning agents: ${err.message}` }],
            details: {},
          };
        }
      },
    };
  }

  private buildMessageTool(fromId: string, fromName: string): any {
    const self = this;
    return {
      name: "message_agent",
      label: "Message Agent",
      description: `Send a message to another agent by name. The receiving agent will process the message and may respond. Use @all or "*" to broadcast to all agents. Available agents can be listed with list_agents.`,
      parameters: {
        type: "object" as const,
        properties: {
          to: {
            type: "string" as const,
            description:
              'Name of the target agent (e.g. "Research auth") or "*" to broadcast to all',
          },
          message: {
            type: "string" as const,
            description: "The message content to send",
          },
        },
        required: ["to", "message"],
      },
      async execute(
        _toolCallId: string,
        params: { to: string; message: string },
      ) {
        const result = await self.sendAgentMessage(fromId, params.to, params.message);
        return {
          content: [{ type: "text" as const, text: result }],
          details: {},
        };
      },
    };
  }

  private buildWaitTool(): any {
    const self = this;
    return {
      name: "wait_for_agents",
      label: "Wait for Agents",
      description: `Wait for one or more subagents to finish their current task. Returns their last responses. Use ["*"] to wait for all agents.`,
      parameters: {
        type: "object" as const,
        properties: {
          agents: {
            type: "array" as const,
            items: { type: "string" as const },
            description: 'Agent names to wait for, or ["*"] for all',
          },
          timeout: {
            type: "number" as const,
            description: "Max seconds to wait (default: 300)",
          },
        },
        required: ["agents"],
      },
      async execute(
        _toolCallId: string,
        params: { agents: string[]; timeout?: number },
        signal?: AbortSignal,
      ) {
        const timeoutMs = (params.timeout ?? 300) * 1000;
        const startTime = Date.now();

        // Resolve which agents to wait for
        let targets: SubagentInstance[];
        if (params.agents.length === 1 && params.agents[0] === "*") {
          targets = Array.from(self.agents.values());
        } else {
          targets = [];
          for (const nameOrId of params.agents) {
            const agent = self.findAgent(nameOrId);
            if (agent) targets.push(agent);
          }
        }

        if (targets.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No matching agents found." }],
            details: {},
          };
        }

        // Poll until all are idle or timeout
        while (true) {
          if (signal?.aborted) {
            return {
              content: [{ type: "text" as const, text: "Wait aborted." }],
              details: {},
            };
          }

          const allIdle = targets.every((t) => !t.session.isStreaming);
          if (allIdle) break;

          if (Date.now() - startTime > timeoutMs) {
            const still = targets
              .filter((t) => t.session.isStreaming)
              .map((t) => t.name);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Timeout after ${params.timeout ?? 300}s. Still running: ${still.join(", ")}`,
                },
              ],
              details: {},
            };
          }

          await new Promise((r) => setTimeout(r, 1000));
        }

        // Collect last assistant messages
        const results: string[] = [];
        for (const target of targets) {
          const history = self.getHistory(target.id);
          const lastAssistant = [...history]
            .reverse()
            .find((m) => m.role === "assistant");
          results.push(
            `--- @${target.name} ---\n${lastAssistant?.content || "(no response)"}`
          );
        }

        return {
          content: [{ type: "text" as const, text: results.join("\n\n") }],
          details: {},
        };
      },
    };
  }

  private buildListAgentsTool(): any {
    const self = this;
    return {
      name: "list_agents",
      label: "List Agents",
      description: "List all currently active subagents and their status.",
      parameters: {
        type: "object" as const,
        properties: {},
      },
      async execute() {
        const agents = self.listAll();
        if (agents.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No active subagents." }],
            details: {},
          };
        }
        const lines = agents.map(
          (a) =>
            `@${a.name} (${a.id}) — ${a.isStreaming ? "working" : "idle"}, ${a.messageCount} messages, model: ${a.model || "default"}`
        );
        return {
          content: [
            { type: "text" as const, text: `Active agents:\n${lines.join("\n")}` },
          ],
          details: {},
        };
      },
    };
  }

  private buildRequestInputTool(agentId: string): any {
    const self = this;
    return {
      name: "request_input",
      label: "Request User Input",
      description:
        "Use this tool when you need additional information, clarification, or a decision from the user before you can proceed with the task. " +
        "The task will be moved to the Refinement column and your questions will be shown to the user. " +
        "After calling this tool you should stop working and wait — the user will update the task and re-submit it when ready.",
      parameters: {
        type: "object" as const,
        properties: {
          questions: {
            type: "string" as const,
            description:
              "Your questions or what you need from the user. Be specific about what information is missing and why you need it.",
          },
        },
        required: ["questions"],
      },
      async execute(params: { questions: string }) {
        try {
          const { loadTasks, saveTasks } = await import("./task-store");
          const tasks = await loadTasks(self.cwd);
          let matched = false;

          for (const task of tasks) {
            if (task.subagentId === agentId && task.status !== "done") {
              task.status = "refinement";
              task.done = false;
              task.result = params.questions;
              delete task.subagentId;
              matched = true;
              console.log(
                `[subagent ${agentId}] Moved task "${task.text.slice(0, 40)}" to refinement — awaiting user input`,
              );
              break;
            }
          }

          if (!matched) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "No active task found for this agent. Your questions have been noted but could not be attached to a task.",
                },
              ],
              details: {},
            };
          }

          await saveTasks(self.cwd, tasks);

          // Emit a task_refinement event so the host can broadcast TASKS_CHANGED
          self.onEvent({
            subagentId: agentId,
            event: {
              type: "task_refinement",
              data: { tasks },
            } as any,
          });

          return {
            content: [
              {
                type: "text" as const,
                text:
                  "Your questions have been sent to the user. The task has been moved to Refinement. " +
                  "Stop working on this task now and wait for the user to provide the requested information.",
              },
            ],
            details: {},
          };
        } catch (err) {
          console.error(`[subagent ${agentId}] request_input failed:`, err);
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to request input: ${err}`,
              },
            ],
            isError: true,
            details: {},
          };
        }
      },
    };
  }

  setCwd(cwd: string): void {
    this.disposeAll();
    this.cwd = cwd;
  }
}
