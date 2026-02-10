# Tau

A desktop AI assistant powered by the [pi-coding-agent](https://github.com/niclas-niclasmariozechner/pi-coding-agent) SDK. Tau provides a ChatGPT-like conversational interface with deep workspace integration — git, terminal, memory vault, task management, and multi-agent orchestration.

## Prerequisites

- **Node.js >= 18** (recommended: latest LTS via [nvm](https://github.com/nvm-sh/nvm))
- **macOS** (primary target; Windows/Linux support planned)

## Getting Started

```bash
# Install dependencies
npm install

# Run in development mode (Electron + Vite HMR)
npm start
```

The app will launch with a dev server and auto-open DevTools.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Dev mode with hot reload |
| `npm test` | Run tests (Vitest) |
| `npm run test:watch` | Tests in watch mode |
| `npm run lint` | ESLint check |
| `npm run daemon` | Run daemon standalone (dev) |
| `npm run make:dmg` | Build macOS DMG installer |
| `npm run package` | Package app (no installer) |
| `npm run make` | Build all platform installers |

## Architecture

Tau uses a three-process architecture:

```
┌─────────────┐     IPC      ┌─────────────────┐   JSON-RPC/WS   ┌──────────────┐
│  Renderer    │◄────────────►│  Main Process    │◄───────────────►│   Daemon     │
│  (React 19)  │              │  (Electron)      │                 │  (Node.js)   │
└─────────────┘              └─────────────────┘                 └──────────────┘
```

- **Renderer** — React UI with Tailwind CSS, communicates via preload bridge
- **Main Process** — Electron shell: window management, native dialogs, system tray, PTY terminals. Proxies all IPC to the daemon.
- **Daemon** — Persistent Node.js sidecar (survives app restarts). Owns the AI agent, data stores, memory vault, heartbeat, and task watcher. Communicates via WebSocket JSON-RPC 2.0 over a Unix domain socket.

## Features

- Conversational AI interface with streaming responses
- Workspace-aware sessions grouped by project folder
- Git integration (status, diff, commit, branch management)
- Integrated terminal (xterm.js + PTY)
- Memory vault — persistent knowledge with decay/reinforcement
- Soul system — evolving personality and identity
- Skills — reusable prompt templates the agent can learn
- Task management — markdown-based task tracking with file watcher
- Subagent orchestration — up to 10 parallel agents
- System tray with daemon start/stop control
- Command palette (Cmd+K)

## Daemon Extensions

Tau supports sandboxed runtime extensions that run in isolated Worker threads. Drop a `.js` file into `~/.tau/extensions/` and the daemon loads it automatically — no rebuild required. Extensions are hot-reloaded on file changes.

Each extension runs in its own Worker thread with resource limits (64MB heap). It communicates with the daemon exclusively via structured message passing — no direct access to daemon internals.

### Writing an Extension

```javascript
// ~/.tau/extensions/my-extension.js
import { parentPort } from "node:worker_threads";

parentPort.on("message", async (msg) => {
  switch (msg.type) {
    case "init":
      // Register tools the LLM can call, and events to subscribe to
      parentPort.postMessage({
        type: "register",
        tools: [
          {
            name: "my_tool",
            description: "Does something useful",
            parameters: { input: { type: "string" } },
          },
        ],
        events: ["journal:changed"],
      });
      break;

    case "tool_call":
      // Handle tool invocations
      if (msg.name === "my_tool") {
        const result = await doSomething(msg.params.input);
        parentPort.postMessage({ type: "tool_result", id: msg.id, result });
      }
      break;

    case "event":
      // Handle subscribed events
      break;

    case "shutdown":
      process.exit(0);
  }
});
```

### Extension API (message types)

**Daemon → Extension:**

| Message | Description |
|---------|-------------|
| `{ type: "init", extensionId }` | Sent once on load. Extension must respond with `register`. |
| `{ type: "tool_call", id, name, params }` | LLM invoked one of your tools. Respond with `tool_result`. |
| `{ type: "event", event, data }` | An event you subscribed to was fired. |
| `{ type: "shutdown" }` | Daemon is stopping. Clean up and exit. |

**Extension → Daemon:**

| Message | Description |
|---------|-------------|
| `{ type: "register", tools, events }` | Declare tools and event subscriptions (required on init). |
| `{ type: "tool_result", id, result, error? }` | Return result for a tool call. |
| `{ type: "log", level, message }` | Log to daemon console (`info`, `warn`, `error`). |
| `{ type: "create_memory", memoryType, title, content, tags? }` | Create a vault memory note. |
| `{ type: "bash", id, command, timeout? }` | Execute a shell command. Result returned as `tool_result`. |

### Sandbox Guarantees

- Each extension runs in an isolated Worker thread — no shared memory with the daemon
- Resource-limited: 64MB old generation heap, 16MB young generation, 16MB code range
- Tool calls timeout after 30 seconds
- Init must complete within 5 seconds
- Crashed extensions don't affect the daemon or other extensions
- Extensions can be terminated at any time

### Management

Extensions are managed via RPC:

| RPC Method | Description |
|------------|-------------|
| `ext.list` | List loaded extensions and their status |
| `ext.reload` | Stop all extensions and reload from disk |
| `ext.tools` | List all tools registered by extensions |
| `ext.callTool` | Invoke an extension tool by name |

An example extension is provided at `~/.tau/extensions/example-weather.js.disabled` — rename to `.js` to activate.

## Data Locations

| Path | Contents |
|------|----------|
| `~/tau/` | Default workspace directory |
| `~/.tau/daemon/` | Daemon runtime (PID, socket, log) |
| `~/.tau/extensions/` | Sandboxed daemon extensions (.js files) |
| `~/.tau/vault/` | Memory vault (markdown files) |
| `~/Library/Application Support/tau/` | App data (skills, notes, telemetry, keys) |

## Building for Distribution

```bash
# Build macOS DMG
npm run make:dmg
```

The build process bundles the daemon as an ESM package in `extraResources/daemon-pkg/` via `scripts/prepare-daemon.sh`. The packaged app locates the user's system Node.js (>= v18) at runtime to run the daemon, since Electron's `RunAsNode` fuse is disabled for code signing.

## Tech Stack

- [Electron](https://www.electronjs.org/) 40.x with [Electron Forge](https://www.electronforge.io/) 7.x
- [React](https://react.dev/) 19 + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) 5.x (bundler)
- [Tailwind CSS](https://tailwindcss.com/) 4.x
- [xterm.js](https://xtermjs.org/) 6.x (terminal)
- [Vitest](https://vitest.dev/) 4.x (testing)
- [pi-coding-agent](https://github.com/niclas-niclasmariozechner/pi-coding-agent) SDK

## License

MIT
