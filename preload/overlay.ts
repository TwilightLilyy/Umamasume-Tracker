import { contextBridge, ipcRenderer } from "electron";
import type { OverlayRendererBridge, OverlayRendererState } from "../src/types/overlay.js";

type Listener = (state: OverlayRendererState) => void;

const listeners = new Set<Listener>();

ipcRenderer.on("overlay:state", (_event, state: OverlayRendererState) => {
  listeners.forEach((listener) => {
    try {
      listener(state);
    } catch (error) {
      console.error("overlay renderer listener error", error);
    }
  });
});

const overlayRendererBridge: OverlayRendererBridge = {
  async getState() {
    const state = await ipcRenderer.invoke("overlay:get-state");
    return state as OverlayRendererState;
  },
  async setLocked(value: boolean) {
    await ipcRenderer.invoke("overlay:set-locked", value);
  },
  async toggleLock() {
    await ipcRenderer.invoke("overlay:toggle-lock");
  },
  async setScale(value: number) {
    await ipcRenderer.invoke("overlay:set-scale", value);
  },
  async setOpacity(value: number) {
    await ipcRenderer.invoke("overlay:set-opacity", value);
  },
  async setOverlayUrl(url: string) {
    await ipcRenderer.invoke("overlay:set-url", url);
  },
  onState(callback: (state: OverlayRendererState) => void) {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
  async reload() {
    await ipcRenderer.invoke("overlay:reload");
  },
};

contextBridge.exposeInMainWorld("overlayBridge", overlayRendererBridge);
