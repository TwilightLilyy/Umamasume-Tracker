import { sanitizeTimerColor } from "./color";
import { formatDHMS, formatMMSS } from "./time";

export interface TimerData {
  id: string;
  label?: string;
  targetTs?: number;
  isPaused?: boolean;
  pausedRemaining?: number | null;
  created?: number;
  color?: string;
  durationMs?: number;
  remainingMs?: number;
  includeInOverview?: boolean;
}

export interface TimerDisplayData extends TimerData {
  remainingMs: number;
  totalMs: number;
  progress: number;
  colorResolved: string;
  includeInOverview: boolean;
}

export function computeTimerRemainingMs(t: TimerData, nowMs: number) {
  if (t.isPaused) {
    if (Number.isFinite(t.pausedRemaining)) return Math.max(0, (t.pausedRemaining as number) || 0);
    if (Number.isFinite(t.targetTs)) return Math.max(0, (t.targetTs as number) - nowMs);
    return 0;
  }
  if (Number.isFinite(t.targetTs)) return Math.max(0, (t.targetTs as number) - nowMs);
  return 0;
}

export function computeTimerTotalMs(t: TimerData, remaining: number, nowMs: number) {
  if (Number.isFinite(t.durationMs)) {
    const base = Math.max(0, t.durationMs as number);
    return Math.max(base, remaining);
  }
  if (Number.isFinite(t.targetTs) && Number.isFinite(t.created)) {
    const diff = (t.targetTs as number) - (t.created as number);
    if (Number.isFinite(diff) && diff > 0) return Math.max(diff, remaining);
  }
  if (t.isPaused && Number.isFinite(t.pausedRemaining)) {
    const rem = Math.max(0, (t.pausedRemaining as number) || 0);
    return Math.max(rem, remaining);
  }
  if (Number.isFinite(t.targetTs)) {
    const diff = Math.max(0, (t.targetTs as number) - nowMs);
    return Math.max(diff, remaining);
  }
  return remaining || 1;
}

export function resolveTimerColor(t: TimerData, index: number) {
  return sanitizeTimerColor(t.color, index);
}

export function timerStatusLabel(meta: TimerDisplayData) {
  const remaining = meta.remainingMs;
  if (meta.isPaused) return `Paused (${formatDHMS(remaining)})`;
  if (remaining <= 0) return "Ready";
  return `${formatDHMS(remaining)} (${formatMMSS(remaining)})`;
}
