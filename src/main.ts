/**
 * Electron main process — thin proxy to the tau-daemon.
 *
 * Responsibilities:
 * - BrowserWindow creation and management
 * - Native dialogs (directory picker)
 * - Theme detection and forwarding
 * - IPC proxy: renderer ↔ daemon via DaemonClient
 * - Daemon lifecycle (spawn / connect / reconnect)
 */
import { app, BrowserWindow, dialog, ipcMain, nativeTheme } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { IPC } from "./shared/ipc-channels";
import { DaemonClient, wireDaemonToIpc } from "./daemon-client";
import { PtyManager } from "./pty-manager";

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
const daemonClient = new DaemonClient();
let ptyManager: PtyManager | null = null;

// ── Window creation ─────────────────────────────────────────────────

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 600,
    minHeight: 400,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 15, y: 15 },
    vibrancy: "under-window",
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.webContents.openDevTools({ mode: "detach" });
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

function sendToRenderer(channel: string, data: any) {
  mainWindow?.webContents.send(channel, data);
}

// ── Electron-native IPC handlers ────────────────────────────────────
// These MUST stay in Electron — they use native APIs (dialogs, theme).

ipcMain.handle(IPC.APP_SELECT_DIR, async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle(IPC.APP_GET_THEME, () =>
  nativeTheme.shouldUseDarkColors ? "dark" : "light",
);

ipcMain.handle(IPC.APP_SET_THEME, (_event, theme: "system" | "light" | "dark") => {
  nativeTheme.themeSource = theme;
});

nativeTheme.on("updated", () => {
  sendToRenderer(
    IPC.APP_GET_THEME,
    nativeTheme.shouldUseDarkColors ? "dark" : "light",
  );
});

// ── PTY (terminal) IPC handlers ─────────────────────────────────────
// PTY runs in main process (native module, needs direct window access).

function setupPtyHandlers() {
  ptyManager = new PtyManager(
    // onData: push terminal output to renderer
    (id, data) => sendToRenderer(IPC.PTY_DATA, { id, data }),
    // onExit: notify renderer
    (id, exitCode) => sendToRenderer(IPC.PTY_EXIT, { id, exitCode }),
  );

  ipcMain.handle(IPC.PTY_CREATE, (_e, cwd: string, cols: number, rows: number) => {
    return ptyManager!.create(cwd, cols, rows);
  });

  ipcMain.handle(IPC.PTY_WRITE, (_e, id: string, data: string) => {
    ptyManager!.write(id, data);
  });

  ipcMain.handle(IPC.PTY_RESIZE, (_e, id: string, cols: number, rows: number) => {
    ptyManager!.resize(id, cols, rows);
  });

  ipcMain.handle(IPC.PTY_CLOSE, (_e, id: string) => {
    ptyManager!.close(id);
  });
}

// ── App lifecycle ───────────────────────────────────────────────────

app.on("ready", async () => {
  createWindow();
  setupPtyHandlers();

  // Connect to daemon (spawning it if needed)
  try {
    await daemonClient.ensureRunning();
    console.log("[main] Connected to tau-daemon");

    // Wire all IPC channels as proxies to daemon RPC
    wireDaemonToIpc(daemonClient, ipcMain, () => mainWindow, IPC);
  } catch (err) {
    console.error("[main] Failed to connect to daemon:", err);
    // The app can still show UI — the daemon client will auto-reconnect
  }

  // Forward heartbeat notifications (optional: for status bar)
  daemonClient.onNotification("daemon.heartbeat", (params) => {
    sendToRenderer("daemon:heartbeat", params);
  });

  daemonClient.onDisconnect = () => {
    console.warn("[main] Lost connection to daemon — reconnecting...");
  };
});

app.on("window-all-closed", () => {
  // Clean up PTY processes
  ptyManager?.dispose();
  ptyManager = null;
  // Disconnect but DON'T kill the daemon — it persists
  daemonClient.disconnect();
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
    // Reconnect if needed
    if (!daemonClient.connected) {
      daemonClient.ensureRunning().catch((err) => {
        console.error("[main] Failed to reconnect to daemon:", err);
      });
    }
  }
});
