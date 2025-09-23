import { contextBridge, ipcRenderer } from "electron";
import type { OverlayBridge, OverlayState } from "../src/types/overlay.js";

type Listener = (state: OverlayState) => void;

const listeners = new Set<Listener>();

ipcRenderer.on("overlay:state", (_event, state: OverlayState) => {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error("overlay state listener error", error);
    }
  });
});

const overlayBridge: OverlayBridge = {
  async getState() {
    const state = await ipcRenderer.invoke("overlay:get-state");
    return state as OverlayState;
  },
  async show() {
    await ipcRenderer.invoke("overlay:show");
  },
  async hide() {
    await ipcRenderer.invoke("overlay:hide");
  },
  async toggle() {
    await ipcRenderer.invoke("overlay:toggle");
  },
  async lock() {
    await ipcRenderer.invoke("overlay:set-locked", true);
  },
  async unlock() {
    await ipcRenderer.invoke("overlay:set-locked", false);
  },
  async setLocked(value: boolean) {
    await ipcRenderer.invoke("overlay:set-locked", value);
  },
  async setScale(value: number) {
    await ipcRenderer.invoke("overlay:set-scale", value);
  },
  async setOpacity(value: number) {
    await ipcRenderer.invoke("overlay:set-opacity", value);
  },
  async resetBounds() {
    await ipcRenderer.invoke("overlay:reset-bounds");
  },
  async reload() {
    await ipcRenderer.invoke("overlay:reload");
  },
  async setOverlayUrl(url: string) {
    await ipcRenderer.invoke("overlay:set-url", url);
  },
  async setShowOnLaunch(value: boolean) {
    await ipcRenderer.invoke("overlay:set-start", value);
  },
  onState(callback: (state: OverlayState) => void) {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
};

contextBridge.exposeInMainWorld("umaOverlay", overlayBridge);
