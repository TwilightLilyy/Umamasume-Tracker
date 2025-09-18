export const DEFAULT_TZ = "America/Chicago";

export const COLOR = {
  bg: "#050b1a",
  card: "#0b162b",
  border: "#1f2f4d",
  text: "#f8fbff",
  subtle: "#cdd9f5",
  // Keep TP gold to match the in-game resource card styling.
  tp: "#facc15",
  // Keep RP blue to match the in-game resource card styling.
  rp: "#38bdf8",
  good: "#22c55e",
  danger: "#f87171",
  slate700: "#2c3a57",
} as const;

export const TIMER_COLORS = [
  "#f97316",
  "#38bdf8",
  "#a855f7",
  "#22c55e",
  "#f87171",
  "#14b8a6",
  "#facc15",
  "#ec4899",
] as const;

export const TP_RATE_MS = 10 * 60 * 1000;
export const TP_CAP = 100;
export const RP_RATE_MS = 2 * 60 * 60 * 1000;
export const RP_CAP = 5;

export const HOTKEY_THROTTLE_MS = 150;
