import { app, globalShortcut } from "electron";
import { adjustOverlayOpacity, adjustOverlayScale, reloadOverlay, toggleOverlay, toggleOverlayLock } from "./overlayWindow.js";

export function registerGlobalShortcuts() {
  globalShortcut.register("Control+Alt+O", () => {
    toggleOverlay();
  });
  globalShortcut.register("Control+Alt+M", () => {
    toggleOverlayLock();
  });
  globalShortcut.register("Control+Alt+=", () => {
    adjustOverlayScale(0.1);
  });
  globalShortcut.register("Control+Alt+-", () => {
    adjustOverlayScale(-0.1);
  });
  globalShortcut.register("Control+Alt+Up", () => {
    adjustOverlayOpacity(0.05);
  });
  globalShortcut.register("Control+Alt+Down", () => {
    adjustOverlayOpacity(-0.05);
  });
  globalShortcut.register("Control+Alt+R", () => {
    reloadOverlay();
  });
}

export function unregisterGlobalShortcuts() {
  globalShortcut.unregister("Control+Alt+O");
  globalShortcut.unregister("Control+Alt+M");
  globalShortcut.unregister("Control+Alt+=");
  globalShortcut.unregister("Control+Alt+-");
  globalShortcut.unregister("Control+Alt+Up");
  globalShortcut.unregister("Control+Alt+Down");
  globalShortcut.unregister("Control+Alt+R");
}

app.on("will-quit", () => {
  unregisterGlobalShortcuts();
});
