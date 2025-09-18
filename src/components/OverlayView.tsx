import React, { useEffect, useState } from "react";

import { COLOR } from "../constants";
import type { AbsTimer } from "../utils/absTimers";
import { ensureTimeZone, formatDHMS, formatMMSS, now } from "../utils/time";
import type { CurrentResource } from "../utils/resources";
import type { TimerData } from "../utils/timers";

export interface OverlayViewProps {
  overlay: string;
  curTP: CurrentResource;
  curRP: CurrentResource;
  tpFull: { ms: number; at: number };
  rpFull: { ms: number; at: number };
  nextReset: number;
  timers: TimerData[];
  absTimers: AbsTimer[];
  timeZone: string;
}

export function OverlayView({ overlay, curTP, curRP, tpFull, rpFull, nextReset, timers, absTimers, timeZone }: OverlayViewProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const styleTxt: React.CSSProperties = {
    fontFamily: "Inter, ui-sans-serif, system-ui",
    color: COLOR.text,
  };
  const slab: React.CSSProperties = { fontSize: 64, fontWeight: 900, letterSpacing: 1 };
  const sub: React.CSSProperties = { fontSize: 16, color: COLOR.subtle };
  const zone = ensureTimeZone(timeZone);

  if (overlay === "tp")
    return (
      <div style={{ ...styleTxt }}>
        <div style={{ ...slab, color: COLOR.tp }}>TP: {curTP.value}</div>
        <div style={sub}>
          Next: {formatMMSS(curTP.nextPoint - now())} • Full: {formatDHMS(tpFull.ms)}
        </div>
      </div>
    );
  if (overlay === "rp")
    return (
      <div style={{ ...styleTxt }}>
        <div style={{ ...slab, color: COLOR.rp }}>RP: {curRP.value}</div>
        <div style={sub}>
          Next: {formatMMSS(curRP.nextPoint - now())} • Full: {formatDHMS(rpFull.ms)}
        </div>
      </div>
    );
  if (overlay === "reset")
    return (
      <div style={{ ...styleTxt }}>
        <div style={{ ...slab }}>Daily Reset</div>
        <div style={sub}>{new Date(nextReset).toLocaleString(undefined, { timeZone: zone })}</div>
        <div style={{ fontSize: 32, marginTop: 8 }}>{formatDHMS(nextReset - now())}</div>
      </div>
    );
  if (overlay.startsWith("timer:")) {
    const id = overlay.split(":")[1];
    const t = timers.find((x) => x.id === id);
    if (!t) return <div>Timer not found.</div>;
    const rem = t.isPaused
      ? Number.isFinite(t.pausedRemaining)
        ? (t.pausedRemaining as number)
        : Math.max(0, (t.targetTs ?? 0) - now())
      : Math.max(0, (t.targetTs ?? 0) - now());
    return (
      <div style={{ ...styleTxt }}>
        <div style={{ ...slab }}>{t.label || "Timer"}</div>
        <div style={{ fontSize: 32 }}>
          {formatDHMS(rem)} ({formatMMSS(rem)})
        </div>
      </div>
    );
  }
  if (overlay.startsWith("abs:")) {
    const id = overlay.split(":")[1];
    const a = absTimers.find((x) => x.id === id);
    if (!a) return <div>Timer not found.</div>;
    const rem = a.ts - now();
    return (
      <div style={{ ...styleTxt }}>
        <div style={{ ...slab }}>{a.label || "Timer"}</div>
        <div style={sub}>{new Date(a.ts).toLocaleString(undefined, { timeZone: zone })}</div>
        <div style={{ fontSize: 32 }}>
          {formatDHMS(rem)} ({formatMMSS(rem)})
        </div>
      </div>
    );
  }
  return <div>Unknown overlay.</div>;
}
