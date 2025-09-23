import type { OverlayBridge, OverlayRendererBridge } from "./overlay";

declare global {
  interface Window {
    umaOverlay?: OverlayBridge;
    overlayBridge?: OverlayRendererBridge;
  }
}

export {};
