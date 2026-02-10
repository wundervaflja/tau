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
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, Tray, Menu, nativeImage } from "electron";
import path from "node:path";
import started from "electron-squirrel-startup";
import { IPC } from "./shared/ipc-channels";
import { DaemonClient, wireDaemonToIpc } from "./daemon-client";
import { PtyManager } from "./pty-manager";

if (started) app.quit();

let mainWindow: BrowserWindow | null = null;
const daemonClient = new DaemonClient();
let ptyManager: PtyManager | null = null;
let tray: Tray | null = null;

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

// ── System tray ─────────────────────────────────────────────────────

// 16x16 tau (τ) template PNG — black on transparent for macOS auto dark/light
const TRAY_ICON_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHUlEQVR4nGNgGHbgP5GYdgbgMpBsMGrAsDBgCAAA2g4j3XGGrdEAAAAASUVORK5CYII=";

function createTray() {
  const icon = nativeImage.createFromDataURL(
    `data:image/png;base64,${TRAY_ICON_B64}`,
  );
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip("Tau");
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  const connected = daemonClient.connected;
  const menu = Menu.buildFromTemplate([
    { label: `Daemon: ${connected ? "Running" : "Stopped"}`, enabled: false },
    { type: "separator" },
    {
      label: connected ? "Stop Daemon" : "Start Daemon",
      click: async () => {
        if (connected) {
          try {
            await daemonClient.call("daemon.shutdown", {});
          } catch { /* daemon may already be gone */ }
          daemonClient.disconnect();
        } else {
          try {
            await daemonClient.ensureRunning();
          } catch (err) {
            console.error("[main] Failed to start daemon from tray:", err);
          }
        }
        updateTrayMenu();
      },
    },
    { type: "separator" },
    {
      label: "Show Window",
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
        }
      },
    },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
}

// ── App lifecycle ───────────────────────────────────────────────────

app.on("ready", async () => {
  createWindow();
  setupPtyHandlers();
  createTray();

  // Wire all IPC channels as proxies to daemon RPC.
  // This must happen BEFORE daemon connection so the renderer always has
  // handlers registered — calls will queue/fail gracefully if daemon is down.
  wireDaemonToIpc(daemonClient, ipcMain, () => mainWindow, IPC);

  // Connect to daemon (spawning it if needed)
  try {
    await daemonClient.ensureRunning();
    console.log("[main] Connected to tau-daemon");
    updateTrayMenu();
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
    updateTrayMenu();
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
