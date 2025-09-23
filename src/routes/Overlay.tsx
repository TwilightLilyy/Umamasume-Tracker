import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  computeCurrent,
  formatDHMS,
  formatMMSS,
  sanitizeResource,
} from "../App";
import {
  OVERLAY_SNAPSHOT_CHANNEL,
  type OverlayRendererState,
  type OverlayResourceSnapshot,
  type OverlaySnapshotPayload,
} from "../types/overlay";
import "../styles/overlay.css";

const TP_RATE_MS = 10 * 60 * 1000;
const TP_CAP = 100;
const RP_RATE_MS = 2 * 60 * 60 * 1000;
const RP_CAP = 5;

interface ResourceState {
  base: number;
  last: number;
  nextOverride: number | null;
}

function now() {
  return Date.now();
}

function safeParseResource(value: unknown, cap: number, fallback: ResourceState): ResourceState {
  if (!value || typeof value !== "object") return fallback;
  return sanitizeResource(value as Partial<ResourceState>, cap, fallback);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseResourceSnapshot(data: unknown): OverlayResourceSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Partial<OverlayResourceSnapshot>;
  if (!isFiniteNumber(raw.value) || !isFiniteNumber(raw.nextMs) || !isFiniteNumber(raw.fullMs))
    return null;
  return {
    value: Math.max(0, raw.value),
    nextMs: Math.max(0, raw.nextMs),
    fullMs: Math.max(0, raw.fullMs),
    atCap: raw.atCap ?? false,
  };
}

function parseOverlaySnapshotData(data: unknown): OverlaySnapshotPayload | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Partial<OverlaySnapshotPayload>;
  const tp = parseResourceSnapshot(raw.tp);
  const rp = parseResourceSnapshot(raw.rp);
  if (!tp || !rp) return null;
  const timestamp = isFiniteNumber(raw.timestamp) ? raw.timestamp : now();
  return { tp, rp, timestamp };
}

function readResource(
  key: string,
  cap: number,
  defaults: ResourceState,
  rateMs: number
): OverlayResourceSnapshot {
  let parsed: unknown = null;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (raw) parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const state = safeParseResource(parsed, cap, defaults);
  const nowMs = now();
  const current = computeCurrent(state.base, state.last, rateMs, cap, state.nextOverride, nowMs);
  const nextMs = Math.max(0, current.nextPoint - nowMs);
  const need = Math.max(0, cap - current.value);
  const first = Math.max(0, nextMs);
  const remaining = need === 0 ? 0 : first + Math.max(0, need - 1) * rateMs;
  return {
    value: current.value,
    nextMs,
    fullMs: remaining,
    atCap: current.value >= cap,
  };
}

function readSnapshot(): OverlaySnapshotPayload {
  return {
    tp: readResource(
      "uma.tp",
      TP_CAP,
      {
        base: TP_CAP,
        last: now(),
        nextOverride: null,
      },
      TP_RATE_MS,
    ),
    rp: readResource(
      "uma.rp",
      RP_CAP,
      {
        base: RP_CAP,
        last: now(),
        nextOverride: null,
      },
      RP_RATE_MS,
    ),
    timestamp: now(),
  };
}

function useOverlaySnapshot() {
  const [snapshot, setSnapshot] = useState<OverlaySnapshotPayload>(() => readSnapshot());
  const preferBroadcastRef = useRef(false);

  useEffect(() => {
    const tick = () => {
      if (preferBroadcastRef.current) return;
      setSnapshot(readSnapshot());
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof BroadcastChannel === "undefined") return;
    let disposed = false;
    const channel = new BroadcastChannel(OVERLAY_SNAPSHOT_CHANNEL);
    channel.onmessage = (event) => {
      if (disposed) return;
      const parsed = parseOverlaySnapshotData(event.data);
      if (!parsed) return;
      preferBroadcastRef.current = true;
      setSnapshot(parsed);
    };
    return () => {
      disposed = true;
      channel.close();
    };
  }, []);

  return snapshot;
}

function useOverlayRendererState() {
  const [state, setState] = useState<OverlayRendererState | null>(null);
  useEffect(() => {
    const bridge = typeof window !== "undefined" ? window.overlayBridge : undefined;
    if (!bridge) return;
    let disposed = false;
    const applyState = (next: OverlayRendererState) => {
      if (disposed) return;
      setState(next);
      document.body.classList.toggle("overlay-unlocked", !(next.locked ?? true));
    };
    bridge.getState().then((s) => {
      if (s) applyState(s);
    });
    const off = bridge.onState(applyState);
    return () => {
      disposed = true;
      off?.();
      document.body.classList.remove("overlay-unlocked");
    };
  }, []);
  return state;
}

function useQueryParams() {
  return useMemo(() => new URLSearchParams(window.location.search), []);
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

function Overlay() {
  const snapshot = useOverlaySnapshot();
  const overlayState = useOverlayRendererState();
  const params = useQueryParams();
  const resizeRef = useRef<{ startX: number; startY: number; width: number; height: number } | null>(null);

  const locked = overlayState?.locked ?? true;
  const scale = clamp(overlayState?.scale ?? 1, 0.25, 4);
  const showShadow = params.get("shadow") !== "0" && params.get("shadow") !== "false";
  const compact = params.get("compact") === "1";
  const fg = params.get("fg") || "#f8fbff";

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const data = resizeRef.current;
    if (!data) return;
    const dx = event.clientX - data.startX;
    const dy = event.clientY - data.startY;
    const nextWidth = Math.max(200, data.width + dx);
    const nextHeight = Math.max(120, data.height + dy);
    window.resizeTo(Math.round(nextWidth), Math.round(nextHeight));
  }, []);

  const handlePointerUp = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
  }, [handlePointerMove]);

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [handlePointerMove, handlePointerUp]);

  const handleGripPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (locked) return;
      event.preventDefault();
      event.stopPropagation();
      resizeRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        width: window.innerWidth,
        height: window.innerHeight,
      };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp, { once: true });
    },
    [locked, handlePointerMove, handlePointerUp],
  );

  const overlayBridge = typeof window !== "undefined" ? window.overlayBridge : undefined;
  const handleLock = useCallback(() => {
    overlayBridge?.setLocked(true).catch(() => {
      /* ignore */
    });
  }, [overlayBridge]);

  const tp = snapshot.tp;
  const rp = snapshot.rp;

  const fgStyle: React.CSSProperties = useMemo(
    () => ({
      color: fg,
      textShadow: showShadow ? "0 2px 12px rgba(0,0,0,0.65)" : undefined,
    }),
    [fg, showShadow],
  );

  const scaleStyle = useMemo<React.CSSProperties>(
    () => ({
      transform: `scale(${scale})`,
      transformOrigin: "top left",
    }),
    [scale],
  );

  const containerClass = compact ? "overlay-shell overlay-compact" : "overlay-shell";

  return (
    <div className={containerClass} style={scaleStyle}>
      {!locked && (
        <div className="overlay-edit-bar">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span role="img" aria-label="editing">
              🔓
            </span>
            <span>Editing overlay</span>
          </div>
          {overlayBridge && (
            <button type="button" onClick={handleLock}>
              Lock overlay
            </button>
          )}
        </div>
      )}
      <div className="overlay-content" style={fgStyle}>
        <section className="overlay-row">
          <div className="overlay-label">TP</div>
          <div className="overlay-value">{tp.value}</div>
          <div className="overlay-sub">
            Next +1 in {formatMMSS(tp.nextMs)} • Full in {formatDHMS(tp.fullMs)}
          </div>
          {tp.atCap && <div className="overlay-cap">AT CAP</div>}
        </section>
        <section className="overlay-row">
          <div className="overlay-label">RP</div>
          <div className="overlay-value">{rp.value}</div>
          <div className="overlay-sub">
            Next +1 in {formatMMSS(rp.nextMs)} • Full in {formatDHMS(rp.fullMs)}
          </div>
          {rp.atCap && <div className="overlay-cap">AT CAP</div>}
        </section>
      </div>
      <div className="overlay-resize-grip" onPointerDown={handleGripPointerDown} />
    </div>
  );
}

export default Overlay;
