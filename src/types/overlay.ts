export interface OverlayBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OverlayPersistedState {
  bounds?: OverlayBounds | null;
  opacity?: number;
  scale?: number;
  locked?: boolean;
  clickThrough?: boolean;
  overlayUrl?: string;
  showOnLaunch?: boolean;
}

export interface OverlayState extends OverlayPersistedState {
  visible: boolean;
}

export interface OverlayRendererState extends OverlayState {
  editing?: boolean;
}

export interface OverlayBridge {
  getState(): Promise<OverlayState>;
  show(): Promise<void>;
  hide(): Promise<void>;
  toggle(): Promise<void>;
  lock(): Promise<void>;
  unlock(): Promise<void>;
  setLocked(value: boolean): Promise<void>;
  setScale(value: number): Promise<void>;
  setOpacity(value: number): Promise<void>;
  resetBounds(): Promise<void>;
  reload(): Promise<void>;
  setOverlayUrl(url: string): Promise<void>;
  setShowOnLaunch(value: boolean): Promise<void>;
  onState(callback: (state: OverlayState) => void): () => void;
}

export interface OverlayRendererBridge {
  getState(): Promise<OverlayRendererState>;
  setLocked(value: boolean): Promise<void>;
  toggleLock(): Promise<void>;
  setScale(value: number): Promise<void>;
  setOpacity(value: number): Promise<void>;
  setOverlayUrl(url: string): Promise<void>;
  onState(callback: (state: OverlayRendererState) => void): () => void;
  reload(): Promise<void>;
}
