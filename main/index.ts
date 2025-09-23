import { app, BrowserWindow } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureOverlayHandlers,
  maybeShowOverlayOnLaunch,
  setRendererBaseUrl,
} from "./overlayWindow.js";
import { registerGlobalShortcuts } from "./globalShortcuts.js";

let mainWindow: BrowserWindow | null = null;

const MAIN_PRELOAD = fileURLToPath(new URL("../preload/main.js", import.meta.url));

async function createMainWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    title: "Uma RP/TP Tracker",
    show: false,
    backgroundColor: "#050b1a",
    webPreferences: {
      preload: MAIN_PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow = win;

  win.once("ready-to-show", () => {
    win.show();
  });

  win.on("closed", () => {
    mainWindow = null;
  });

  win.webContents.on("did-navigate", (_event, url) => {
    if (url) setRendererBaseUrl(url);
  });
  win.webContents.on("did-navigate-in-page", (_event, url) => {
    if (url) setRendererBaseUrl(url);
  });

  const devUrl = process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL ?? process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    await win.loadURL(devUrl);
    setRendererBaseUrl(devUrl);
  } else {
    const indexHtml = path.join(app.getAppPath(), "dist", "index.html");
    await win.loadFile(indexHtml);
    setRendererBaseUrl(`file://${indexHtml}`);
  }
}

app.whenReady().then(async () => {
  ensureOverlayHandlers();
  registerGlobalShortcuts();
  await createMainWindow();
  maybeShowOverlayOnLaunch();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    await createMainWindow();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
