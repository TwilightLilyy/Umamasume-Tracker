import { clamp } from "./color";
import { now } from "./time";

export interface ResourceState {
  base: number;
  last: number;
  nextOverride: number | null;
}

export interface CurrentResource {
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

  const anchor = nextOverride == null ? null : Number(nextOverride);

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
  const d = defaults || { base: cap, last: now(), nextOverride: null };
  const base = clamp(Number(obj?.base), 0, cap);
  const last = Number(obj?.last);
  let nextOverride = obj?.nextOverride == null ? null : Number(obj.nextOverride);
  return {
    base: Number.isFinite(base) ? base : d.base,
    last: Number.isFinite(last) ? last : d.last,
    nextOverride: Number.isFinite(nextOverride) ? nextOverride : null,
  };
}

export function shallowEqualResource(a?: ResourceState, b?: ResourceState) {
  return !!a && !!b && a.base === b.base && a.last === b.last && a.nextOverride === b.nextOverride;
}

export function milestoneTimes(current: CurrentResource, rateMs: number, milestones: number[]) {
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

export function timeToFull(current: CurrentResource, rateMs: number, cap: number) {
  const need = Math.max(0, cap - current.value);
  const first = Math.max(0, current.nextPoint - now());
  const ms = need === 0 ? 0 : first + Math.max(0, need - 1) * rateMs;
  return { ms, at: now() + ms };
}
