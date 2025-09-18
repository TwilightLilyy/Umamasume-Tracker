import React, { useState } from "react";

import { COLOR } from "../constants";
import { clamp } from "../utils/color";
import { ensureTimeZone, formatDHMS, formatMMSS, now, parseFlexible } from "../utils/time";
import { CurrentResource, ResourceState } from "../utils/resources";
import { Checkbox, Input, ProgressBar, RowRight, SmallBtn } from "./ui";

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export interface ResourceCardProps {
  accent: string;
  name: string;
  cap: number;
  rateMs: number;
  state: ResourceState;
  setState: SetState<ResourceState>;
  current: CurrentResource;
  onMinus: () => void;
  onPlus: () => void;
  onSpend30: (() => void) | null;
  onUseOne: (() => void) | null;
  milestones: number[];
  milestoneTimes: Record<number, number>;
  fullInfo: { ms: number; at: number };
  onSetNextOverride: (value: string) => void;
  hud: boolean;
  onCopyOverlay: () => void;
  timeZone: string;
}

export function ResourceCard({
  accent,
  name,
  cap,
  rateMs,
  state,
  setState,
  current,
  onMinus,
  onPlus,
  onSpend30,
  onUseOne,
  milestones,
  milestoneTimes: milestoneLookup,
  fullInfo,
  onSetNextOverride,
  hud,
  onCopyOverlay,
  timeZone,
}: ResourceCardProps) {
  const [nextInput, setNextInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const timeToNext = current.nextPoint - now();
  const place = "mm:ss, 10m, 2h, or seconds";
  const zone = ensureTimeZone(timeZone);

  const bigValStyle: React.CSSProperties = {
    fontWeight: 800,
    letterSpacing: 0.5,
    color: accent,
    fontSize: hud ? 44 : 28,
  };

  return (
    <div
      style={{
        background: COLOR.card,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 14,
        padding: 12,
        boxShadow: "0 4px 18px rgba(0,0,0,.22)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 12, color: COLOR.subtle }}>
          1 per {rateMs / 60000 >= 60 ? `${rateMs / 3600000}h` : `${rateMs / 60000}m`} • Cap {cap}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4 }}>
        <div style={bigValStyle}>{current.value}</div>
        <ProgressBar value={current.value} max={cap} color={accent} />
      </div>

      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        <div style={{ fontSize: 13, color: COLOR.subtle }}>
          Next in: {formatDHMS(timeToNext)} ({formatMMSS(timeToNext)})
        </div>
        <div style={{ fontSize: 13, color: COLOR.subtle }}>
          Full in: {formatDHMS(fullInfo.ms)} ({formatMMSS(fullInfo.ms)})
        </div>
        <div style={{ fontSize: 13, color: COLOR.subtle }}>
          Next point at: {new Date(current.nextPoint).toLocaleString(undefined, { timeZone: zone })}
        </div>
        <div style={{ fontSize: 13, color: COLOR.subtle }}>
          Full at: {new Date(fullInfo.at).toLocaleString(undefined, { timeZone: zone })}
        </div>
        {milestones.map((m) => (
          <div key={m} style={{ fontSize: 13, color: COLOR.subtle }}>
            {m} at: {new Date(milestoneLookup[m]).toLocaleString(undefined, { timeZone: zone })}
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
        <SmallBtn onClick={onMinus}>-1</SmallBtn>
        <SmallBtn onClick={onPlus}>+1</SmallBtn>
        {onSpend30 && <SmallBtn onClick={onSpend30}>Spend 30</SmallBtn>}
        {onUseOne && <SmallBtn onClick={onUseOne}>Use 1</SmallBtn>}
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Input placeholder={place} value={nextInput} onChange={setNextInput} />
          <SmallBtn
            onClick={() => {
              const parsed = parseFlexible(nextInput);
              if (parsed == null) return;
              const next = now() + parsed;
              setState((prev) => ({ ...prev, nextOverride: next }));
              setNextInput("");
            }}
          >
            Override next point
          </SmallBtn>
          <SmallBtn
            onClick={() => {
              setState((prev) => ({ ...prev, nextOverride: null }));
              setNextInput("");
            }}
          >
            Clear override
          </SmallBtn>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <Input placeholder="Set value" value={amountInput} onChange={setAmountInput} />
          <SmallBtn
            onClick={() => {
              const n = parseInt(amountInput, 10);
              if (!Number.isNaN(n))
                setState((prev) => ({
                  base: clamp(n, 0, cap),
                  last: now(),
                  nextOverride: prev.nextOverride ?? null,
                }));
              setAmountInput("");
            }}
          >
            Set
          </SmallBtn>
        </div>
      </div>

      <RowRight>
        <SmallBtn onClick={onCopyOverlay}>Copy Overlay URL</SmallBtn>
      </RowRight>

      <div style={{ marginTop: 12, display: "grid", gap: 6 }}>
        <Checkbox
          checked={state.nextOverride != null}
          onChange={(checked) => {
            if (!checked) {
              setState((prev) => ({ ...prev, nextOverride: null }));
            }
          }}
          label="Override next point"
        />
        <Input
          value={state.nextOverride ? new Date(state.nextOverride).toISOString() : ""}
          onChange={onSetNextOverride}
          placeholder="Next point timestamp"
        />
      </div>
    </div>
  );
}
