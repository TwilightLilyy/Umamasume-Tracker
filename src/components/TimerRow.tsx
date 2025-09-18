import React from "react";

import { COLOR } from "../constants";
import { cardRowStyle, mixColor, sanitizeTimerColor, withAlpha } from "../utils/color";
import { formatDHMS, formatMMSS } from "../utils/time";
import type { TimerData, TimerDisplayData } from "../utils/timers";
import { Checkbox, SmallBtn } from "./ui";

export interface TimerRowProps {
  t: TimerData;
  meta: TimerDisplayData;
  onAddMinutes: (minutes: number) => void;
  onPause: (pause: boolean) => void;
  onReset: () => void;
  onDelete: () => void;
  onCopy: () => void;
  onColorChange: (color: string) => void;
  onToggleOverview: (include: boolean) => void;
}

export function TimerRow({
  t,
  meta,
  onAddMinutes,
  onPause,
  onReset,
  onDelete,
  onCopy,
  onColorChange,
  onToggleOverview,
}: TimerRowProps) {
  const remaining = meta.remainingMs;
  const statusLabel = t.isPaused
    ? `Paused (${formatDHMS(remaining)})`
    : remaining <= 0
    ? "Ready"
    : `${formatDHMS(remaining)} (${formatMMSS(remaining)})`;
  const colorValue = t.color ?? meta.colorResolved;
  const track = withAlpha(mixColor(meta.colorResolved, COLOR.bg, 0.6), 0.35);
  const fill = `linear-gradient(135deg, ${withAlpha(mixColor(meta.colorResolved, "#ffffff", 0.35), 0.95)} 0%, ${withAlpha(
    mixColor(meta.colorResolved, "#000000", 0.2),
    0.95
  )} 100%)`;
  return (
    <div style={cardRowStyle(meta.colorResolved)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              background: colorValue,
              border: `1px solid ${withAlpha(mixColor(meta.colorResolved, "#000000", 0.25), 0.9)}`,
              boxShadow: `0 0 10px ${withAlpha(meta.colorResolved, 0.65)}`,
              cursor: "pointer",
              position: "relative",
              flexShrink: 0,
            }}
            title="Change timer color"
          >
            <input
              type="color"
              value={colorValue}
              onChange={(e) => onColorChange(sanitizeTimerColor(e.target.value, 0))}
              style={{
                position: "absolute",
                inset: 0,
                opacity: 0,
                cursor: "pointer",
              }}
            />
          </label>
          <div>
            <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{t.label || "Timer"}</div>
            <div style={{ fontSize: 13, color: withAlpha(meta.colorResolved, 0.7) }}>Remaining</div>
            <div style={{ fontSize: 14, color: COLOR.text }}>{statusLabel}</div>
          </div>
        </div>
        <div
          style={{
            marginTop: 6,
            height: 4,
            background: track,
            borderRadius: 999,
            overflow: "hidden",
            boxShadow: `inset 0 0 4px ${withAlpha("#000000", 0.28)}`,
          }}
        >
          <div
            style={{
              width: `${meta.progress * 100}%`,
              background: fill,
              height: "100%",
              transition: "width 0.3s ease",
            }}
          />
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <SmallBtn onClick={() => onAddMinutes(1)}>+1m</SmallBtn>
        <SmallBtn onClick={() => onAddMinutes(5)}>+5m</SmallBtn>
        {t.isPaused ? (
          <SmallBtn onClick={() => onPause(false)}>Resume</SmallBtn>
        ) : (
          <SmallBtn onClick={() => onPause(true)}>Pause</SmallBtn>
        )}
        <SmallBtn onClick={onReset}>Reset</SmallBtn>
        <SmallBtn onClick={onCopy}>Copy Overlay URL</SmallBtn>
        <SmallBtn danger onClick={onDelete}>
          Delete
        </SmallBtn>
        <Checkbox
          checked={meta.includeInOverview}
          onChange={onToggleOverview}
          label="Include in overview"
        />
      </div>
    </div>
  );
}
