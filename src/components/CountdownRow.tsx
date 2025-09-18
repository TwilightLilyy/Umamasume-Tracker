import React, { useEffect, useState } from "react";

import { COLOR } from "../constants";
import { ensureTimeZone, formatDHMS, formatMMSS, now } from "../utils/time";

export function CountdownRow({ targetMs, timeZone }: { targetMs: number; timeZone: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);
  const rem = Math.max(0, targetMs - now());
  const zone = ensureTimeZone(timeZone);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 8,
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <div style={{ fontSize: 13, color: COLOR.subtle }}>
        Absolute: {new Date(targetMs).toLocaleString(undefined, { timeZone: zone })}
      </div>
      <div style={{ fontSize: 14 }}>
        Time left: {formatDHMS(rem)} ({formatMMSS(rem)})
      </div>
    </div>
  );
}
