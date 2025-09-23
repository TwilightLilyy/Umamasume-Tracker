import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OverlayBounds, OverlayState } from "../src/types/overlay.js";

const OVERLAY_STATE_FILE = "overlay-window.json";
const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 180;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3.0;
const MIN_OPACITY = 0.3;
const MAX_OPACITY = 1;

let overlayWindow: BrowserWindow | null = null;
let stateLoaded = false;
let rendererBaseUrl: string | null =
  process.env.MAIN_WINDOW_VITE_DEV_SERVER_URL ?? process.env.VITE_DEV_SERVER_URL ?? null;
let handlersRegistered = false;

const defaultState: OverlayState = {
  bounds: null,
  opacity: 0.85,
  scale: 1,
  locked: true,
  clickThrough: true,
  overlayUrl: "",
  showOnLaunch: false,
  visible: false,
};

let overlayState: OverlayState = { ...defaultState };

function getStateFile() {
  const userData = app.getPath("userData");
  return path.join(userData, OVERLAY_STATE_FILE);
}

function loadOverlayState() {
  if (stateLoaded) return;
  stateLoaded = true;
  try {
    const file = getStateFile();
    if (!fs.existsSync(file)) return;
    const raw = fs.readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw);
    overlayState = {
      ...overlayState,
      ...parsed,
      visible: false,
    };
  } catch (error) {
    console.warn("Failed to load overlay state", error);
  }
}

function persistOverlayState() {
  try {
    const { visible, ...persisted } = overlayState;
    fs.mkdirSync(path.dirname(getStateFile()), { recursive: true });
    fs.writeFileSync(getStateFile(), JSON.stringify(persisted, null, 2), "utf-8");
  } catch (error) {
    console.warn("Failed to persist overlay state", error);
  }
}

function broadcastState() {
  const state = getOverlayState();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send("overlay:state", state);
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function defaultBaseUrl() {
  try {
    const distPath = path.join(app.getAppPath(), "dist", "index.html");
    if (fs.existsSync(distPath)) {
      return `file://${distPath}`;
    }
  } catch (error) {
    console.warn("Failed to determine default base url", error);
  }
  if (rendererBaseUrl) return rendererBaseUrl;
  const fallback = path.join(app.getAppPath(), "index.html");
  return `file://${fallback}`;
}

function appendPath(base: string, targetPath: string) {
  try {
    const url = new URL(base);
    const normalized = targetPath.startsWith("/") ? targetPath : `/${targetPath}`;
    if (url.protocol === "file:") {
      url.hash = normalized;
      return url.toString();
    }
    url.pathname = normalized;
    return url.toString();
  } catch {
    return `${base.replace(/\/?$/, "")}${targetPath.startsWith("/") ? targetPath : `/${targetPath}`}`;
  }
}

function appendQuery(base: string, query: string) {
  try {
    const url = new URL(base);
    url.search = query.replace(/^\?/, "");
    return url.toString();
  } catch {
    return `${base}${query}`;
  }
}

function resolveOverlayUrl(raw?: string | null) {
  const base = rendererBaseUrl ?? defaultBaseUrl();
  if (!raw || !raw.trim()) {
    return appendPath(base, "/overlay");
  }
  const trimmed = raw.trim();
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith("?")) {
    return appendQuery(base, trimmed);
  }
  if (trimmed.startsWith("/")) {
    return appendPath(base, trimmed);
  }
  return appendPath(base, `/${trimmed}`);
}

function getOverlayPreloadPath() {
  const preloadUrl = new URL("../preload/overlay.js", import.meta.url);
  return fileURLToPath(preloadUrl);
}

function applyLockState(win: BrowserWindow, locked: boolean) {
  win.setIgnoreMouseEvents(locked, { forward: true });
  win.setFocusable(!locked);
  overlayState.locked = locked;
  overlayState.clickThrough = locked;
}

function applyOpacity(win: BrowserWindow, opacity: number) {
  const clamped = clamp(opacity, MIN_OPACITY, MAX_OPACITY);
  win.setOpacity(clamped);
  overlayState.opacity = clamped;
}

function applyBounds(win: BrowserWindow, bounds: OverlayBounds | null | undefined) {
  if (!bounds) return;
  win.setBounds({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(Math.round(bounds.width), 200),
    height: Math.max(Math.round(bounds.height), 120),
  });
}

function handleWindowMoveOrResize() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const bounds = overlayWindow.getBounds();
  overlayState.bounds = bounds;
  persistOverlayState();
  broadcastState();
}

export function setRendererBaseUrl(url: string) {
  rendererBaseUrl = url;
}

export function getOverlayWindow() {
  return overlayWindow;
}

export function getOverlayState(): OverlayState {
  loadOverlayState();
  return {
    ...overlayState,
    visible: overlayWindow?.isVisible() ?? overlayState.visible ?? false,
  };
}

export function createOverlayWindow() {
  loadOverlayState();
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    return overlayWindow;
  }

  const display = screen.getPrimaryDisplay();
  const workArea = display?.workArea ?? { x: 0, y: 0, width: 1280, height: 720 };
  const defaultX = Math.round(workArea.x + (workArea.width - DEFAULT_WIDTH) / 2);
  const defaultY = Math.round(workArea.y + (workArea.height - DEFAULT_HEIGHT) / 3);

  const win = new BrowserWindow({
    width: overlayState.bounds?.width ?? DEFAULT_WIDTH,
    height: overlayState.bounds?.height ?? DEFAULT_HEIGHT,
    x: overlayState.bounds?.x ?? defaultX,
    y: overlayState.bounds?.y ?? defaultY,
    show: false,
    frame: false,
    transparent: true,
    skipTaskbar: true,
    resizable: true,
    movable: true,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: getOverlayPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: true,
    },
  });

  overlayWindow = win;

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyBounds(win, overlayState.bounds);
  applyOpacity(win, overlayState.opacity ?? defaultState.opacity ?? 1);
  applyLockState(win, overlayState.locked !== false);

  win.on("moved", handleWindowMoveOrResize);
  win.on("resized", handleWindowMoveOrResize);
  win.on("closed", () => {
    overlayWindow = null;
    overlayState.visible = false;
    persistOverlayState();
    broadcastState();
  });

  const targetUrl = resolveOverlayUrl(overlayState.overlayUrl);
  win.loadURL(targetUrl).catch((error) => {
    console.error("Failed to load overlay url", error);
  });

  win.once("ready-to-show", () => {
    if (overlayState.visible) {
      win.showInactive();
    }
    broadcastState();
  });

  broadcastState();
  return win;
}

export function showOverlay() {
  const win = createOverlayWindow();
  overlayState.visible = true;
  win.showInactive();
  if (overlayState.locked) {
    win.setIgnoreMouseEvents(true, { forward: true });
  }
  broadcastState();
  persistOverlayState();
}

export function hideOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.hide();
  overlayState.visible = false;
  broadcastState();
  persistOverlayState();
}

export function toggleOverlay() {
  if (overlayWindow && overlayWindow.isVisible()) {
    hideOverlay();
  } else {
    showOverlay();
  }
}

export function setOverlayLocked(locked: boolean) {
  const win = createOverlayWindow();
  applyLockState(win, locked);
  if (!locked) {
    win.focus();
  } else {
    win.blur();
  }
  broadcastState();
  persistOverlayState();
}

export function toggleOverlayLock() {
  setOverlayLocked(!(overlayState.locked ?? true));
}

export function setOverlayScale(scale: number) {
  const clamped = clamp(scale, MIN_SCALE, MAX_SCALE);
  overlayState.scale = clamped;
  persistOverlayState();
  broadcastState();
}

export function adjustOverlayScale(delta: number) {
  const next = (overlayState.scale ?? 1) + delta;
  setOverlayScale(next);
}

export function setOverlayOpacity(opacity: number) {
  const win = createOverlayWindow();
  applyOpacity(win, opacity);
  persistOverlayState();
  broadcastState();
}

export function adjustOverlayOpacity(delta: number) {
  const next = (overlayState.opacity ?? defaultState.opacity ?? 1) + delta;
  setOverlayOpacity(next);
}

export function setOverlayUrl(url: string) {
  overlayState.overlayUrl = url;
  const targetUrl = resolveOverlayUrl(url);
  const win = createOverlayWindow();
  win.loadURL(targetUrl).catch((error) => {
    console.error("Failed to set overlay url", error);
  });
  persistOverlayState();
  broadcastState();
}

export function reloadOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.reloadIgnoringCache();
}

export function resetOverlayBounds() {
  const display = screen.getPrimaryDisplay();
  const workArea = display?.workArea ?? { x: 0, y: 0, width: 1280, height: 720 };
  overlayState.bounds = {
    x: Math.round(workArea.x + (workArea.width - DEFAULT_WIDTH) / 2),
    y: Math.round(workArea.y + (workArea.height - DEFAULT_HEIGHT) / 3),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
  };
  const win = createOverlayWindow();
  applyBounds(win, overlayState.bounds);
  persistOverlayState();
  broadcastState();
}

export function setOverlayStartWithApp(value: boolean) {
  overlayState.showOnLaunch = value;
  persistOverlayState();
  broadcastState();
}

export function ensureOverlayHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  ipcMain.handle("overlay:get-state", () => getOverlayState());
  ipcMain.handle("overlay:show", () => {
    showOverlay();
  });
  ipcMain.handle("overlay:hide", () => {
    hideOverlay();
  });
  ipcMain.handle("overlay:toggle", () => {
    toggleOverlay();
  });
  ipcMain.handle("overlay:set-locked", (_event, locked: boolean) => {
    setOverlayLocked(!!locked);
  });
  ipcMain.handle("overlay:toggle-lock", () => {
    toggleOverlayLock();
  });
  ipcMain.handle("overlay:set-scale", (_event, scale: number) => {
    setOverlayScale(Number(scale));
  });
  ipcMain.handle("overlay:set-opacity", (_event, opacity: number) => {
    setOverlayOpacity(Number(opacity));
  });
  ipcMain.handle("overlay:reset-bounds", () => {
    resetOverlayBounds();
  });
  ipcMain.handle("overlay:set-url", (_event, url: string) => {
    setOverlayUrl(url);
  });
  ipcMain.handle("overlay:reload", () => {
    reloadOverlay();
  });
  ipcMain.handle("overlay:set-start", (_event, value: boolean) => {
    setOverlayStartWithApp(!!value);
  });
}

export function maybeShowOverlayOnLaunch() {
  loadOverlayState();
  if (overlayState.showOnLaunch) {
    showOverlay();
  }
}
