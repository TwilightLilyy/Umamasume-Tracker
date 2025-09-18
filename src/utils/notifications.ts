import type React from "react";

export function canNotify() {
  return typeof Notification !== "undefined";
}

export async function ensurePermission() {
  if (!canNotify()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const p = await Notification.requestPermission();
  return p === "granted";
}

export function notify(title: string, body: string) {
  try {
    if (!canNotify() || Notification.permission !== "granted") return;
    const n = new Notification(title, { body });
    setTimeout(() => n.close(), 8000);
  } catch {
    // ignore notification errors
  }
}

export interface FiredState {
  tp: Record<string, boolean>;
  rp: Record<string, boolean>;
  timers: Record<string, boolean>;
  resets?: Record<string, boolean>;
}

type SetState<T> = React.Dispatch<React.SetStateAction<T>>;

export function maybeFire(
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

export function maybeFireTimer(id: string, label: string, fired: FiredState, setFired: SetState<FiredState>) {
  if (fired.timers?.[id]) return;
  notify(`${label}`, "Timer finished");
  setFired((prev) => ({ ...prev, timers: { ...prev.timers, [id]: true } }));
}

export function maybeFireAbs(id: string, label: string, fired: FiredState, setFired: SetState<FiredState>) {
  if (fired.timers?.[id]) return;
  notify(`${label}`, "Timer reached");
  setFired((prev) => ({ ...prev, timers: { ...prev.timers, [id]: true } }));
}

export function maybeFireReset(
  key: string,
  title: string,
  body: string,
  condition: boolean,
  fired: FiredState,
  setFired: SetState<FiredState>
) {
  if (!condition) return;
  if (fired.resets?.[key]) return;
  notify(title, body);
  setFired((prev) => ({ ...prev, resets: { ...prev.resets, [key]: true } }));
}
