import type React from "react";

import { COLOR, TIMER_COLORS } from "../constants";

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function hexToRgb(hex: string) {
  const normalized = hex.trim().replace(/^#/, "");
  if (normalized.length !== 3 && normalized.length !== 6) return null;
  const expand = normalized.length === 3 ? normalized.split("").map((c) => c + c).join("") : normalized;
  const num = Number.parseInt(expand, 16);
  if (Number.isNaN(num)) return null;
  return {
    r: (num >> 16) & 0xff,
    g: (num >> 8) & 0xff,
    b: num & 0xff,
  };
}

function rgbToHex(r: number, g: number, b: number) {
  const toHex = (value: number) => clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function mixColor(color: string, target: string, amount: number) {
  const base = hexToRgb(color);
  const other = hexToRgb(target);
  if (!base || !other) return color;
  const ratio = clamp(amount, 0, 1);
  const r = base.r + (other.r - base.r) * ratio;
  const g = base.g + (other.g - base.g) * ratio;
  const b = base.b + (other.b - base.b) * ratio;
  return rgbToHex(r, g, b);
}

export function withAlpha(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const a = clamp(alpha, 0, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}

export function defaultTimerColor(index: number) {
  if (index < 0) return TIMER_COLORS[0];
  return TIMER_COLORS[index % TIMER_COLORS.length];
}

export function sanitizeTimerColor(color: string | undefined, index: number) {
  if (!color) return defaultTimerColor(index);
  const hex = color.trim();
  const valid = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(hex);
  return valid ? hex : defaultTimerColor(index);
}

export function cardRowStyle(accent?: string): React.CSSProperties {
  const resolvedAccent = accent ?? COLOR.card;
  return {
    background: COLOR.card,
    border: `1px solid ${withAlpha(mixColor(resolvedAccent, "#000000", 0.45), 0.9)}`,
    borderRadius: 12,
    padding: 12,
    display: "flex",
    gap: 12,
    alignItems: "center",
    justifyContent: "space-between",
    boxShadow: `0 8px 22px ${withAlpha(mixColor(resolvedAccent, "#000000", 0.35), 0.45)}`,
  };
}
