import React from "react";

import { COLOR } from "../constants";
import type { AbsTimerDisplay } from "../utils/absTimers";
import { mixColor, withAlpha } from "../utils/color";
import { ensureTimeZone, formatDHMS, formatMMSS, now } from "../utils/time";
import type { TimerDisplayData } from "../utils/timers";

export interface TimerOverviewListProps {
  timers: TimerDisplayData[];
  absTimers: AbsTimerDisplay[];
  timeZone: string;
}

export function TimerOverviewList({ timers, absTimers, timeZone }: TimerOverviewListProps) {
  const selectedAbs = absTimers.filter((a) => a.includeInOverview);

  if (!timers.length && !selectedAbs.length)
    return (
      <p style={{ color: COLOR.subtle, fontSize: 13, marginTop: 6, marginBottom: 0 }}>
        No timers selected for overview yet.
      </p>
    );

  const zone = ensureTimeZone(timeZone);
  const nowMs = now();
  const sortedAbs = [...selectedAbs].sort((a, b) => {
    const weight = (t: AbsTimerDisplay) => {
      if (t.status === "active") return t.ts <= nowMs ? 1 : 0;
      if (t.status === "completed") return 2;
      return 3;
    };
    const wa = weight(a);
    const wb = weight(b);
    if (wa !== wb) return wa - wb;
    return a.ts - b.ts;
  });

  const sectionStyle: React.CSSProperties = { display: "grid", gap: 6 };
  const listStyle: React.CSSProperties = {
    display: "grid",
    gap: 8,
    gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
  };

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {timers.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 13, color: COLOR.subtle }}>Custom flexible timers</div>
          <div style={listStyle}>
            {timers.map((t) => {
              const label = t.label || "Timer";
              const status = t.isPaused
                ? `Paused (${formatDHMS(t.remainingMs)})`
                : t.remainingMs <= 0
                ? "Ready"
                : `${formatDHMS(t.remainingMs)} (${formatMMSS(t.remainingMs)})`;
              const accent = t.colorResolved;
              const gradient = `linear-gradient(140deg, ${withAlpha(mixColor(accent, COLOR.bg, 0.4), 0.97)} 0%, ${withAlpha(
                mixColor(accent, "#000000", 0.55),
                0.97
              )} 100%)`;
              const borderColor = withAlpha(mixColor(accent, "#000000", 0.55), 0.88);
              const statusColor = mixColor(accent, "#ffffff", 0.2);
              const progressColor = mixColor(accent, "#ffffff", 0.15);
              const progressTrack = withAlpha(mixColor(accent, COLOR.bg, 0.65), 0.45);
              const shadow = withAlpha(mixColor(accent, "#000000", 0.45), 0.45);
              return (
                <div
                  key={t.id}
                  style={{
                    background: gradient,
                    border: `1px solid ${borderColor}`,
                    borderRadius: 10,
                    padding: 10,
                    boxShadow: `0 10px 22px ${shadow}`,
                    color: COLOR.text,
                    display: "grid",
                    gap: 6,
                    height: "100%",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: t.colorResolved,
                          border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
                          boxShadow: "0 0 4px rgba(0,0,0,0.45)",
                        }}
                      />
                      <span style={{ wordBreak: "break-word" }}>{label}</span>
                    </span>
                    <span style={{ color: statusColor, fontSize: 12 }}>{status}</span>
                  </div>
                  <div
                    style={{
                      height: 4,
                      background: progressTrack,
                      borderRadius: 999,
                      overflow: "hidden",
                      boxShadow: `inset 0 0 4px ${withAlpha("#000000", 0.35)}`,
                    }}
                  >
                    <div
                      style={{
                        width: `${t.progress * 100}%`,
                        background: progressColor,
                        height: "100%",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {sortedAbs.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 13, color: COLOR.subtle }}>Exact date/time timers</div>
          <div style={listStyle}>
            {sortedAbs.map((a) => {
              const rem = a.ts - nowMs;
              const accent = a.group.color;
              const timeLine =
                rem > 0 ? `Time left: ${formatDHMS(rem)} (${formatMMSS(rem)})` : `Ended ${formatDHMS(-rem)} ago`;
              const statusText =
                a.status === "completed"
                  ? "Completed"
                  : a.status === "expired"
                  ? "Expired"
                  : rem <= 0
                  ? "Ended"
                  : "Active";
              const statusColor =
                a.status === "completed"
                  ? COLOR.good
                  : a.status === "expired" || rem <= 0
                  ? COLOR.danger
                  : mixColor(accent, "#ffffff", 0.2);
              const gradient = `linear-gradient(140deg, ${withAlpha(mixColor(accent, COLOR.bg, 0.45), 0.97)} 0%, ${withAlpha(
                mixColor(accent, "#000000", 0.55),
                0.97
              )} 100%)`;
              const borderColor = withAlpha(mixColor(accent, "#000000", 0.55), 0.88);
              const shadow = withAlpha(mixColor(accent, "#000000", 0.45), 0.45);
              return (
                <div
                  key={a.id}
                  style={{
                    background: gradient,
                    border: `1px solid ${borderColor}`,
                    borderRadius: 10,
                    padding: 10,
                    boxShadow: `0 10px 22px ${shadow}`,
                    color: COLOR.text,
                    display: "grid",
                    gap: 6,
                    height: "100%",
                  }}
                >
                  <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{a.label || a.group.name}</div>
                  <div style={{ fontSize: 12, color: COLOR.subtle }}>
                    At: {new Date(a.ts).toLocaleString(undefined, { timeZone: zone })}
                  </div>
                  <div style={{ fontSize: 13 }}>{timeLine}</div>
                  <div style={{ fontSize: 12, color: statusColor }}>Status: {statusText}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
