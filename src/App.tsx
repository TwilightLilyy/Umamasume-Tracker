import React, { useEffect, useMemo, useState } from "react";

const DEFAULT_TZ = "America/Chicago";

function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function ensureTimeZone(value: string) {
  return isValidTimeZone(value) ? value : DEFAULT_TZ;
}
const COLOR = {
  bg: "#0b1220",
  card: "#121a2a",
  border: "#1d2a44",
  text: "#d8e0f0",
  subtle: "#a8b3c7",
  tp: "#f0b428",
  rp: "#4ea1ff",
  good: "#36d399",
  danger: "#ef4444",
  slate700: "#334155",
};

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
const now = () => Date.now();

export function formatDHMS(ms: number) {
  if (!Number.isFinite(ms)) ms = 0;
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const d = Math.floor(totalSec / 86400);
  const h = Math.floor((totalSec % 86400) / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h || d) parts.push(`${h}h`);
  if (m || h || d) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(" ");
}

export function formatMMSS(ms: number) {
  if (!Number.isFinite(ms)) ms = 0;
  if (ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function isNumericString(v: unknown) {
  if (!v && v !== 0) return false;
  const s = String(v);
  let dots = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === ".") {
      dots++;
      if (dots > 1) return false;
      continue;
    }
    if (c < "0" || c > "9") return false;
  }
  return true;
}

export function parseFlexible(input: unknown) {
  if (!input && input !== 0) return null;
  const v = String(input).trim().toLowerCase();
  if (!v) return null;
  if (v.includes(":")) {
    const [mm, ss] = v.split(":");
    if (!isNumericString(mm) || !isNumericString(ss)) return null;
    const m = parseInt(mm, 10);
    const s = parseInt(ss, 10);
    if (Number.isNaN(m) || Number.isNaN(s) || s >= 60) return null;
    return (m * 60 + s) * 1000;
  }
  const units = [
    "hours",
    "hour",
    "hrs",
    "hr",
    "h",
    "minutes",
    "minute",
    "mins",
    "min",
    "m",
    "seconds",
    "second",
    "secs",
    "sec",
    "s",
  ];
  for (const u of units) {
    if (v.endsWith(u)) {
      const num = v.slice(0, -u.length).trim();
      if (!isNumericString(num)) return null;
      const n = parseFloat(num);
      const first = u[0];
      if (first === "h") return n * 3600 * 1000;
      if (first === "m") return n * 60 * 1000;
      if (first === "s") return n * 1000;
    }
  }
  if (isNumericString(v)) return parseFloat(v) * 1000;
  return null;
}

function getTZOffsetDesignator(timeZone: string) {
  const zone = ensureTimeZone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    let off =
      parts.find((p) => p.type === "timeZoneName")?.value || "GMT-05:00";
    if (off.startsWith("GMT")) off = off.slice(3);
    if (off.startsWith("UTC")) off = off.slice(3);
    off = off.trim();
    const sign = off[0];
    if ((sign === "+" || sign === "-") && off.length >= 5) {
      if (off.indexOf(":") === -1 && off.length === 5)
        return `${off.slice(0, 3)}:${off.slice(3)}`;
      return off;
    }
  } catch (error) {
    console.warn("Failed to read timezone offset", error);
  }
  return "-05:00";
}

export function nextDailyResetTS(base = new Date(), timeZone = DEFAULT_TZ) {
  const d = new Date(base);
  const zone = ensureTimeZone(timeZone);
  const locale = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const parts = Object.fromEntries(locale.map((p) => [p.type, p.value]));
  const yyyy = parts.year;
  const mm = parts.month;
  const dd = parts.day;
  const tzOff = getTZOffsetDesignator(zone);
  let targetMs = new Date(`${yyyy}-${mm}-${dd}T10:00:00${tzOff}`).getTime();
  if (!Number.isFinite(targetMs)) {
    targetMs = new Date(`${yyyy}-${mm}-${dd}T10:00:00`).getTime() || Date.now();
  }
  if (targetMs <= d.getTime()) targetMs += 86400000;
  return targetMs;
}

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

function useLocalStorage<T>(key: string, initial: T): [T, SetState<T>] {
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // ignore write errors
    }
  }, [key, state]);

  return [state, setState];
}

function canNotify() {
  return typeof Notification !== "undefined";
}

async function ensurePermission() {
  if (!canNotify()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

function notify(title: string, body: string) {
  try {
    if (!canNotify() || Notification.permission !== "granted") return;
    const n = new Notification(title, { body });
    setTimeout(() => n.close(), 8000);
  } catch {
    // ignore notification errors
  }
}

interface ResourceState {
  base: number;
  last: number;
  nextOverride: number | null;
}

interface CurrentResource {
  value: number;
  nextPoint: number;
  fullAt: number;
}

export function computeCurrent(
  base: unknown,
  last: unknown,
  rateMs: unknown,
  cap: unknown,
  nextOverride: unknown,
  nowMs: number
): CurrentResource {
  const b = Number(base);
  const l = Number(last);
  const rate = Number(rateMs);
  const c = Number(cap);
  let normalizedBase = Number.isFinite(b) ? b : 0;
  let normalizedLast = Number.isFinite(l) ? l : nowMs;
  let normalizedRate = Number.isFinite(rate) && rate > 0 ? rate : 60000;
  const normalizedCap = Number.isFinite(c) && c > 0 ? c : 1;

  const anchor =
    nextOverride == null ? null : Number(nextOverride);

  let points = 0;
  let nextPoint = normalizedLast + normalizedRate;

  if (anchor != null && Number.isFinite(anchor)) {
    const ticksNow = Math.floor((nowMs - anchor) / normalizedRate);
    const ticksLast = Math.floor((normalizedLast - anchor) / normalizedRate);
    points = Math.max(0, ticksNow - ticksLast);
    nextPoint = anchor + (ticksNow + 1) * normalizedRate;
  } else {
    const elapsed = Math.max(0, nowMs - normalizedLast);
    points = Math.floor(elapsed / normalizedRate);
    nextPoint = normalizedLast + (points + 1) * normalizedRate;
  }

  const value = clamp(normalizedBase + points, 0, normalizedCap);
  const untilNext = Math.max(0, nextPoint - nowMs);
  const need = Math.max(0, normalizedCap - value);
  const toFull = need === 0 ? 0 : untilNext + Math.max(0, need - 1) * normalizedRate;
  return { value, nextPoint, fullAt: nowMs + toFull };
}

export function sanitizeResource(
  obj: Partial<ResourceState> | undefined,
  cap: number,
  defaults?: ResourceState
): ResourceState {
  const d =
    defaults || { base: cap, last: now(), nextOverride: null };
  const base = clamp(Number(obj?.base), 0, cap);
  const last = Number(obj?.last);
  let nextOverride = obj?.nextOverride == null ? null : Number(obj.nextOverride);
  return {
    base: Number.isFinite(base) ? base : d.base,
    last: Number.isFinite(last) ? last : d.last,
    nextOverride: Number.isFinite(nextOverride) ? nextOverride : null,
  };
}

function shallowEqualResource(a?: ResourceState, b?: ResourceState) {
  return (
    !!a &&
    !!b &&
    a.base === b.base &&
    a.last === b.last &&
    a.nextOverride === b.nextOverride
  );
}

function milestoneTimes(
  current: CurrentResource,
  rateMs: number,
  milestones: number[]
) {
  const res: Record<number, number> = {};
  for (const m of milestones) {
    if (current.value >= m) res[m] = now();
    else {
      const need = m - current.value;
      const first = Math.max(0, current.nextPoint - now());
      res[m] = now() + first + Math.max(0, need - 1) * rateMs;
    }
  }
  return res;
}

function timeToFull(current: CurrentResource, rateMs: number, cap: number) {
  const need = Math.max(0, cap - current.value);
  const first = Math.max(0, current.nextPoint - now());
  const ms = need === 0 ? 0 : first + Math.max(0, need - 1) * rateMs;
  return { ms, at: now() + ms };
}

function useQuery() {
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search));
  useEffect(() => {
    const onPop = () => setQ(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return q;
}

interface HeaderProps {
  hud: boolean;
  onOpenSettings: () => void;
  timeZone: string;
  isSettingsOpen: boolean;
}

function Header({ hud, onOpenSettings, timeZone, isSettingsOpen }: HeaderProps) {
  const zone = ensureTimeZone(timeZone);
  return (
    <div
      style={{
        marginBottom: 12,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div>
        <div style={{ fontSize: hud ? 20 : 24, fontWeight: 700 }}>
          Uma RP/TP Tracker — Streamer Build2
        </div>
        <div style={{ color: COLOR.subtle, fontSize: 12 }}>
          Dark theme • TP gold • RP blue • HUD mode & overlay URLs
        </div>
        <div style={{ color: COLOR.subtle, fontSize: 12, marginTop: 4 }}>
          Current time zone: {zone}
        </div>
      </div>
      <button
        type="button"
        onClick={onOpenSettings}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "8px 12px",
          borderRadius: 999,
          background: isSettingsOpen ? COLOR.border : COLOR.slate700,
          color: COLOR.text,
          border: `1px solid ${COLOR.border}`,
          fontSize: 13,
          cursor: "pointer",
        }}
        title="Open settings"
        aria-expanded={isSettingsOpen}
      >
        <span aria-hidden="true">⚙️</span>
        <span>Settings</span>
      </button>
    </div>
  );
}

interface CardProps {
  title: string;
  children: React.ReactNode;
}

function Card({ title, children }: CardProps) {
  return (
    <div
      style={{
        background: COLOR.card,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 6px 24px rgba(0,0,0,.25)",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

function RowRight({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
      {children}
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 13, color: COLOR.subtle, marginLeft: 6 }}>{children}</span>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}

function Checkbox({ checked, onChange, label }: CheckboxProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

interface ProgressBarProps {
  value: number;
  max: number;
  color: string;
}

function ProgressBar({ value, max, color }: ProgressBarProps) {
  const pct = Math.round((value / max) * 100);
  return (
    <div
      style={{
        width: "100%",
        height: 10,
        background: COLOR.border,
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <div style={{ width: `${pct}%`, height: "100%", background: color }} />
    </div>
  );
}

interface SmallBtnProps {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
}

function SmallBtn({ onClick, children, danger }: SmallBtnProps) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: "6px 10px",
        fontSize: 12,
        borderRadius: 10,
        background: danger ? COLOR.danger : COLOR.slate700,
        color: COLOR.text,
        border: `1px solid ${COLOR.border}`,
      }}
    >
      {children}
    </button>
  );
}

interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}

function Input({ value, onChange, placeholder, type = "text" }: InputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: "8px 12px",
        borderRadius: 12,
        background: COLOR.bg,
        color: COLOR.text,
        border: `1px solid ${COLOR.border}`,
        width: "100%",
      }}
    />
  );
}

function CountdownRow({ targetMs, timeZone }: { targetMs: number; timeZone: string }) {
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

interface ResourceCardProps {
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

function ResourceCard({
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
    fontSize: hud ? 48 : 32,
  };

  return (
    <div
      style={{
        background: COLOR.card,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 16,
        padding: 16,
        boxShadow: "0 6px 24px rgba(0,0,0,.25)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 12, color: COLOR.subtle }}>
          1 per {rateMs / 60000 >= 60 ? `${rateMs / 3600000}h` : `${rateMs / 60000}m`} • Cap {cap}
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
        <div style={bigValStyle}>{current.value}</div>
        <ProgressBar value={current.value} max={cap} color={accent} />
      </div>

      {hud ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
          <SmallBtn onClick={onMinus}>-1</SmallBtn>
          <SmallBtn onClick={onPlus}>+1</SmallBtn>
          {onSpend30 && <SmallBtn onClick={() => onSpend30()}>Spend 30</SmallBtn>}
          {onUseOne && <SmallBtn onClick={() => onUseOne()}>Use 1</SmallBtn>}
          <SmallBtn onClick={onCopyOverlay}>Copy Overlay URL</SmallBtn>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
            <SmallBtn onClick={onMinus}>-1</SmallBtn>
            <SmallBtn onClick={onPlus}>+1</SmallBtn>
            {onSpend30 && (
              <SmallBtn onClick={() => onSpend30()}>Spend 30 {name}</SmallBtn>
            )}
            {onUseOne && <SmallBtn onClick={() => onUseOne()}>Use 1 {name}</SmallBtn>}
          </div>

          <div style={{ color: COLOR.subtle, fontSize: 13, marginTop: 8 }}>
            Next +1 in: {formatDHMS(timeToNext)} ({formatMMSS(timeToNext)})
          </div>
          <div style={{ fontSize: 13, marginTop: 2 }}>
            Full at: {new Date(current.fullAt).toLocaleString(undefined, { timeZone: zone })} • Time to full:
            {" "}
            {formatDHMS(fullInfo.ms)} ({formatMMSS(fullInfo.ms)})
          </div>

          {milestones.length > 0 && (
            <div style={{ borderTop: `1px solid ${COLOR.border}`, marginTop: 10, paddingTop: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Milestones</div>
              <ul style={{ fontSize: 13, marginTop: 4, display: "grid", gap: 4 }}>
                {milestones.map((m) => {
                  const ready = current.value >= m;
                  const t = milestoneLookup[m];
                  return (
                    <li
                      key={m}
                      style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    >
                      <span style={{ color: ready ? COLOR.good : COLOR.text }}>
                        {m} {name}
                      </span>
                      {ready ? (
                        <span style={{ color: COLOR.good }}>Ready ✓</span>
                      ) : (
                        <span style={{ color: COLOR.subtle }}>
                          {new Date(t).toLocaleTimeString([], { timeZone: zone })}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13 }}>Set time until next {name}:</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <Input placeholder={place} value={nextInput} onChange={setNextInput} />
              <SmallBtn
                onClick={() => {
                  onSetNextOverride(nextInput);
                  setNextInput("");
                }}
              >
                Apply
              </SmallBtn>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 13 }}>Set current {name} amount:</div>
            <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
              <Input placeholder={`0–${cap}`} value={amountInput} onChange={setAmountInput} />
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
        </>
      )}
    </div>
  );
}

interface AddTimerFormProps {
  onAdd: (label: string, duration: string) => void;
}

function AddTimerForm({ onAdd }: AddTimerFormProps) {
  const [label, setLabel] = useState("");
  const [dur, setDur] = useState("");
  const place = "mm:ss, 10m, 2h, or seconds";
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Input placeholder="Label (optional)" value={label} onChange={setLabel} />
      <Input placeholder={place} value={dur} onChange={setDur} />
      <SmallBtn
        onClick={() => {
          onAdd(label, dur);
          setLabel("");
          setDur("");
        }}
      >
        Add
      </SmallBtn>
    </div>
  );
}

interface AddAbsTimerFormProps {
  onAdd: (label: string, dateTime: string) => void;
}

function AddAbsTimerForm({ onAdd }: AddAbsTimerFormProps) {
  const [label, setLabel] = useState("");
  const [dt, setDt] = useState("");
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <Input placeholder="Label (e.g., Banner Release)" value={label} onChange={setLabel} />
      <Input type="datetime-local" value={dt} onChange={setDt} />
      <SmallBtn
        onClick={() => {
          onAdd(label, dt);
          setLabel("");
          setDt("");
        }}
      >
        Add
      </SmallBtn>
    </div>
  );
}

interface TimerData {
  id: string;
  label?: string;
  targetTs?: number;
  isPaused?: boolean;
  pausedRemaining?: number | null;
  created?: number;
  remainingMs?: number;
}

interface TimerRowProps {
  t: TimerData;
  onAddMinutes: (minutes: number) => void;
  onPause: (pause: boolean) => void;
  onReset: () => void;
  onDelete: () => void;
  onCopy: () => void;
}

function TimerRow({ t, onAddMinutes, onPause, onReset, onDelete, onCopy }: TimerRowProps) {
  const rem = t.isPaused
    ? Number.isFinite(t.pausedRemaining)
      ? (t.pausedRemaining as number)
      : Math.max(0, (t.targetTs ?? 0) - now())
    : Math.max(0, (t.targetTs ?? 0) - now());
  return (
    <div style={cardRowStyle()}>
      <div>
        <div style={{ fontWeight: 600 }}>{t.label || "Timer"}</div>
        <div style={{ fontSize: 13, color: COLOR.subtle }}>Remaining</div>
        <div style={{ fontSize: 14 }}>
          {formatDHMS(rem)} ({formatMMSS(rem)})
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
      </div>
    </div>
  );
}

function cardRowStyle(): React.CSSProperties {
  return {
    background: COLOR.card,
    border: `1px solid ${COLOR.border}`,
    borderRadius: 14,
    padding: 12,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  };
}

interface AbsTimer {
  id: string;
  label?: string;
  ts: number;
}

interface OverlayViewProps {
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

function OverlayView({ overlay, curTP, curRP, tpFull, rpFull, nextReset, timers, absTimers, timeZone }: OverlayViewProps) {
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

interface NotificationState {
  enabled: boolean;
  tpMilestones: Record<string, boolean>;
  rpMilestones: Record<string, boolean>;
  timers: boolean;
}

interface FiredState {
  tp: Record<string, boolean>;
  rp: Record<string, boolean>;
  timers: Record<string, boolean>;
}

function maybeFire(
  key: string,
  title: string,
  condition: boolean,
  fired: FiredState,
  setFired: SetState<FiredState>
) {
  if (!condition) return;
  if (fired.tp?.[key] || fired.rp?.[key]) return;
  notify(title, "Ready to go!");
  setFired((prev) => ({
    ...prev,
    tp: { ...prev.tp, [key]: true },
    rp: { ...prev.rp, [key]: true },
  }));
}

function maybeFireTimer(
  id: string,
  label: string,
  fired: FiredState,
  setFired: SetState<FiredState>
) {
  if (fired.timers?.[id]) return;
  notify(`${label}`, "Timer finished");
  setFired((prev) => ({ ...prev, timers: { ...prev.timers, [id]: true } }));
}

function maybeFireAbs(
  id: string,
  label: string,
  fired: FiredState,
  setFired: SetState<FiredState>
) {
  if (fired.timers?.[id]) return;
  notify(`${label}`, "Timer reached");
  setFired((prev) => ({ ...prev, timers: { ...prev.timers, [id]: true } }));
}

const TP_RATE_MS = 10 * 60 * 1000;
const TP_CAP = 100;
const RP_RATE_MS = 2 * 60 * 60 * 1000;
const RP_CAP = 5;

export default function UmaResourceTracker() {
  const [tpRaw, setTP] = useLocalStorage<ResourceState>("uma.tp", {
    base: 100,
    last: now(),
    nextOverride: null,
  });
  const [rpRaw, setRP] = useLocalStorage<ResourceState>("uma.rp", {
    base: 5,
    last: now(),
    nextOverride: null,
  });
  const [notif, setNotif] = useLocalStorage<NotificationState>("uma.notif", {
    enabled: false,
    tpMilestones: { "30": true, "60": true, "90": true, full: true },
    rpMilestones: { full: true },
    timers: true,
  });
  const [timers, setTimers] = useLocalStorage<TimerData[]>("uma.customTimers", []);
  const [absTimers, setAbsTimers] = useLocalStorage<AbsTimer[]>("uma.absTimers", []);
  const [fired, setFired] = useLocalStorage<FiredState>("uma.fired", {
    tp: {},
    rp: {},
    timers: {},
  });
  const [timezone, setTimezone] = useLocalStorage<string>("uma.timezone", DEFAULT_TZ);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tzDraft, setTzDraft] = useState(timezone);
  const [tzError, setTzError] = useState<string | null>(null);

  const activeTimeZone = ensureTimeZone(timezone);

  useEffect(() => {
    if (!isValidTimeZone(timezone)) setTimezone(DEFAULT_TZ);
  }, [timezone, setTimezone]);

  useEffect(() => {
    if (!settingsOpen) setTzDraft(timezone);
  }, [timezone, settingsOpen]);

  useEffect(() => {
    const sTP = sanitizeResource(tpRaw, TP_CAP);
    if (!shallowEqualResource(sTP, tpRaw)) setTP(sTP);
    const sRP = sanitizeResource(rpRaw, RP_CAP);
    if (!shallowEqualResource(sRP, rpRaw)) setRP(sRP);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tp = useMemo(
    () =>
      sanitizeResource(tpRaw, TP_CAP, {
        base: TP_CAP,
        last: now(),
        nextOverride: null,
      }),
    [tpRaw]
  );
  const rp = useMemo(
    () =>
      sanitizeResource(rpRaw, RP_CAP, {
        base: RP_CAP,
        last: now(),
        nextOverride: null,
      }),
    [rpRaw]
  );

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    setTimers((prev) =>
      prev.map((t) => {
        if (t && t.targetTs) return t;
        const rem = Number.isFinite(t?.remainingMs) ? t?.remainingMs || 0 : 0;
        return {
          ...t,
          targetTs: now() + rem,
          pausedRemaining: t?.isPaused ? rem : null,
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const curTP = useMemo(
    () => computeCurrent(tp.base, tp.last, TP_RATE_MS, TP_CAP, tp.nextOverride, now()),
    [tp, tick]
  );
  const curRP = useMemo(
    () => computeCurrent(rp.base, rp.last, RP_RATE_MS, RP_CAP, rp.nextOverride, now()),
    [rp, tick]
  );
  const nextReset = useMemo(
    () => nextDailyResetTS(new Date(), activeTimeZone),
    [tick, activeTimeZone]
  );
  const tzOffset = useMemo(() => getTZOffsetDesignator(activeTimeZone), [activeTimeZone]);

  const [anchoredInit, setAnchoredInit] = useState(false);
  useEffect(() => {
    if (anchoredInit) return;
    if (tp.nextOverride == null)
      setTP((prev) => ({
        ...prev,
        nextOverride: computeCurrent(tp.base, tp.last, TP_RATE_MS, TP_CAP, null, now()).nextPoint,
      }));
    if (rp.nextOverride == null)
      setRP((prev) => ({
        ...prev,
        nextOverride: computeCurrent(rp.base, rp.last, RP_RATE_MS, RP_CAP, null, now()).nextPoint,
      }));
    setAnchoredInit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tp.base, tp.last, rp.base, rp.last]);

  useEffect(() => {
    if (!notif.enabled) return;
    (async () => {
      await ensurePermission();
    })();
  }, [notif.enabled]);

  useEffect(() => {
    if (!notif.enabled) return;
    const tpVal = curTP.value;
    for (const m of [30, 60, 90])
      if (notif.tpMilestones[String(m)])
        maybeFire(`tp_${m}`, `TP ${m} ready`, tpVal >= m, fired, setFired);
    if (notif.tpMilestones.full)
      maybeFire("tp_full", "TP full (100)", tpVal >= TP_CAP, fired, setFired);
    if (notif.rpMilestones.full)
      maybeFire("rp_full", "RP full (5)", curRP.value >= RP_CAP, fired, setFired);
    if (notif.timers) {
      for (const t of timers)
        if (!t.isPaused && Number.isFinite(t.targetTs) && now() >= (t.targetTs ?? 0))
          maybeFireTimer(t.id, t.label || "Timer", fired, setFired);
      for (const a of absTimers)
        if (a.ts <= now()) maybeFireAbs(a.id, a.label || "Timer", fired, setFired);
    }
  }, [curTP.value, curRP.value, timers, absTimers, notif, fired, setFired]);

  const tpMilestoneTimes = useMemo(
    () => milestoneTimes({ ...curTP, nextPoint: curTP.nextPoint }, TP_RATE_MS, [30, 60, 90]),
    [curTP]
  );
  const rpFull = useMemo(() => timeToFull(curRP, RP_RATE_MS, RP_CAP), [curRP]);
  const tpFull = useMemo(() => timeToFull(curTP, TP_RATE_MS, TP_CAP), [curTP]);

  function toggleSettings() {
    setSettingsOpen((prev) => {
      const next = !prev;
      setTzDraft(timezone);
      setTzError(null);
      return next;
    });
  }

  function saveTimeZone() {
    const trimmed = tzDraft.trim();
    if (!trimmed) {
      setTzError("Time zone cannot be empty.");
      return;
    }
    if (!isValidTimeZone(trimmed)) {
      setTzError("Enter a valid IANA time zone (e.g., America/Chicago).");
      return;
    }
    setTimezone(trimmed);
    setTzError(null);
  }

  function closeSettings() {
    setSettingsOpen(false);
    setTzError(null);
    setTzDraft(timezone);
  }

  function adjustTP(delta: number) {
    const current = computeCurrent(tp.base, tp.last, TP_RATE_MS, TP_CAP, tp.nextOverride, now());
    const newVal = clamp(current.value + delta, 0, TP_CAP);
    setTP((prev) => ({ base: newVal, last: now(), nextOverride: prev.nextOverride ?? current.nextPoint }));
  }
  function adjustRP(delta: number) {
    const current = computeCurrent(rp.base, rp.last, RP_RATE_MS, RP_CAP, rp.nextOverride, now());
    const newVal = clamp(current.value + delta, 0, RP_CAP);
    setRP((prev) => ({ base: newVal, last: now(), nextOverride: prev.nextOverride ?? current.nextPoint }));
  }
  function spendTP(amount: number) {
    adjustTP(-amount);
  }
  function useOneRP() {
    adjustRP(-1);
  }
  function setNextPointOverride(kind: "tp" | "rp", str: string) {
    const ms = parseFlexible(str);
    if (ms == null) return;
    const target = now() + ms;
    if (kind === "tp") setTP((prev) => ({ ...prev, nextOverride: target }));
    else setRP((prev) => ({ ...prev, nextOverride: target }));
  }
  function addTimer(label: string, input: string) {
    const ms = parseFlexible(input);
    if (ms == null) return;
    const t: TimerData = {
      id: crypto.randomUUID(),
      label,
      targetTs: now() + ms,
      isPaused: false,
      pausedRemaining: null,
      created: now(),
    };
    setTimers((prev) => [...prev, t]);
  }
  function pauseTimer(id: string, pause: boolean) {
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (pause && !t.isPaused) {
          return {
            ...t,
            isPaused: true,
            pausedRemaining: Math.max(0, (t.targetTs ?? now()) - now()),
          };
        }
        if (!pause && t.isPaused) {
          const rem = Number.isFinite(t.pausedRemaining) ? t.pausedRemaining || 0 : 0;
          return {
            ...t,
            isPaused: false,
            targetTs: now() + rem,
            pausedRemaining: null,
          };
        }
        return t;
      })
    );
  }
  function addMinutes(id: string, mins: number) {
    const delta = mins * 60000;
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (t.isPaused) {
          const rem = Number.isFinite(t.pausedRemaining)
            ? t.pausedRemaining || Math.max(0, (t.targetTs ?? now()) - now())
            : Math.max(0, (t.targetTs ?? now()) - now());
          return { ...t, pausedRemaining: rem + delta };
        }
        return { ...t, targetTs: (t.targetTs ?? now()) + delta };
      })
    );
  }
  function resetTimer(id: string) {
    setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, isPaused: true, pausedRemaining: 0 } : t)));
  }
  function deleteTimer(id: string) {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }
  function addAbsTimer(label: string, whenTs: string) {
    if (!whenTs) return;
    const ts = new Date(whenTs).getTime();
    if (!Number.isNaN(ts))
      setAbsTimers((prev) => [...prev, { id: crypto.randomUUID(), label, ts }]);
  }
  function deleteAbs(id: string) {
    setAbsTimers((prev) => prev.filter((x) => x.id !== id));
  }

  const q = useQuery();
  const hud = q.get("hud") === "1";
  const overlay = q.get("overlay");

  function copyOverlayURL(kind: string, id = "") {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("hud", "1");
    url.searchParams.set("overlay", id ? `${kind}:${id}` : kind);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url.toString()).catch(() => {
        // ignore clipboard errors
      });
    }
  }

  useEffect(() => {
    document.body.style.background = COLOR.bg;
    document.body.style.color = COLOR.text;
  }, []);

  const tzDraftTrimmed = tzDraft.trim();
  const tzDraftIsValid = tzDraftTrimmed.length > 0 && isValidTimeZone(tzDraftTrimmed);
  const tzPreview = settingsOpen && tzDraftIsValid
    ? new Date().toLocaleString(undefined, { timeZone: tzDraftTrimmed })
    : null;
  const resetTitle = `Daily Reset (10:00 AM ${activeTimeZone} • UTC${tzOffset})`;

  if (overlay) {
    return (
      <div style={{ padding: 16, fontFamily: "Inter, ui-sans-serif, system-ui", color: COLOR.text }}>
        <OverlayView
          overlay={overlay}
          curTP={curTP}
          curRP={curRP}
          tpFull={tpFull}
          rpFull={rpFull}
          nextReset={nextReset}
          timers={timers}
          absTimers={absTimers}
          timeZone={activeTimeZone}
        />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: 16 }}>
      <Header
        hud={hud}
        onOpenSettings={toggleSettings}
        timeZone={activeTimeZone}
        isSettingsOpen={settingsOpen}
      />

      {settingsOpen && (
        <Card title="Settings">
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Time zone</div>
              <div style={{ fontSize: 12, color: COLOR.subtle, marginTop: 4 }}>
                Determines when the 10:00 AM daily reset occurs and how timers are displayed.
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <Input
                  value={tzDraft}
                  onChange={(v) => {
                    setTzDraft(v);
                    setTzError(null);
                  }}
                  placeholder="America/Chicago"
                />
              </div>
              <SmallBtn onClick={saveTimeZone}>Save time zone</SmallBtn>
              <SmallBtn onClick={closeSettings}>Done</SmallBtn>
            </div>
            {tzError && (
              <div style={{ fontSize: 12, color: COLOR.danger }}>{tzError}</div>
            )}
            {!tzError && tzDraftTrimmed.length > 0 && !tzDraftIsValid && (
              <div style={{ fontSize: 12, color: COLOR.subtle }}>
                Enter a valid IANA time zone such as America/Chicago or Asia/Tokyo.
              </div>
            )}
            {tzPreview && (
              <div style={{ fontSize: 12, color: COLOR.subtle }}>
                Current local time in {tzDraftTrimmed}: {tzPreview}
              </div>
            )}
          </div>
        </Card>
      )}

      <Card title={resetTitle}>
        <CountdownRow targetMs={nextReset} timeZone={activeTimeZone} />
        <RowRight>
          <SmallBtn onClick={() => copyOverlayURL("reset")}>Copy Overlay URL</SmallBtn>
        </RowRight>
      </Card>

      <Card title="Notifications">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
          <Checkbox
            checked={notif.enabled}
            onChange={async (v) => {
              if (v) {
                const ok = await ensurePermission();
                if (!ok) return;
              }
              setNotif((n) => ({ ...n, enabled: v }));
            }}
            label="Enable browser notifications"
          />
          <Label>TP milestones:</Label>
          {[30, 60, 90].map((m) => (
            <Checkbox
              key={m}
              checked={!!notif.tpMilestones[String(m)]}
              onChange={(v) =>
                setNotif((n) => ({
                  ...n,
                  tpMilestones: { ...n.tpMilestones, [String(m)]: v },
                }))
              }
              label={`${m}`}
            />
          ))}
          <Checkbox
            checked={!!notif.tpMilestones.full}
            onChange={(v) =>
              setNotif((n) => ({
                ...n,
                tpMilestones: { ...n.tpMilestones, full: v },
              }))
            }
            label="Full TP"
          />
          <Label>RP:</Label>
          <Checkbox
            checked={!!notif.rpMilestones.full}
            onChange={(v) =>
              setNotif((n) => ({
                ...n,
                rpMilestones: { ...n.rpMilestones, full: v },
              }))
            }
            label="Full RP"
          />
          <Checkbox
            checked={notif.timers}
            onChange={(v) => setNotif((n) => ({ ...n, timers: v }))}
            label="Timer alerts"
          />
        </div>
        <p style={{ color: COLOR.subtle, fontSize: 12, marginTop: 6 }}>
          Note: Notifications require this tab to stay open.
        </p>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: hud ? "1fr 1fr" : "1fr 1fr", gap: 16 }}>
        <ResourceCard
          accent={COLOR.tp}
          name="TP"
          cap={TP_CAP}
          rateMs={TP_RATE_MS}
          state={tp}
          setState={setTP}
          current={curTP}
          onMinus={() => adjustTP(-1)}
          onPlus={() => adjustTP(1)}
          onSpend30={() => spendTP(30)}
          onUseOne={() => spendTP(1)}
          milestones={[30, 60, 90]}
          milestoneTimes={tpMilestoneTimes}
          fullInfo={tpFull}
          onSetNextOverride={(v) => setNextPointOverride("tp", v)}
          hud={hud}
          onCopyOverlay={() => copyOverlayURL("tp")}
          timeZone={activeTimeZone}
        />

        <ResourceCard
          accent={COLOR.rp}
          name="RP"
          cap={RP_CAP}
          rateMs={RP_RATE_MS}
          state={rp}
          setState={setRP}
          current={curRP}
          onMinus={() => adjustRP(-1)}
          onPlus={() => adjustRP(1)}
          onSpend30={null}
          onUseOne={() => useOneRP()}
          milestones={[]}
          milestoneTimes={{}}
          fullInfo={rpFull}
          onSetNextOverride={(v) => setNextPointOverride("rp", v)}
          hud={hud}
          onCopyOverlay={() => copyOverlayURL("rp")}
          timeZone={activeTimeZone}
        />
      </div>

      <Card title="Custom Flexible Timers">
        <AddTimerForm onAdd={addTimer} />
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          {timers.length === 0 ? (
            <p style={{ color: COLOR.subtle, fontSize: 14 }}>No custom timers yet.</p>
          ) : (
            timers.map((t) => (
              <TimerRow
                key={t.id}
                t={t}
                onAddMinutes={(m) => addMinutes(t.id, m)}
                onPause={(p) => pauseTimer(t.id, p)}
                onReset={() => resetTimer(t.id)}
                onDelete={() => deleteTimer(t.id)}
                onCopy={() => copyOverlayURL("timer", t.id)}
              />
            ))
          )}
        </div>
      </Card>

      <Card title="Exact Date/Time Timers">
        <AddAbsTimerForm onAdd={addAbsTimer} />
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          {absTimers.length === 0 ? (
            <p style={{ color: COLOR.subtle, fontSize: 14 }}>No exact timers yet.</p>
          ) : (
            absTimers.map((a) => {
              const rem = a.ts - now();
              return (
                <div key={a.id} style={cardRowStyle()}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{a.label || "Timer"}</div>
                    <div style={{ fontSize: 13, color: COLOR.subtle }}>
                      At: {new Date(a.ts).toLocaleString(undefined, { timeZone: activeTimeZone })}
                    </div>
                    <div style={{ fontSize: 14 }}>
                      Time left: {formatDHMS(rem)} ({formatMMSS(rem)})
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <SmallBtn onClick={() => copyOverlayURL("abs", a.id)}>Copy Overlay URL</SmallBtn>
                    <SmallBtn danger onClick={() => deleteAbs(a.id)}>
                      Delete
                    </SmallBtn>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </Card>

      <footer style={{ color: COLOR.subtle, fontSize: 12, paddingTop: 24, paddingBottom: 16 }}>
        Streamer HUD: add <code>?hud=1</code> to the URL for compact panels. Overlay links: each card has a "Copy
        Overlay URL" to render a minimal scene for OBS as a browser source. Inputs accept "mm:ss, 10m, 2h, or seconds".
      </footer>
    </div>
  );
}

(function runTests() {
  try {
    const eq = (a: unknown, b: unknown, msg: string) => {
      if (a !== b) console.error("TEST FAIL:", msg, { a, b });
      else console.log("TEST PASS:", msg);
    };
    eq(formatMMSS(90000), "01:30", "formatMMSS 90s -> 01:30");
    eq(formatDHMS(3661000).includes("1h"), true, "formatDHMS >1h includes hours");
    eq(formatMMSS(Number.NaN), "00:00", "formatMMSS tolerates NaN");

    eq(parseFlexible("1:30"), 90000, "parseFlexible mm:ss");
    eq(parseFlexible("10m"), 600000, "parseFlexible 10m");
    eq(parseFlexible("2h"), 7200000, "parseFlexible 2h");
    eq(parseFlexible("45"), 45000, "parseFlexible seconds");

    const off = (function () {
      try {
        return getTZOffsetDesignator(DEFAULT_TZ);
      } catch (e) {
        console.warn(e);
        return "";
      }
    })();
    const looks =
      typeof off === "string" && off.length >= 6 && (off[0] === "+" || off[0] === "-") && off[3] === ":";
    eq(looks, true, "offset looks like ±HH:MM");

    const s = sanitizeResource(
      { base: "3" as unknown as number, last: "nope" as unknown as number, nextOverride: "nan" as unknown as number },
      5,
      { base: 5, last: 123456, nextOverride: null }
    );
    eq(Number.isFinite(s.base) && Number.isFinite(s.last), true, "sanitizeResource coerces to numbers");

    const nowMs = Date.now();
    const c1 = computeCurrent(0, nowMs - 10 * 60 * 1000, 10 * 60 * 1000, 100, null, nowMs);
    eq(c1.value >= 1, true, "computeCurrent should tick at least once after one interval");

    const anchor = nowMs + 5 * 60 * 1000;
    const a1 = computeCurrent(50, nowMs - 2 * 60 * 1000, 10 * 60 * 1000, 100, anchor, nowMs);
    const a2 = computeCurrent(45, nowMs, 10 * 60 * 1000, 100, anchor, nowMs);
    eq(Math.abs(a1.nextPoint - a2.nextPoint) < 5, true, "anchor keeps nextPoint stable across spends");

    const ndr = nextDailyResetTS(new Date(), DEFAULT_TZ);
    eq(Number.isFinite(ndr) && ndr > Date.now(), true, "nextDailyResetTS returns a future finite timestamp");
  } catch (e) {
    console.warn("Test harness error: ", e);
  }
})();
