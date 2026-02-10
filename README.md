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

## Data Locations

| Path | Contents |
|------|----------|
| `~/tau/` | Default workspace directory |
| `~/.tau/daemon/` | Daemon runtime (PID, socket, log) |
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
