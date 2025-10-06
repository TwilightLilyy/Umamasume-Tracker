import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import OverlaySettingsPanel from "./settings/OverlaySettings";
import { OVERLAY_SNAPSHOT_CHANNEL } from "./types/overlay";
import type { OverlayResourceSnapshot, OverlaySnapshotPayload } from "./types/overlay";

import {
  createEmptyHistoryState,
  type ResourceHistoryEventInput,
  type ResourceHistoryEvent,
  type ResourceHistoryPoint,
  type ResourceHistorySnapshot,
  type ResourceHistoryState,
  type ResourceKind,
} from "./types/history";

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
  bg: "#050b1a",
  card: "#0b162b",
  border: "#1f2f4d",
  text: "#f8fbff",
  subtle: "#cdd9f5",
  // Keep TP gold to match the in-game resource card styling.
  tp: "#facc15",
  // Keep RP blue to match the in-game resource card styling.
  rp: "#38bdf8",
  fans: "#f97316",
  carats: "#a855f7",
  good: "#22c55e",
  danger: "#f87171",
  slate700: "#2c3a57",
};

const TIMER_COLORS = [
  "#f97316",
  "#38bdf8",
  "#a855f7",
  "#22c55e",
  "#f87171",
  "#14b8a6",
  "#facc15",
  "#ec4899",
];

const HOTKEY_THROTTLE_MS = 150;
const HISTORY_SAMPLE_INTERVAL_MS = 60 * 1000;
const HISTORY_RETENTION_MS = 24 * 60 * 60 * 1000;
const HISTORY_MIN_POINT_GAP_MS = 15 * 1000;
const HISTORY_MAX_POINTS = 2000;
const ABS_TIMER_COUNTDOWN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

type HotkeyActionId = "tpSpend30" | "tpSpend1" | "rpSpend1" | "rpSpend5";

interface HotkeyActionConfig {
  id: HotkeyActionId;
  label: string;
  resource: "tp" | "rp";
  amount: number;
  defaultBinding: string | null;
  verb: string;
}

const HOTKEY_ACTIONS: HotkeyActionConfig[] = [
  { id: "tpSpend30", label: "Spend 30 TP", resource: "tp", amount: 30, defaultBinding: "t", verb: "Spent" },
  { id: "tpSpend1", label: "Spend 1 TP", resource: "tp", amount: 1, defaultBinding: null, verb: "Spent" },
  { id: "rpSpend1", label: "Use 1 RP", resource: "rp", amount: 1, defaultBinding: "r", verb: "Used" },
  { id: "rpSpend5", label: "Use 5 RP", resource: "rp", amount: 5, defaultBinding: null, verb: "Used" },
];

type HotkeyBindings = Record<HotkeyActionId, string | null>;

interface HotkeySettings {
  enabled: boolean;
  paused: boolean;
  allowRepeat: boolean;
  bindings: HotkeyBindings;
}

const DEFAULT_HOTKEY_SETTINGS: HotkeySettings = {
  enabled: true,
  paused: false,
  allowRepeat: false,
  bindings: HOTKEY_ACTIONS.reduce((acc, action) => {
    acc[action.id] = action.defaultBinding;
    return acc;
  }, {} as HotkeyBindings),
};

const HOTKEY_ACTION_LOOKUP = new Map<HotkeyActionId, HotkeyActionConfig>(
  HOTKEY_ACTIONS.map((action) => [action.id, action])
);

const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"] as const;
type ModifierKey = (typeof MODIFIER_ORDER)[number];
const MODIFIER_SET = new Set<ModifierKey>(MODIFIER_ORDER);

function canonicalKeyName(key: string | null | undefined) {
  if (!key) return null;
  const lower = key.toLowerCase();
  if (lower === "" || lower === "dead" || lower === "unidentified") return null;
  if (lower === " ") return "space";
  if (lower === "spacebar") return "space";
  if (lower === "escape") return "esc";
  if (lower === "os") return "meta";
  return lower;
}

function normalizeBindingString(binding: string | null | undefined): string | null {
  if (!binding) return null;
  const parts = binding
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (!parts.length) return null;
  const modifiers: ModifierKey[] = [];
  let keyPart: string | null = null;
  for (const part of parts) {
    if (MODIFIER_SET.has(part as ModifierKey)) {
      const mod = part as ModifierKey;
      if (!modifiers.includes(mod)) modifiers.push(mod);
      continue;
    }
    keyPart = canonicalKeyName(part);
  }
  if (!keyPart) return null;
  if (MODIFIER_SET.has(keyPart as ModifierKey)) return null;
  const orderedModifiers = MODIFIER_ORDER.filter((mod) => modifiers.includes(mod));
  return [...orderedModifiers, keyPart].join("+");
}

function bindingFromEvent(event: KeyboardEvent): string | null {
  const modifiers: ModifierKey[] = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("meta");
  const keyPart = canonicalKeyName(event.key);
  if (!keyPart) return null;
  if (MODIFIER_SET.has(keyPart as ModifierKey) && modifiers.length === 0) return null;
  const orderedModifiers = MODIFIER_ORDER.filter((mod) => modifiers.includes(mod));
  return normalizeBindingString([...orderedModifiers, keyPart].join("+"));
}

function generateId(prefix: string) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function formatBinding(binding: string | null) {
  if (!binding) return "Unassigned";
  const parts = binding.split("+");
  return parts
    .map((part) => {
      if (part === "ctrl") return "Ctrl";
      if (part === "alt") return "Alt";
      if (part === "shift") return "Shift";
      if (part === "meta") return "Meta";
      if (part === "space") return "Space";
      if (part === "esc") return "Esc";
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" + ");
}

function sanitizeHotkeySettings(settings: HotkeySettings | null | undefined) {
  const base = settings && typeof settings === "object" ? settings : DEFAULT_HOTKEY_SETTINGS;
  const sanitized: HotkeySettings = {
    enabled: !!base.enabled,
    paused: !!base.paused,
    allowRepeat: !!base.allowRepeat,
    bindings: { ...DEFAULT_HOTKEY_SETTINGS.bindings },
  };
  for (const action of HOTKEY_ACTIONS) {
    const normalized = normalizeBindingString(base.bindings?.[action.id] ?? action.defaultBinding);
    sanitized.bindings[action.id] = normalized;
  }
  return sanitized;
}

function hotkeySettingsEqual(a: HotkeySettings, b: HotkeySettings) {
  if (a.enabled !== b.enabled || a.paused !== b.paused || a.allowRepeat !== b.allowRepeat) return false;
  for (const action of HOTKEY_ACTIONS) {
    if ((a.bindings[action.id] ?? null) !== (b.bindings[action.id] ?? null)) return false;
  }
  return true;
}

function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return false;
}

function hasActiveModal() {
  if (typeof document === "undefined") return false;
  const ariaModal = document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])');
  if (ariaModal) return true;
  const openDialog = document.querySelector("dialog[open]");
  if (openDialog) return true;
  const roleDialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
  return !!roleDialog;
}

function shouldIgnoreHotkeyEvent(event: KeyboardEvent) {
  const target = event.target as Element | null;
  if (isEditableElement(target)) return true;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (isEditableElement(active)) return true;
  if (hasActiveModal()) return true;
  return false;
}

type AbsTimerStatus = "active" | "completed" | "expired";

interface AbsTimerGroup {
  id: string;
  name: string;
  color: string;
}

const DEFAULT_ABS_TIMER_GROUPS: AbsTimerGroup[] = [
  { id: "uma-banners", name: "Uma banners", color: "#f97316" },
  { id: "support-card-banners", name: "Support card banners", color: "#38bdf8" },
  { id: "champions-meeting", name: "Champions Meeting", color: "#a855f7" },
  { id: "other", name: "Other", color: "#22c55e" },
];

function defaultTimerColor(index: number) {
  if (index < 0) return TIMER_COLORS[0];
  return TIMER_COLORS[index % TIMER_COLORS.length];
}

function sanitizeTimerColor(color: string | undefined, index: number) {
  if (!color) return defaultTimerColor(index);
  const hex = color.trim();
  const valid = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(hex);
  return valid ? hex : defaultTimerColor(index);
}

function normalizeGroupName(name: string) {
  return name.trim().toLowerCase();
}

function findFallbackGroupId(groups: AbsTimerGroup[]) {
  if (!groups.length) return DEFAULT_ABS_TIMER_GROUPS[0].id;
  const other = groups.find((g) => normalizeGroupName(g.name).includes("other"));
  return other?.id ?? groups[0].id;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WEEKLY_FANS_TARGET = 2_000_000;
const MAX_WEEKLY_FANS_TARGET = 1_000_000_000;

interface FansCaratsEntry {
  date: string;
  fans: number;
  carats: number;
}

type RunLogType = "training" | "race" | "event" | "concert" | "other";

const RUN_LOG_TYPE_OPTIONS: { value: RunLogType; label: string }[] = [
  { value: "training", label: "Training" },
  { value: "race", label: "Race" },
  { value: "event", label: "Event" },
  { value: "concert", label: "Concert" },
  { value: "other", label: "Other" },
];

const RUN_LOG_TYPE_SET = new Set<RunLogType>(RUN_LOG_TYPE_OPTIONS.map((option) => option.value));
const RUN_LOG_TYPE_LABELS: Record<RunLogType, string> = RUN_LOG_TYPE_OPTIONS.reduce(
  (acc, option) => {
    acc[option.value] = option.label;
    return acc;
  },
  {} as Record<RunLogType, string>,
);

interface FansCaratsRunLogEntry {
  id: string;
  date: string;
  fans: number;
  type: RunLogType;
  notes: string;
  createdAt: number;
}

interface RunLogEntryInput {
  id?: string;
  date: string;
  fans: number;
  type: RunLogType;
  notes?: string;
}

interface FansCaratsState {
  entries: FansCaratsEntry[];
  runLog: FansCaratsRunLogEntry[];
}

interface FansCaratsDailyStat extends FansCaratsEntry {
  fansDelta: number | null;
  caratsDelta: number | null;
}

interface FansCaratsWeeklySummary {
  weekStart: string;
  weekEnd: string;
  lastEntry: string;
  fansDelta: number;
  caratsDelta: number;
  daysLogged: number;
}

interface RollingTotal {
  fans: number;
  carats: number;
}

interface TrendPoint {
  ts: number;
  value: number;
}

interface FansCaratsConfig {
  weeklyFansTarget: number;
}

function pad2(value: number) {
  return String(Math.trunc(Math.abs(value))).padStart(2, "0");
}

function normalizeISODate(value: string | null | undefined) {
  if (!value) return null;
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null;
  return `${match[1]}-${match[2]}-${match[3]}`;
}

function dateStringToMs(date: string) {
  const normalized = normalizeISODate(date);
  if (!normalized) return Number.NaN;
  const [year, month, day] = normalized.split("-").map((part) => Number(part));
  return Date.UTC(year, month - 1, day);
}

function msToISODate(ms: number) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function startOfWeekISO(date: string) {
  const ms = dateStringToMs(date);
  if (!Number.isFinite(ms)) return date;
  const d = new Date(ms);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  return msToISODate(ms - diff * DAY_MS);
}

function endOfWeekISO(date: string) {
  const start = startOfWeekISO(date);
  const startMs = dateStringToMs(start);
  if (!Number.isFinite(startMs)) return start;
  return msToISODate(startMs + 6 * DAY_MS);
}

function getTodayISODate() {
  const nowDate = new Date();
  return `${nowDate.getFullYear()}-${pad2(nowDate.getMonth() + 1)}-${pad2(nowDate.getDate())}`;
}

function formatDateLabel(date: string) {
  const ms = dateStringToMs(date);
  if (!Number.isFinite(ms)) return date;
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    weekday: "short",
  });
}

function formatWeekRange(start: string, end: string) {
  return `${formatDateLabel(start)} – ${formatDateLabel(end)}`;
}

function formatNumber(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString();
}

function formatDelta(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "—";
  const rounded = Math.round(value);
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toLocaleString()}`;
}

function parseInteger(value: string) {
  if (!value) return null;
  const normalized = value.replace(/,/g, "").trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

function sanitizeFansCaratsState(value: unknown): FansCaratsState {
  const entries: FansCaratsEntry[] = [];
  const runLog: FansCaratsRunLogEntry[] = [];
  const rawEntries: unknown =
    value && typeof value === "object" && Array.isArray((value as FansCaratsState).entries)
      ? (value as FansCaratsState).entries
      : Array.isArray(value)
      ? (value as FansCaratsEntry[])
      : [];
  const map = new Map<string, FansCaratsEntry>();
  for (const entry of rawEntries as FansCaratsEntry[]) {
    if (!entry || typeof entry !== "object") continue;
    const normalizedDate = normalizeISODate((entry as FansCaratsEntry).date);
    if (!normalizedDate) continue;
    const fansNum = Number((entry as FansCaratsEntry).fans);
    const caratsNum = Number((entry as FansCaratsEntry).carats);
    if (!Number.isFinite(fansNum) || !Number.isFinite(caratsNum)) continue;
    const fans = Math.max(0, Math.round(fansNum));
    const carats = Math.max(0, Math.round(caratsNum));
    map.set(normalizedDate, { date: normalizedDate, fans, carats });
  }
  const sortedDates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
  for (const date of sortedDates) {
    entries.push(map.get(date)!);
  }

  const rawRunLog: unknown =
    value && typeof value === "object" && Array.isArray((value as FansCaratsState).runLog)
      ? (value as FansCaratsState).runLog
      : [];

  const seenIds = new Set<string>();
  for (const entry of rawRunLog as FansCaratsRunLogEntry[]) {
    if (!entry || typeof entry !== "object") continue;
    const normalizedDate = normalizeISODate((entry as FansCaratsRunLogEntry).date);
    if (!normalizedDate) continue;
    const fansNum = Number((entry as FansCaratsRunLogEntry).fans);
    if (!Number.isFinite(fansNum)) continue;
    const fans = Math.max(0, Math.round(fansNum));
    const typeRaw = (entry as FansCaratsRunLogEntry).type;
    const type: RunLogType = RUN_LOG_TYPE_SET.has(typeRaw as RunLogType) ? (typeRaw as RunLogType) : "other";
    const notesRaw = (entry as FansCaratsRunLogEntry).notes;
    const notes =
      typeof notesRaw === "string"
        ? notesRaw.trim().slice(0, 500)
        : notesRaw == null
        ? ""
        : String(notesRaw).trim().slice(0, 500);
    const createdAtRaw = Number((entry as FansCaratsRunLogEntry).createdAt);
    const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : dateStringToMs(normalizedDate);
    const idRaw = (entry as FansCaratsRunLogEntry).id;
    const id =
      typeof idRaw === "string" && idRaw.trim().length > 0 ? idRaw : generateId("run");
    if (seenIds.has(id)) continue;
    seenIds.add(id);
    runLog.push({
      id,
      date: normalizedDate,
      fans,
      type,
      notes,
      createdAt: Number.isFinite(createdAt) ? createdAt : Date.now(),
    });
  }

  runLog.sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    const dateDiff = b.date.localeCompare(a.date);
    if (dateDiff !== 0) return dateDiff;
    return b.id.localeCompare(a.id);
  });

  return { entries, runLog };
}

function sanitizeFansCaratsConfig(value: unknown): FansCaratsConfig {
  if (!value || typeof value !== "object") {
    return { weeklyFansTarget: DEFAULT_WEEKLY_FANS_TARGET };
  }
  const target = Number((value as FansCaratsConfig).weeklyFansTarget);
  if (!Number.isFinite(target) || target <= 0) return { weeklyFansTarget: DEFAULT_WEEKLY_FANS_TARGET };
  const clamped = clamp(Math.round(target), 1, MAX_WEEKLY_FANS_TARGET);
  return { weeklyFansTarget: clamped };
}

function buildFansCaratsDailyStats(entries: FansCaratsEntry[]): FansCaratsDailyStat[] {
  const stats: FansCaratsDailyStat[] = [];
  let prevFans: number | null = null;
  let prevCarats: number | null = null;
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  for (const entry of sorted) {
    const fansDelta = prevFans == null ? null : entry.fans - prevFans;
    const caratsDelta = prevCarats == null ? null : entry.carats - prevCarats;
    stats.push({ ...entry, fansDelta, caratsDelta });
    prevFans = entry.fans;
    prevCarats = entry.carats;
  }
  return stats;
}

function buildRollingTotals(stats: FansCaratsDailyStat[], windowSize: number): Map<string, RollingTotal> {
  const totals = new Map<string, RollingTotal>();
  const queue: RollingTotal[] = [];
  let fansSum = 0;
  let caratsSum = 0;
  for (const stat of stats) {
    const fansDelta = stat.fansDelta ?? 0;
    const caratsDelta = stat.caratsDelta ?? 0;
    queue.push({ fans: fansDelta, carats: caratsDelta });
    fansSum += fansDelta;
    caratsSum += caratsDelta;
    if (queue.length > windowSize) {
      const removed = queue.shift();
      if (removed) {
        fansSum -= removed.fans;
        caratsSum -= removed.carats;
      }
    }
    totals.set(stat.date, { fans: fansSum, carats: caratsSum });
  }
  return totals;
}

function buildWeeklySummaries(stats: FansCaratsDailyStat[]): FansCaratsWeeklySummary[] {
  const map = new Map<string, FansCaratsWeeklySummary>();
  for (const stat of stats) {
    const weekStart = startOfWeekISO(stat.date);
    const weekEnd = endOfWeekISO(stat.date);
    const existing = map.get(weekStart);
    if (existing) {
      existing.fansDelta += stat.fansDelta ?? 0;
      existing.caratsDelta += stat.caratsDelta ?? 0;
      existing.daysLogged += 1;
      if (stat.date.localeCompare(existing.lastEntry) > 0) existing.lastEntry = stat.date;
    } else {
      map.set(weekStart, {
        weekStart,
        weekEnd,
        lastEntry: stat.date,
        fansDelta: stat.fansDelta ?? 0,
        caratsDelta: stat.caratsDelta ?? 0,
        daysLogged: 1,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}

function buildTrendSeries(
  stats: FansCaratsDailyStat[],
  key: "fansDelta" | "caratsDelta",
  limit = 30
): TrendPoint[] {
  if (!stats.length) return [];
  const slice = stats.slice(Math.max(0, stats.length - limit));
  const series = slice.map((stat) => ({
    ts: dateStringToMs(stat.date),
    value: stat[key] ?? 0,
  }));
  if (series.length === 1) {
    series.push({ ts: series[0].ts + DAY_MS, value: series[0].value });
  }
  return series.filter((point) => Number.isFinite(point.ts));
}

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

function mixColor(color: string, target: string, amount: number) {
  const base = hexToRgb(color);
  const other = hexToRgb(target);
  if (!base || !other) return color;
  const ratio = clamp(amount, 0, 1);
  const r = base.r + (other.r - base.r) * ratio;
  const g = base.g + (other.g - base.g) * ratio;
  const b = base.b + (other.b - base.b) * ratio;
  return rgbToHex(r, g, b);
}

function withAlpha(hex: string, alpha: number) {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const a = clamp(alpha, 0, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${a})`;
}
const now = () => Date.now();

function sanitizeHistorySnapshot(
  snapshot: Partial<ResourceHistorySnapshot> | undefined,
  kind: ResourceKind
): ResourceHistorySnapshot {
  const points: ResourceHistoryPoint[] = [];
  if (snapshot && Array.isArray(snapshot.points)) {
    for (const point of snapshot.points) {
      const ts = Number(point?.ts);
      const value = Number(point?.value);
      if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
      points.push({ ts, value });
    }
    points.sort((a, b) => a.ts - b.ts);
    if (points.length > HISTORY_MAX_POINTS) points.splice(0, points.length - HISTORY_MAX_POINTS);
  }

  const events: ResourceHistoryEvent[] = [];
  if (snapshot && Array.isArray(snapshot.events)) {
    for (const event of snapshot.events) {
      const ts = Number(event?.ts);
      const value = Number(event?.value);
      if (!Number.isFinite(ts) || !Number.isFinite(value)) continue;
      const deltaRaw = Number(event?.delta);
      const delta = Number.isFinite(deltaRaw) ? deltaRaw : undefined;
      const note = typeof event?.note === "string" && event.note.trim().length > 0 ? event.note.trim() : undefined;
      const type: ResourceHistoryEvent["type"] =
        event?.type === "spend" || event?.type === "manual" || event?.type === "reset"
          ? event.type
          : "manual";
      const id = typeof event?.id === "string" && event.id ? event.id : crypto.randomUUID();
      events.push({ id, ts, kind, type, value, delta, note });
    }
    events.sort((a, b) => a.ts - b.ts);
    if (events.length > HISTORY_MAX_POINTS) events.splice(0, events.length - HISTORY_MAX_POINTS);
  }

  return { points, events };
}

function sanitizeHistoryState(state: Partial<ResourceHistoryState> | undefined): ResourceHistoryState {
  if (!state || typeof state !== "object") return createEmptyHistoryState();
  const base = state as ResourceHistoryState;
  return {
    tp: sanitizeHistorySnapshot(base.tp, "tp"),
    rp: sanitizeHistorySnapshot(base.rp, "rp"),
  };
}

function cloneHistoryState(state: ResourceHistoryState): ResourceHistoryState {
  return {
    tp: { points: [...state.tp.points], events: [...state.tp.events] },
    rp: { points: [...state.rp.points], events: [...state.rp.events] },
  };
}

interface WastedResetState {
  tp: number | null;
  rp: number | null;
}

function sanitizeWastedResetState(state: Partial<WastedResetState> | undefined): WastedResetState {
  const normalize = (value: unknown) => {
    if (value == null) return null;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  };
  if (!state || typeof state !== "object") return { tp: null, rp: null };
  const base = state as WastedResetState;
  return {
    tp: normalize(base.tp),
    rp: normalize(base.rp),
  };
}

function wastedResetStateEqual(
  a: Partial<WastedResetState> | undefined,
  b: Partial<WastedResetState> | undefined
) {
  const normalize = (value: unknown) => {
    if (value == null) return null;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : null;
  };
  return (normalize(a?.tp) ?? null) === (normalize(b?.tp) ?? null) &&
    (normalize(a?.rp) ?? null) === (normalize(b?.rp) ?? null);
}

function trimHistorySnapshot(snapshot: ResourceHistorySnapshot, cutoff: number): ResourceHistorySnapshot {
  const points = snapshot.points.filter((p) => p.ts >= cutoff);
  const events = snapshot.events.filter((e) => e.ts >= cutoff);
  return { points, events };
}

function trimHistoryInPlace(snapshot: ResourceHistorySnapshot, cutoff: number) {
  const trimmed = trimHistorySnapshot(snapshot, cutoff);
  snapshot.points = trimmed.points;
  snapshot.events = trimmed.events;
}

function pushHistoryPoint(
  snapshot: ResourceHistorySnapshot,
  value: number,
  timestamp: number,
  force = false
) {
  const last = snapshot.points[snapshot.points.length - 1];
  if (last) {
    if (!force && Math.abs(last.value - value) < 0.01 && timestamp - last.ts < HISTORY_MIN_POINT_GAP_MS)
      return false;
  }
  snapshot.points.push({ ts: timestamp, value });
  if (snapshot.points.length > HISTORY_MAX_POINTS)
    snapshot.points.splice(0, snapshot.points.length - HISTORY_MAX_POINTS);
  return true;
}

function addHistoryEventToSnapshot(
  snapshot: ResourceHistorySnapshot,
  kind: ResourceKind,
  value: number,
  timestamp: number,
  event: ResourceHistoryEventInput
) {
  const entry: ResourceHistoryEvent = {
    id: crypto.randomUUID(),
    ts: timestamp,
    kind,
    type: event.type,
    value,
    delta: event.delta,
    note: event.note,
  };
  snapshot.events.push(entry);
  if (snapshot.events.length > HISTORY_MAX_POINTS)
    snapshot.events.splice(0, snapshot.events.length - HISTORY_MAX_POINTS);
  return true;
}

function describeHistoryEvent(
  event: ResourceHistoryEvent,
  resourceLabel: string,
  timeZone: string
): string {
  const time = new Date(event.ts).toLocaleTimeString([], { timeZone, hour: "2-digit", minute: "2-digit" });
  const after = Math.round(event.value);
  const delta = event.delta ?? 0;

  if (event.note) {
    return `${event.note} → ${after} • ${time}`;
  }

  switch (event.type) {
    case "reset":
      return `Daily reset → ${after} • ${time}`;
    case "spend": {
      const amount = Math.round(Math.abs(delta));
      if (amount > 0) {
        return `Spent ${amount} ${resourceLabel} → ${after} • ${time}`;
      }
      return `Spent ${resourceLabel} → ${after} • ${time}`;
    }
    default:
      break;
  }

  if (delta > 0) {
    return `Added ${Math.round(delta)} ${resourceLabel} → ${after} • ${time}`;
  }
  if (delta < 0) {
    return `Removed ${Math.round(Math.abs(delta))} ${resourceLabel} → ${after} • ${time}`;
  }
  return `Adjusted ${resourceLabel} → ${after} • ${time}`;
}

function absTimerCountdownProgress(status: AbsTimerStatus | undefined, remainingMs: number) {
  if (status === "completed" || status === "expired") return 0;
  if (remainingMs <= 0) return 0;
  if (remainingMs >= ABS_TIMER_COUNTDOWN_WINDOW_MS) return 1;
  return remainingMs / ABS_TIMER_COUNTDOWN_WINDOW_MS;
}

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
  hotkeysEnabled: boolean;
  hotkeysPaused: boolean;
  onToggleHotkeysPause: () => void;
}

function Header({
  hud,
  onOpenSettings,
  timeZone,
  isSettingsOpen,
  hotkeysEnabled,
  hotkeysPaused,
  onToggleHotkeysPause,
}: HeaderProps) {
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
          Uma RP/TP Tracker — Release Candidate
        </div>
        <div style={{ color: COLOR.subtle, fontSize: 12, marginTop: 4 }}>
          Current time zone: {zone}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {hotkeysEnabled ? (
          <SmallBtn onClick={onToggleHotkeysPause}>
            {hotkeysPaused ? "Resume hotkeys" : "Pause hotkeys"}
          </SmallBtn>
        ) : (
          <span style={{ fontSize: 12, color: COLOR.subtle }}>Hotkeys disabled</span>
        )}
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
        background: `linear-gradient(150deg, ${withAlpha(mixColor(COLOR.card, COLOR.bg, 0.35), 0.97)} 0%, ${withAlpha(
          mixColor(COLOR.card, "#000000", 0.5),
          0.97
        )} 100%)`,
        border: `1px solid ${withAlpha(mixColor(COLOR.border, "#000000", 0.35), 0.85)}`,
        borderRadius: 14,
        padding: 14,
        boxShadow: `0 14px 32px ${withAlpha(mixColor(COLOR.card, "#000000", 0.55), 0.45)}`,
        marginBottom: 12,
        color: COLOR.text,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

function RowRight({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
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
  disabled?: boolean;
}

function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
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
  const track = withAlpha(mixColor(color, COLOR.bg, 0.7), 0.4);
  const fill = `linear-gradient(90deg, ${withAlpha(mixColor(color, "#ffffff", 0.35), 0.9)} 0%, ${withAlpha(
    mixColor(color, "#000000", 0.1),
    0.95
  )} 100%)`;
  return (
    <div
      style={{
        width: "100%",
        height: 8,
        background: track,
        borderRadius: 999,
        overflow: "hidden",
        boxShadow: `inset 0 0 6px ${withAlpha("#000000", 0.3)}`,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: fill,
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

function buildHistorySeries(
  points: ResourceHistoryPoint[],
  currentValue: number,
  domainStart: number,
  domainEnd: number
) {
  const filtered = points.filter((p) => p.ts >= domainStart);
  const series: ResourceHistoryPoint[] = filtered.length ? [...filtered] : [];
  if (!series.length) {
    series.push({ ts: domainStart, value: currentValue });
  }
  if (series[0].ts > domainStart) {
    series.unshift({ ts: domainStart, value: series[0].value });
  }
  const latestValue = currentValue;
  const lastSeriesPoint = series[series.length - 1];
  if (!lastSeriesPoint || domainEnd - lastSeriesPoint.ts > 0) {
    const value = lastSeriesPoint ? lastSeriesPoint.value : latestValue;
    const finalValue = Math.abs(value - latestValue) > 0.01 ? latestValue : value;
    series.push({ ts: domainEnd, value: finalValue });
  }
  if (series.length === 1) {
    series.push({ ts: domainEnd, value: series[0].value });
  }
  return series;
}

interface SparklineProps {
  points: ResourceHistoryPoint[];
  color: string;
  cap: number;
  currentValue: number;
  retentionMs: number;
  label: string;
  height?: number;
}

function Sparkline({ points, color, cap, currentValue, retentionMs, label, height = 40 }: SparklineProps) {
  const width = 100;
  const nowMs = now();
  const domainStart = nowMs - retentionMs;
  const domainEnd = nowMs;
  const span = Math.max(domainEnd - domainStart, 1);

  const series = buildHistorySeries(points, currentValue, domainStart, domainEnd);

  const coords = series.map((p) => {
    const x = ((p.ts - domainStart) / span) * width;
    const ratio = cap > 0 ? clamp(p.value / cap, 0, 1) : 0;
    const y = height - ratio * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  if (!coords.length) coords.push(`0,${height}`, `${width},${height}`);

  const areaPath = `M0,${height} L${coords.join(" L ")} L${width},${height} Z`;
  const linePath = `M${coords.join(" L ")}`;
  const capY = 0;
  const capStroke = withAlpha(mixColor(color, "#ffffff", 0.45), 0.7);

  return (
    <div style={{ width: "100%", height }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} history sparkline`}
      >
        <path d={areaPath} fill={withAlpha(mixColor(color, COLOR.bg, 0.35), 0.25)} stroke="none" />
        {cap > 0 && (
          <line
            x1={0}
            y1={capY.toFixed(2)}
            x2={width}
            y2={capY.toFixed(2)}
            stroke={capStroke}
            strokeWidth={0.8}
            strokeDasharray="3 3"
          />
        )}
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
      </svg>
    </div>
  );
}

interface TrendSparklineProps {
  data: TrendPoint[];
  color: string;
  label: string;
  height?: number;
}

function TrendSparkline({ data, color, label, height = 48 }: TrendSparklineProps) {
  const width = 100;
  if (!data.length) {
    return (
      <div style={{ width: "100%", height }} aria-label={`${label} trend`}></div>
    );
  }

  const domainStart = data[0].ts;
  const domainEnd = data[data.length - 1].ts;
  const span = Math.max(domainEnd - domainStart, 1);
  const values = data.map((point) => point.value);
  const minValue = Math.min(...values, 0);
  const maxValue = Math.max(...values, 0);
  const adjustedMin = minValue === maxValue ? minValue - 1 : minValue;
  const adjustedMax = minValue === maxValue ? maxValue + 1 : maxValue;
  const range = Math.max(adjustedMax - adjustedMin, 1);

  const coords = data.map((point) => {
    const x = span === 0 ? 0 : ((point.ts - domainStart) / span) * width;
    const ratio = clamp((point.value - adjustedMin) / range, 0, 1);
    const y = height - ratio * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const areaPath = `M0,${height} L${coords.join(" L ")} L${width},${height} Z`;
  const linePath = `M${coords.join(" L ")}`;
  const zeroRatio = clamp((0 - adjustedMin) / range, 0, 1);
  const zeroY = height - zeroRatio * height;

  return (
    <div style={{ width: "100%", height }}>
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label} trend sparkline`}
      >
        <path d={areaPath} fill={withAlpha(mixColor(color, COLOR.bg, 0.35), 0.25)} stroke="none" />
        <line
          x1={0}
          y1={zeroY.toFixed(2)}
          x2={width}
          y2={zeroY.toFixed(2)}
          stroke={withAlpha(mixColor(color, "#ffffff", 0.4), 0.6)}
          strokeWidth={0.8}
          strokeDasharray="3 3"
        />
        <path d={linePath} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
      </svg>
    </div>
  );
}

interface SummaryBoxProps {
  title: string;
  accent: string;
  children: React.ReactNode;
}

function SummaryBox({ title, accent, children }: SummaryBoxProps) {
  const background = `linear-gradient(135deg, ${withAlpha(mixColor(accent, "#ffffff", 0.35), 0.94)} 0%, ${withAlpha(
    mixColor(accent, "#000000", 0.2),
    0.9
  )} 100%)`;
  const border = `1px solid ${withAlpha(mixColor(accent, "#000000", 0.45), 0.9)}`;
  return (
    <div
      style={{
        background,
        border,
        borderRadius: 12,
        padding: 12,
        boxShadow: `0 10px 22px ${withAlpha(mixColor(accent, "#000000", 0.5), 0.35)}`,
        display: "grid",
        gap: 4,
      }}
    >
      <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.6, color: withAlpha("#ffffff", 0.85) }}>
        {title}
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, color: COLOR.text }}>{children}</div>
    </div>
  );
}

interface FansCaratsAnalyticsProps {
  entries: FansCaratsEntry[];
  dailyStats: FansCaratsDailyStat[];
  rollingTotals: Map<string, RollingTotal>;
  weeklySummaries: FansCaratsWeeklySummary[];
  weeklyTarget: number;
  onSubmit: (entry: FansCaratsEntry) => void;
  onDelete: (date: string) => void;
  onUpdateWeeklyTarget: (target: number) => void;
  fansTrend: TrendPoint[];
  caratsTrend: TrendPoint[];
  runLogEntries: FansCaratsRunLogEntry[];
  onSaveRunLogEntry: (entry: RunLogEntryInput) => void;
  onDeleteRunLogEntry: (id: string) => void;
}

function FansCaratsAnalytics({
  entries,
  dailyStats,
  rollingTotals,
  weeklySummaries,
  weeklyTarget,
  onSubmit,
  onDelete,
  onUpdateWeeklyTarget,
  fansTrend,
  caratsTrend,
  runLogEntries,
  onSaveRunLogEntry,
  onDeleteRunLogEntry,
}: FansCaratsAnalyticsProps) {
  const entryMap = useMemo(() => new Map(entries.map((entry) => [entry.date, entry])), [entries]);
  const latest = dailyStats.length ? dailyStats[dailyStats.length - 1] : null;
  const latestEntry = latest ? entryMap.get(latest.date) ?? null : null;
  const [formDate, setFormDate] = useState(() => latest?.date ?? getTodayISODate());
  const [formFans, setFormFans] = useState(() => (latestEntry ? String(latestEntry.fans) : ""));
  const [formCarats, setFormCarats] = useState(() => (latestEntry ? String(latestEntry.carats) : ""));
  const [formError, setFormError] = useState<string | null>(null);
  const [lastSavedDate, setLastSavedDate] = useState<string | null>(null);
  const [weeklyTargetDraft, setWeeklyTargetDraft] = useState(() => weeklyTarget.toString());
  const [activeTab, setActiveTab] = useState<"daily" | "runLog">("daily");

  useEffect(() => {
    if (!latest) return;
    setFormDate((prev) => prev || latest.date);
  }, [latest?.date]);

  useEffect(() => {
    if (!latest) return;
    const base = entryMap.get(latest.date);
    setFormFans((prev) => (prev.trim().length ? prev : base ? String(base.fans) : ""));
    setFormCarats((prev) => (prev.trim().length ? prev : base ? String(base.carats) : ""));
  }, [latest?.date, entryMap]);

  useEffect(() => {
    setWeeklyTargetDraft(weeklyTarget.toString());
  }, [weeklyTarget]);

  const recentStats = useMemo(() => dailyStats.slice(-14).reverse(), [dailyStats]);
  const latestRolling = latest ? rollingTotals.get(latest.date) ?? { fans: 0, carats: 0 } : null;
  const currentWeekStart = latest ? startOfWeekISO(latest.date) : null;
  const currentWeekSummary = currentWeekStart
    ? weeklySummaries.find((summary) => summary.weekStart === currentWeekStart)
    : undefined;
  const previousWeekSummary = weeklySummaries.length >= 2 ? weeklySummaries[weeklySummaries.length - 2] : undefined;
  const clubOnTrack = currentWeekSummary ? currentWeekSummary.fansDelta >= weeklyTarget : false;
  const fansNeeded = currentWeekSummary ? Math.max(0, weeklyTarget - currentWeekSummary.fansDelta) : weeklyTarget;

  const handleSubmit = useCallback(() => {
    const normalizedDate = normalizeISODate(formDate);
    if (!normalizedDate) {
      setFormError("Enter a valid date (YYYY-MM-DD).");
      return;
    }
    const fansValue = parseInteger(formFans);
    if (fansValue == null) {
      setFormError("Enter a numeric fans total.");
      return;
    }
    const caratsValue = parseInteger(formCarats);
    if (caratsValue == null) {
      setFormError("Enter a numeric carats total.");
      return;
    }
    setFormError(null);
    setLastSavedDate(normalizedDate);
    onSubmit({ date: normalizedDate, fans: fansValue, carats: caratsValue });
  }, [formDate, formFans, formCarats, onSubmit]);

  const handleDelete = useCallback(
    (date: string) => {
      onDelete(date);
      if (date === formDate) {
        setLastSavedDate(null);
      }
    },
    [onDelete, formDate]
  );

  const loadEntry = useCallback(
    (date: string) => {
      const entry = entryMap.get(date);
      if (!entry) return;
      setFormDate(entry.date);
      setFormFans(String(entry.fans));
      setFormCarats(String(entry.carats));
      setFormError(null);
    },
    [entryMap]
  );

  const handleUpdateTarget = useCallback(() => {
    const parsed = parseInteger(weeklyTargetDraft);
    if (parsed == null || parsed <= 0) {
      setFormError("Enter a positive weekly fans target.");
      return;
    }
    setFormError(null);
    onUpdateWeeklyTarget(parsed);
  }, [weeklyTargetDraft, onUpdateWeeklyTarget]);

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <TabButton active={activeTab === "daily"} onClick={() => setActiveTab("daily")}>
          Daily totals
        </TabButton>
        <TabButton active={activeTab === "runLog"} onClick={() => setActiveTab("runLog")}>
          Run log
        </TabButton>
      </div>

      {activeTab === "daily" ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
        <SummaryBox title="Latest totals" accent={COLOR.fans}>
          {latest ? (
            <div style={{ display: "grid", gap: 2 }}>
              <div>Fans: {formatNumber(latest.fans)}</div>
              <div>Carats: {formatNumber(latest.carats)}</div>
              <div style={{ fontSize: 12, color: COLOR.subtle }}>
                Δ Fans {formatDelta(latest.fansDelta)} • Δ Carats {formatDelta(latest.caratsDelta)}
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: COLOR.subtle }}>Log your first totals to start tracking.</div>
          )}
        </SummaryBox>
        <SummaryBox title="7-day rolling" accent={COLOR.carats}>
          {latestRolling ? (
            <div style={{ display: "grid", gap: 2 }}>
              <div>Fans Δ: {formatNumber(latestRolling.fans)}</div>
              <div>Carats Δ: {formatNumber(latestRolling.carats)}</div>
              <div style={{ fontSize: 12, color: COLOR.subtle }}>
                Based on the last seven logged days.
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: COLOR.subtle }}>Needs at least one entry.</div>
          )}
        </SummaryBox>
        <SummaryBox title="Club weekly check" accent={clubOnTrack ? COLOR.good : COLOR.danger}>
          <div style={{ display: "grid", gap: 2 }}>
            <div>{clubOnTrack ? "On pace" : "Needs attention"}</div>
            <div>
              {formatNumber(currentWeekSummary?.fansDelta ?? 0)} / {formatNumber(weeklyTarget)} fans
            </div>
            <div style={{ fontSize: 12, color: COLOR.subtle }}>
              {clubOnTrack
                ? "Great work! Keep logging daily fans."
                : `Need ${formatNumber(fansNeeded)} more fans by Sunday.`}
            </div>
          </div>
        </SummaryBox>
      </div>

      <div
        style={{
          display: "grid",
          gap: 12,
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        }}
      >
        <div
          style={{
            background: COLOR.slate700,
            borderRadius: 12,
            padding: 12,
            border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
            boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Log daily totals</div>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, color: COLOR.subtle }}>Date</label>
              <Input type="date" value={formDate} onChange={setFormDate} />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, color: COLOR.subtle }}>Fans total</label>
              <Input value={formFans} onChange={setFormFans} placeholder="Enter fans" />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontSize: 12, color: COLOR.subtle }}>Carats (Jewels) total</label>
              <Input value={formCarats} onChange={setFormCarats} placeholder="Enter carats" />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <SmallBtn onClick={handleSubmit}>Save daily totals</SmallBtn>
            {lastSavedDate && (
              <span style={{ fontSize: 12, color: COLOR.subtle }}>Saved {formatDateLabel(lastSavedDate)}</span>
            )}
          </div>
          <div style={{ borderTop: `1px solid ${withAlpha(COLOR.border, 0.6)}`, paddingTop: 8, marginTop: 4 }}>
            <div style={{ fontSize: 12, color: COLOR.subtle, marginBottom: 6 }}>Weekly club target</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
              <Input value={weeklyTargetDraft} onChange={setWeeklyTargetDraft} placeholder="2,000,000" />
              <SmallBtn onClick={handleUpdateTarget}>Update target</SmallBtn>
            </div>
          </div>
          {formError && <div style={{ fontSize: 12, color: COLOR.danger }}>{formError}</div>}
        </div>

        <div
          style={{
            background: COLOR.slate700,
            borderRadius: 12,
            padding: 12,
            border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
            boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
            display: "grid",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Trend snapshots</div>
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, color: COLOR.subtle, marginBottom: 4 }}>Fans daily change</div>
              <TrendSparkline data={fansTrend} color={COLOR.fans} label="Fans daily change" />
            </div>
            <div>
              <div style={{ fontSize: 12, color: COLOR.subtle, marginBottom: 4 }}>Carats daily change</div>
              <TrendSparkline data={caratsTrend} color={COLOR.carats} label="Carats daily change" />
            </div>
          </div>
          {previousWeekSummary && (
            <div style={{ fontSize: 12, color: COLOR.subtle }}>
              Previous week ({formatWeekRange(previousWeekSummary.weekStart, previousWeekSummary.weekEnd)}):
              {" "}
              {formatNumber(previousWeekSummary.fansDelta)} fans • {formatNumber(previousWeekSummary.caratsDelta)} carats
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          background: COLOR.slate700,
          borderRadius: 12,
          padding: 12,
          border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
          boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 8 }}>Recent daily logs</div>
        {recentStats.length === 0 ? (
          <div style={{ fontSize: 13, color: COLOR.subtle }}>Logs appear here once you save a daily total.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ color: COLOR.subtle, textAlign: "left" }}>
                  <th style={{ padding: "6px 4px" }}>Date</th>
                  <th style={{ padding: "6px 4px" }}>Fans</th>
                  <th style={{ padding: "6px 4px" }}>Δ Fans</th>
                  <th style={{ padding: "6px 4px" }}>Carats</th>
                  <th style={{ padding: "6px 4px" }}>Δ Carats</th>
                  <th style={{ padding: "6px 4px" }}>7d Fans</th>
                  <th style={{ padding: "6px 4px" }}>7d Carats</th>
                  <th style={{ padding: "6px 4px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recentStats.map((stat) => {
                  const totals = rollingTotals.get(stat.date) ?? { fans: 0, carats: 0 };
                  return (
                    <tr key={stat.date} style={{ borderTop: `1px solid ${withAlpha(COLOR.border, 0.6)}` }}>
                      <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{formatDateLabel(stat.date)}</td>
                      <td style={{ padding: "6px 4px" }}>{formatNumber(stat.fans)}</td>
                      <td style={{ padding: "6px 4px", color: stat.fansDelta != null && stat.fansDelta >= 0 ? COLOR.good : COLOR.danger }}>
                        {formatDelta(stat.fansDelta)}
                      </td>
                      <td style={{ padding: "6px 4px" }}>{formatNumber(stat.carats)}</td>
                      <td style={{ padding: "6px 4px", color: stat.caratsDelta != null && stat.caratsDelta >= 0 ? COLOR.good : COLOR.danger }}>
                        {formatDelta(stat.caratsDelta)}
                      </td>
                      <td style={{ padding: "6px 4px" }}>{formatNumber(totals.fans)}</td>
                      <td style={{ padding: "6px 4px" }}>{formatNumber(totals.carats)}</td>
                      <td style={{ padding: "6px 4px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <SmallBtn onClick={() => loadEntry(stat.date)}>Load</SmallBtn>
                          <SmallBtn onClick={() => handleDelete(stat.date)} danger>
                            Delete
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {weeklySummaries.length > 0 && (
        <div
          style={{
            background: COLOR.slate700,
            borderRadius: 12,
            padding: 12,
            border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
            boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
            display: "grid",
            gap: 6,
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Weekly summaries</div>
          <div style={{ display: "grid", gap: 6 }}>
            {[...weeklySummaries].reverse().map((summary) => (
              <div
                key={summary.weekStart}
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 10,
                  background: withAlpha(COLOR.card, 0.6),
                  border: `1px solid ${withAlpha(COLOR.border, 0.6)}`,
                }}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{formatWeekRange(summary.weekStart, summary.weekEnd)}</div>
                  <div style={{ fontSize: 12, color: COLOR.subtle }}>
                    Logged {summary.daysLogged} day{summary.daysLogged === 1 ? "" : "s"}
                  </div>
                </div>
                <div style={{ fontSize: 12, textAlign: "right" }}>
                  <div>Fans Δ: {formatDelta(summary.fansDelta)}</div>
                  <div>Carats Δ: {formatDelta(summary.caratsDelta)}</div>
                  <div style={{ color: COLOR.subtle }}>Last entry {formatDateLabel(summary.lastEntry)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
        </>
      ) : (
        <RunLogTab
          entries={runLogEntries}
          onSave={onSaveRunLogEntry}
          onDelete={onDeleteRunLogEntry}
          dailyStats={dailyStats}
        />
      )}
    </div>
  );
}

interface RunLogTabProps {
  entries: FansCaratsRunLogEntry[];
  onSave: (entry: RunLogEntryInput) => void;
  onDelete: (id: string) => void;
  dailyStats: FansCaratsDailyStat[];
}

function RunLogTab({ entries, onSave, onDelete, dailyStats }: RunLogTabProps) {
  const [formDate, setFormDate] = useState(getTodayISODate());
  const [formType, setFormType] = useState<RunLogType>("training");
  const [formFans, setFormFans] = useState("");
  const [formNotes, setFormNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const totalFans = useMemo(() => entries.reduce((sum, entry) => sum + entry.fans, 0), [entries]);
  const totalRuns = entries.length;
  const averageFans = totalRuns > 0 ? totalFans / totalRuns : 0;
  const last7Fans = useMemo(() => {
    if (entries.length === 0) return 0;
    const today = getTodayISODate();
    const todayMs = dateStringToMs(today);
    if (!Number.isFinite(todayMs)) {
      return entries.reduce((sum, entry) => sum + entry.fans, 0);
    }
    const threshold = todayMs - 6 * DAY_MS;
    return entries.reduce((sum, entry) => {
      const entryMs = dateStringToMs(entry.date);
      if (!Number.isFinite(entryMs)) return sum;
      if (entryMs >= threshold && entryMs <= todayMs) return sum + entry.fans;
      return sum;
    }, 0);
  }, [entries]);
  const bestRun = useMemo(() => {
    if (entries.length === 0) return null;
    return entries.reduce((best, entry) => (entry.fans > best.fans ? entry : best), entries[0]);
  }, [entries]);
  const typeSummaries = useMemo(() => {
    const map = new Map<RunLogType, { runs: number; fans: number }>();
    RUN_LOG_TYPE_OPTIONS.forEach((option) => {
      map.set(option.value, { runs: 0, fans: 0 });
    });
    for (const entry of entries) {
      const summary = map.get(entry.type);
      if (!summary) continue;
      summary.runs += 1;
      summary.fans += entry.fans;
    }
    return RUN_LOG_TYPE_OPTIONS.map((option) => {
      const summary = map.get(option.value)!;
      return { type: option.value, label: option.label, runs: summary.runs, fans: summary.fans };
    }).filter((summary) => summary.runs > 0);
  }, [entries]);
  const runLogByDate = useMemo(() => {
    const map = new Map<string, { fans: number; runs: number }>();
    for (const entry of entries) {
      const summary = map.get(entry.date) ?? { fans: 0, runs: 0 };
      summary.fans += entry.fans;
      summary.runs += 1;
      map.set(entry.date, summary);
    }
    return map;
  }, [entries]);
  const recentDailyStats = useMemo(() => dailyStats.slice(-14), [dailyStats]);
  const fansDeltaByDate = useMemo(() => {
    const map = new Map<string, number | null>();
    for (const stat of dailyStats) {
      map.set(stat.date, stat.fansDelta ?? null);
    }
    return map;
  }, [dailyStats]);
  const dailyComparison = useMemo(() => {
    const dates = new Set<string>();
    for (const date of runLogByDate.keys()) dates.add(date);
    for (const stat of recentDailyStats) dates.add(stat.date);
    const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));
    return sortedDates.map((date) => {
      const summary = runLogByDate.get(date);
      const fansLogged = summary?.fans ?? 0;
      const runCount = summary?.runs ?? 0;
      const avgFans = runCount > 0 ? fansLogged / runCount : 0;
      const recorded = fansDeltaByDate.get(date) ?? null;
      return { date, fansLogged, runCount, avgFans, recorded };
    });
  }, [runLogByDate, fansDeltaByDate, recentDailyStats]);

  const resetForm = useCallback((options?: { resetDate?: boolean; resetType?: boolean }) => {
    setEditingId(null);
    setFormFans("");
    setFormNotes("");
    setFormError(null);
    if (options?.resetDate) setFormDate(getTodayISODate());
    if (options?.resetType) setFormType("training");
  }, []);

  const handleSave = useCallback(() => {
    const normalizedDate = normalizeISODate(formDate);
    if (!normalizedDate) {
      setFormError("Enter a valid date (YYYY-MM-DD).");
      return;
    }
    const fansValue = parseInteger(formFans);
    if (fansValue == null || fansValue < 0) {
      setFormError("Enter fans gained as a non-negative number.");
      return;
    }
    const notes = formNotes.trim().slice(0, 500);
    onSave({ id: editingId ?? undefined, date: normalizedDate, fans: fansValue, type: formType, notes });
    setFormDate(normalizedDate);
    resetForm();
  }, [formDate, formFans, formNotes, formType, editingId, onSave, resetForm]);

  const handleEdit = useCallback((entry: FansCaratsRunLogEntry) => {
    setEditingId(entry.id);
    setFormDate(entry.date);
    setFormType(entry.type);
    setFormFans(String(entry.fans));
    setFormNotes(entry.notes);
    setFormError(null);
  }, []);

  const handleCancel = useCallback(() => {
    resetForm({ resetDate: true, resetType: true });
  }, [resetForm]);

  const handleDeleteEntry = useCallback(
    (id: string) => {
      onDelete(id);
      if (editingId === id) {
        resetForm({ resetDate: true, resetType: true });
      }
    },
    [onDelete, editingId, resetForm],
  );

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div
        style={{
          background: COLOR.slate700,
          borderRadius: 12,
          padding: 12,
          border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
          display: "grid",
          gap: 10,
          boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>Run log insights</div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 12, color: COLOR.subtle }}>Runs logged</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{totalRuns.toLocaleString()}</div>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 12, color: COLOR.subtle }}>Fans recorded</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{formatNumber(totalFans)}</div>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 12, color: COLOR.subtle }}>Avg fans per run</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{formatNumber(Math.round(averageFans))}</div>
          </div>
          <div style={{ display: "grid", gap: 2 }}>
            <div style={{ fontSize: 12, color: COLOR.subtle }}>Fans last 7 days</div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>{formatNumber(last7Fans)}</div>
          </div>
        </div>
        {bestRun && (
          <div style={{ fontSize: 12, color: COLOR.subtle }}>
            Best run: {formatNumber(bestRun.fans)} fans ({RUN_LOG_TYPE_LABELS[bestRun.type]}) on {formatDateLabel(bestRun.date)}
          </div>
        )}
        {typeSummaries.length > 0 && (
          <div style={{ fontSize: 12, color: COLOR.subtle }}>
            Type breakdown: {typeSummaries
              .map((summary) =>
                `${summary.label}: ${summary.runs.toLocaleString()} run${summary.runs === 1 ? "" : "s"} / ${formatNumber(summary.fans)}`,
              )
              .join(" • ")}
          </div>
        )}
      </div>

      <div
        style={{
          background: COLOR.slate700,
          borderRadius: 12,
          padding: 12,
          border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
          boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>{editingId ? "Edit run entry" : "Log a run"}</div>
        <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <div>
            <Label>Date</Label>
            <Input type="date" value={formDate} onChange={setFormDate} />
          </div>
          <div>
            <Label>Run type</Label>
            <Select
              value={formType}
              onChange={(value) =>
                setFormType(RUN_LOG_TYPE_SET.has(value as RunLogType) ? (value as RunLogType) : "other")
              }
            >
              {RUN_LOG_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Fans gained</Label>
            <Input value={formFans} onChange={setFormFans} placeholder="Enter fans" />
          </div>
        </div>
        <div>
          <Label>Notes</Label>
          <TextArea value={formNotes} onChange={setFormNotes} placeholder="Training focus, event notes, etc." rows={3} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <SmallBtn onClick={handleSave}>{editingId ? "Update run" : "Log run"}</SmallBtn>
          {editingId && <SmallBtn onClick={handleCancel}>Cancel</SmallBtn>}
          {formError && <div style={{ color: COLOR.danger, fontSize: 12 }}>{formError}</div>}
        </div>
      </div>

      <div
        style={{
          background: COLOR.slate700,
          borderRadius: 12,
          padding: 12,
          border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
          boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>Daily comparison</div>
        {dailyComparison.length === 0 ? (
          <div style={{ fontSize: 13, color: COLOR.subtle }}>
            Log runs or daily totals to see how run gains align with recorded fans.
          </div>
        ) : (
          <>
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 12,
                }}
              >
                <thead>
                  <tr style={{ color: COLOR.subtle, textAlign: "left" }}>
                    <th style={{ padding: "6px 4px" }}>Date</th>
                    <th style={{ padding: "6px 4px" }}>Runs</th>
                    <th style={{ padding: "6px 4px" }}>Fans logged</th>
                    <th style={{ padding: "6px 4px" }}>Avg fans</th>
                    <th style={{ padding: "6px 4px" }}>Recorded Δ</th>
                    <th style={{ padding: "6px 4px" }}>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyComparison.map((row) => {
                    const diff = row.recorded == null ? null : row.recorded - row.fansLogged;
                    const diffColor = diff == null ? COLOR.text : diff <= 0 ? COLOR.good : COLOR.danger;
                    return (
                      <tr key={row.date} style={{ borderTop: `1px solid ${withAlpha(COLOR.border, 0.6)}` }}>
                        <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{formatDateLabel(row.date)}</td>
                        <td style={{ padding: "6px 4px" }}>{row.runCount.toLocaleString()}</td>
                        <td style={{ padding: "6px 4px" }}>{formatNumber(row.fansLogged)}</td>
                        <td style={{ padding: "6px 4px" }}>{formatNumber(Math.round(row.avgFans))}</td>
                        <td style={{ padding: "6px 4px" }}>{formatDelta(row.recorded)}</td>
                        <td style={{ padding: "6px 4px", color: diffColor }}>{formatDelta(diff)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 12, color: COLOR.subtle }}>
              Gap = recorded daily fans minus fans accounted for in your run log.
            </div>
          </>
        )}
      </div>

      <div
        style={{
          background: COLOR.slate700,
          borderRadius: 12,
          padding: 12,
          border: `1px solid ${withAlpha(COLOR.border, 0.7)}`,
          boxShadow: `0 8px 18px ${withAlpha("#000000", 0.3)}`,
          display: "grid",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>Run history</div>
        {entries.length === 0 ? (
          <div style={{ fontSize: 13, color: COLOR.subtle }}>Runs will appear here after you log them.</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
              }}
            >
              <thead>
                <tr style={{ color: COLOR.subtle, textAlign: "left" }}>
                  <th style={{ padding: "6px 4px" }}>Date</th>
                  <th style={{ padding: "6px 4px" }}>Type</th>
                  <th style={{ padding: "6px 4px" }}>Fans</th>
                  <th style={{ padding: "6px 4px" }}>Notes</th>
                  <th style={{ padding: "6px 4px" }}>Logged</th>
                  <th style={{ padding: "6px 4px" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const loggedLabel = new Date(entry.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  return (
                    <tr key={entry.id} style={{ borderTop: `1px solid ${withAlpha(COLOR.border, 0.6)}` }}>
                      <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{formatDateLabel(entry.date)}</td>
                      <td style={{ padding: "6px 4px" }}>{RUN_LOG_TYPE_LABELS[entry.type]}</td>
                      <td style={{ padding: "6px 4px" }}>{formatNumber(entry.fans)}</td>
                      <td style={{ padding: "6px 4px", whiteSpace: "pre-wrap", maxWidth: 320 }}>{entry.notes || "—"}</td>
                      <td style={{ padding: "6px 4px", whiteSpace: "nowrap" }}>{loggedLabel}</td>
                      <td style={{ padding: "6px 4px" }}>
                        <div style={{ display: "flex", gap: 6 }}>
                          <SmallBtn onClick={() => handleEdit(entry)}>Edit</SmallBtn>
                          <SmallBtn danger onClick={() => handleDeleteEntry(entry.id)}>
                            Delete
                          </SmallBtn>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

interface WastedInfo {
  ms: number;
  points: number;
}

function computeWastedAtCap(
  points: ResourceHistoryPoint[],
  currentValue: number,
  cap: number,
  rateMs: number,
  retentionMs: number,
  nowMs: number,
  resetStartMs?: number | null
): WastedInfo {
  if (!(cap > 0) || !(rateMs > 0)) return { ms: 0, points: 0 };
  const domainEnd = nowMs;
  if (!Number.isFinite(domainEnd)) return { ms: 0, points: 0 };
  let domainStart = domainEnd - retentionMs;
  if (Number.isFinite(resetStartMs)) {
    const resetClamped = Math.min(resetStartMs as number, domainEnd);
    domainStart = Math.max(domainStart, resetClamped);
  }
  if (domainStart > domainEnd) return { ms: 0, points: 0 };

  let effectiveDomainStart = domainStart;
  let earliestSample: number | null = null;
  for (const point of points) {
    const ts = Number(point?.ts);
    if (!Number.isFinite(ts) || ts < domainStart || ts > domainEnd) continue;
    if (earliestSample == null || ts < earliestSample) earliestSample = ts;
  }
  if (earliestSample == null) {
    effectiveDomainStart = domainEnd;
  } else if (earliestSample > effectiveDomainStart) {
    effectiveDomainStart = earliestSample;
  }

  const series = buildHistorySeries(points, currentValue, effectiveDomainStart, domainEnd);
  let wastedMs = 0;
  for (let i = 0; i < series.length - 1; i++) {
    const a = series[i];
    const b = series[i + 1];
    const segStart = Math.max(a.ts, effectiveDomainStart);
    const segEnd = Math.min(b.ts, domainEnd);
    if (segEnd <= segStart) continue;
    const startVal = Math.min(cap, Math.max(0, a.value));
    const endVal = Math.min(cap, Math.max(0, b.value));
    if (startVal >= cap) {
      wastedMs += segEnd - segStart;
      continue;
    }
    if (endVal >= cap && startVal < cap) {
      const totalDuration = b.ts - a.ts;
      const totalDelta = endVal - startVal;
      if (totalDuration <= 0 || totalDelta <= 0) continue;
      const slope = totalDelta / totalDuration;
      const timeToCap = (cap - startVal) / slope;
      const hitTs = a.ts + timeToCap;
      const capStart = Math.max(hitTs, segStart);
      if (segEnd > capStart) wastedMs += segEnd - capStart;
    }
  }
  const wastedPoints = wastedMs / rateMs;
  return { ms: wastedMs, points: wastedPoints };
}

interface SmallBtnProps {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

function SmallBtn({ onClick, children, danger, disabled }: SmallBtnProps) {
  const base = danger ? COLOR.danger : COLOR.slate700;
  const highlight = mixColor(base, "#ffffff", danger ? 0.35 : 0.25);
  const shadow = mixColor(base, "#000000", 0.3);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "5px 9px",
        fontSize: 12,
        borderRadius: 9,
        background: `linear-gradient(135deg, ${withAlpha(highlight, 0.95)} 0%, ${withAlpha(shadow, 0.95)} 100%)`,
        color: COLOR.text,
        border: `1px solid ${withAlpha(mixColor(base, "#000000", 0.2), 0.9)}`,
        boxShadow: `0 6px 16px ${withAlpha(base, 0.26)}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        filter: disabled ? "grayscale(0.15)" : undefined,
        transition: "transform 0.15s ease, box-shadow 0.15s ease",
      }}
    >
      {children}
    </button>
  );
}

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "6px 14px",
        fontSize: 12,
        borderRadius: 999,
        background: active
          ? `linear-gradient(135deg, ${withAlpha(COLOR.slate700, 0.92)} 0%, ${withAlpha(mixColor(COLOR.slate700, "#000000", 0.2), 0.95)} 100%)`
          : `linear-gradient(135deg, ${withAlpha(mixColor(COLOR.bg, "#ffffff", 0.05), 0.9)} 0%, ${withAlpha(mixColor(COLOR.bg, "#000000", 0.35), 0.95)} 100%)`,
        color: COLOR.text,
        border: `1px solid ${withAlpha(COLOR.border, active ? 0.9 : 0.7)}`,
        boxShadow: active ? `0 6px 16px ${withAlpha("#000000", 0.35)}` : `0 2px 8px ${withAlpha("#000000", 0.25)}`,
        cursor: "pointer",
        opacity: active ? 1 : 0.85,
        transition: "transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease",
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
        padding: "6px 10px",
        borderRadius: 10,
        background: `linear-gradient(135deg, ${withAlpha(mixColor(COLOR.bg, "#ffffff", 0.08), 0.9)} 0%, ${withAlpha(
          mixColor(COLOR.bg, "#000000", 0.4),
          0.95
        )} 100%)`,
        color: COLOR.text,
        border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
        width: "100%",
        boxShadow: `0 4px 14px ${withAlpha("#000000", 0.28)}`,
      }}
    />
  );
}

interface TextAreaProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
}

function TextArea({ value, onChange, placeholder, rows = 3 }: TextAreaProps) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      style={{
        padding: "6px 10px",
        borderRadius: 10,
        background: `linear-gradient(135deg, ${withAlpha(mixColor(COLOR.bg, "#ffffff", 0.08), 0.9)} 0%, ${withAlpha(
          mixColor(COLOR.bg, "#000000", 0.4),
          0.95,
        )} 100%)`,
        color: COLOR.text,
        border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
        width: "100%",
        boxShadow: `0 4px 14px ${withAlpha("#000000", 0.28)}`,
        resize: "vertical",
        minHeight: 60,
      }}
    />
  );
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}

function Select({ value, onChange, children }: SelectProps) {
  const optionBackground = mixColor(COLOR.card, "#000000", 0.35);
  const styledChildren = React.Children.map(children, (child) => {
    if (
      React.isValidElement<React.OptionHTMLAttributes<HTMLOptionElement>>(child) &&
      child.type === "option"
    ) {
      const existingStyle = child.props.style ?? {};
      return React.cloneElement(child, {
        style: {
          backgroundColor: optionBackground,
          color: COLOR.text,
          ...existingStyle,
        },
      });
    }
    return child;
  });

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 10px",
        borderRadius: 10,
        background: `linear-gradient(135deg, ${withAlpha(mixColor(COLOR.bg, "#ffffff", 0.08), 0.9)} 0%, ${withAlpha(
          mixColor(COLOR.bg, "#000000", 0.4),
          0.95
        )} 100%)`,
        backgroundColor: optionBackground,
        color: COLOR.text,
        border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
        boxShadow: `0 4px 14px ${withAlpha("#000000", 0.28)}`,
        minWidth: 150,
      }}
    >
      {styledChildren}
    </select>
  );
}

interface KeyCaptureProps {
  binding: string | null;
  capturing: boolean;
  onStartCapture: () => void;
  onStopCapture: () => void;
  onBindingChange: (binding: string | null) => void;
  disabled?: boolean;
}

function KeyCapture({ binding, capturing, onStartCapture, onStopCapture, onBindingChange, disabled }: KeyCaptureProps) {
  useEffect(() => {
    if (!capturing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        onStopCapture();
        return;
      }
      const next = bindingFromEvent(event);
      if (!next) return;
      onBindingChange(next);
      onStopCapture();
    };
    const cancel = () => {
      onStopCapture();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("mousedown", cancel, true);
    window.addEventListener("touchstart", cancel, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("mousedown", cancel, true);
      window.removeEventListener("touchstart", cancel, true);
    };
  }, [capturing, onBindingChange, onStopCapture]);

  const label = capturing ? "Press a key…" : formatBinding(binding);
  const idleBackground = `linear-gradient(135deg, ${withAlpha(mixColor(COLOR.bg, "#ffffff", 0.08), 0.9)} 0%, ${withAlpha(
    mixColor(COLOR.bg, "#000000", 0.4),
    0.95
  )} 100%)`;
  const activeBackground = `linear-gradient(135deg, ${withAlpha(mixColor(COLOR.tp, "#ffffff", 0.3), 0.92)} 0%, ${withAlpha(
    mixColor(COLOR.tp, "#000000", 0.25),
    0.92
  )} 100%)`;

  return (
    <button
      type="button"
      onClick={() => {
        if (disabled) return;
        if (capturing) onStopCapture();
        else onStartCapture();
      }}
      disabled={disabled}
      title="Click, then press a key. Press Esc to cancel."
      style={{
        padding: "6px 10px",
        borderRadius: 10,
        border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
        background: capturing ? activeBackground : idleBackground,
        color: COLOR.text,
        minWidth: 140,
        textAlign: "left",
        boxShadow: `0 4px 14px ${withAlpha("#000000", 0.28)}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: 12,
      }}
    >
      {label}
    </button>
  );
}

interface HotkeyToastState {
  id: number;
  message: string;
}

function HotkeyToast({ toast }: { toast: HotkeyToastState | null }) {
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        pointerEvents: "none",
        zIndex: 1000,
        maxWidth: 320,
      }}
    >
      {toast && (
        <div
          style={{
            background: withAlpha(COLOR.card, 0.95),
            border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
            borderRadius: 12,
            padding: "10px 14px",
            color: COLOR.text,
            boxShadow: `0 16px 32px ${withAlpha("#000000", 0.45)}`,
            fontSize: 13,
          }}
        >
          {toast.message}
        </div>
      )}
    </div>
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
  onSetAmount: (value: number) => void;
  history: ResourceHistorySnapshot;
  historyRetentionMs: number;
  wasted: WastedInfo;
}

function formatWastedPoints(points: number) {
  const safe = Math.max(0, points);
  if (safe >= 10) return Math.round(safe).toString();
  if (safe >= 1) return safe.toFixed(1);
  if (safe > 0) return safe.toFixed(2);
  return "0";
}

function ResourceCard({
  accent,
  name,
  cap,
  rateMs,
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
  onSetAmount,
  history,
  historyRetentionMs,
  wasted,
}: ResourceCardProps) {
  const [nextInput, setNextInput] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const timeToNext = current.nextPoint - now();
  const place = "mm:ss, 10m, 2h, or seconds";
  const zone = ensureTimeZone(timeZone);
  const historyWindowLabel = `${Math.round(historyRetentionMs / 3600000)}h`;
  const recentEvents = history.events.slice(-3).reverse();
  const sparklineHeight = hud ? 28 : 44;
  const wastedDurationLabel = formatDHMS(Math.round(Math.max(0, wasted.ms)));
  const wastedPointsLabel = formatWastedPoints(wasted.points);

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

      <div style={{ marginTop: 6 }}>
        <Sparkline
          points={history.points}
          color={accent}
          cap={cap}
          currentValue={current.value}
          retentionMs={historyRetentionMs}
          label={name}
          height={sparklineHeight}
        />
        <div style={{ fontSize: 11, color: COLOR.subtle, marginTop: 4 }}>
          History ({historyWindowLabel})
        </div>
        <div style={{ fontSize: 11, color: COLOR.subtle, marginTop: 2 }}>
          At cap {wastedDurationLabel} (≈ {wastedPointsLabel} {name} wasted)
        </div>
        {recentEvents.length > 0 && (
          <ul
            style={{
              marginTop: 4,
              padding: 0,
              listStyle: "none",
              display: "grid",
              gap: 2,
              fontSize: 12,
              color: COLOR.subtle,
            }}
          >
            {recentEvents.map((event) => (
              <li key={event.id}>{describeHistoryEvent(event, name, zone)}</li>
            ))}
          </ul>
        )}
      </div>

      {hud ? (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
          <SmallBtn onClick={onMinus}>-1</SmallBtn>
          <SmallBtn onClick={onPlus}>+1</SmallBtn>
          {onSpend30 && <SmallBtn onClick={() => onSpend30()}>Spend 30</SmallBtn>}
          {onUseOne && <SmallBtn onClick={() => onUseOne()}>Use 1</SmallBtn>}
          <SmallBtn onClick={onCopyOverlay}>Copy Overlay URL</SmallBtn>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
            <SmallBtn onClick={onMinus}>-1</SmallBtn>
            <SmallBtn onClick={onPlus}>+1</SmallBtn>
            {onSpend30 && (
              <SmallBtn onClick={() => onSpend30()}>Spend 30 {name}</SmallBtn>
            )}
            {onUseOne && <SmallBtn onClick={() => onUseOne()}>Use 1 {name}</SmallBtn>}
          </div>

          <div style={{ color: COLOR.subtle, fontSize: 13, marginTop: 6 }}>
            Next +1 in: {formatDHMS(timeToNext)} ({formatMMSS(timeToNext)})
          </div>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            Full at: {new Date(current.fullAt).toLocaleString(undefined, { timeZone: zone })} • Time to full:
            {" "}
            {formatDHMS(fullInfo.ms)} ({formatMMSS(fullInfo.ms)})
          </div>

          {milestones.length > 0 && (
            <div style={{ borderTop: `1px solid ${COLOR.border}`, marginTop: 8, paddingTop: 6 }}>
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

          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13 }}>Set time until next {name}:</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
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
          <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 13 }}>Set current {name} amount:</div>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <Input placeholder={`0–${cap}`} value={amountInput} onChange={setAmountInput} />
              <SmallBtn
                onClick={() => {
                  const n = parseInt(amountInput, 10);
                  if (!Number.isNaN(n)) onSetAmount(n);
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
  onAdd: (label: string, duration: string, color: string, includeInOverview: boolean) => void;
  defaultColor: string;
}

function AddTimerForm({ onAdd, defaultColor }: AddTimerFormProps) {
  const [label, setLabel] = useState("");
  const [dur, setDur] = useState("");
  const [color, setColor] = useState(defaultColor);
  const [includeOverview, setIncludeOverview] = useState(true);
  const place = "mm:ss, 10m, 2h, or seconds";

  useEffect(() => {
    setColor(defaultColor);
  }, [defaultColor]);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Input placeholder="Label (optional)" value={label} onChange={setLabel} />
      <Input placeholder={place} value={dur} onChange={setDur} />
      <label
        style={{
          width: 44,
          height: 36,
          borderRadius: 10,
          border: `1px solid ${COLOR.border}`,
          background: COLOR.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          position: "relative",
        }}
        title="Pick timer color"
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: color,
            border: `1px solid ${COLOR.border}`,
            boxShadow: "0 0 6px rgba(0,0,0,0.45)",
          }}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0,
            cursor: "pointer",
          }}
        />
      </label>
      <Checkbox
        checked={includeOverview}
        onChange={setIncludeOverview}
        label="Include in overview"
      />
      <SmallBtn
        onClick={() => {
          onAdd(label, dur, color, includeOverview);
          setLabel("");
          setDur("");
          setColor(defaultColor);
          setIncludeOverview(true);
        }}
      >
        Add
      </SmallBtn>
    </div>
  );
}

function formatDateTimeLocalInput(ts: number) {
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const offset = date.getTimezoneOffset();
  const local = new Date(ts - offset * 60000);
  return local.toISOString().slice(0, 16);
}

interface TimerImportExportControlsProps {
  groups: AbsTimerGroup[];
  timers: AbsTimer[];
  onImport: (bundle: TimerImportBundle) => TimerImportResult;
}

function TimerImportExportControls({ groups, timers, onImport }: TimerImportExportControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    try {
      if (typeof window === "undefined" || typeof document === "undefined") {
        setImportError("Export is only available in the browser.");
        setImportSuccess(null);
        return;
      }
      const payload = createTimerExportPayload(groups, timers);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `uma-custom-timers-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn("Failed to export timers", error);
      setImportError("Failed to export timers.");
      setImportSuccess(null);
    }
  }, [groups, timers]);

  const handleOpenFile = useCallback(() => {
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const sanitized = sanitizeTimerImportData(parsed);
        if (!sanitized) throw new Error("Invalid payload");
        const result = onImport(sanitized);
        if (result.addedTimers === 0 && result.addedGroups === 0 && result.updatedGroups === 0) {
          setImportSuccess("No new timers to import.");
        } else {
          const parts = [
            result.addedTimers > 0 ? `${result.addedTimers} timer${result.addedTimers === 1 ? "" : "s"}` : null,
            result.addedGroups > 0 ? `${result.addedGroups} new group${result.addedGroups === 1 ? "" : "s"}` : null,
            result.updatedGroups > 0
              ? `${result.updatedGroups} group${result.updatedGroups === 1 ? "" : "s"} updated`
              : null,
          ].filter(Boolean);
          setImportSuccess(parts.join(", "));
        }
        setImportError(null);
      } catch (error) {
        console.warn("Failed to import timers", error);
        setImportError("Failed to import timers. Please check the file format.");
        setImportSuccess(null);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onImport]
  );

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <SmallBtn onClick={handleExport} disabled={timers.length === 0}>Export timers</SmallBtn>
      <SmallBtn onClick={handleOpenFile}>Import timers</SmallBtn>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      {importError && <span style={{ color: COLOR.danger, fontSize: 12 }}>{importError}</span>}
      {importSuccess && !importError && (
        <span style={{ color: COLOR.good, fontSize: 12 }}>{importSuccess}</span>
      )}
    </div>
  );
}

interface AddAbsTimerFormProps {
  onAdd: (groupId: string, label: string, dateTime: string, includeInOverview: boolean) => void;
  groups: AbsTimerGroup[];
  defaultGroupId: string;
}

function AddAbsTimerForm({ onAdd, groups, defaultGroupId }: AddAbsTimerFormProps) {
  const [label, setLabel] = useState("");
  const [dt, setDt] = useState("");
  const [groupId, setGroupId] = useState(defaultGroupId);
  const [includeInOverview, setIncludeInOverview] = useState(false);

  useEffect(() => {
    setGroupId((prev) => {
      if (groups.some((g) => g.id === prev)) return prev;
      return defaultGroupId;
    });
  }, [groups, defaultGroupId]);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Input placeholder="Label (e.g., Banner Release)" value={label} onChange={setLabel} />
      <Input type="datetime-local" value={dt} onChange={setDt} />
      <Select value={groupId} onChange={setGroupId}>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      <Checkbox
        checked={includeInOverview}
        onChange={setIncludeInOverview}
        label="Include in overview"
      />
      <SmallBtn
        onClick={() => {
          onAdd(groupId, label, dt, includeInOverview);
          setLabel("");
          setDt("");
          setGroupId(defaultGroupId);
          setIncludeInOverview(false);
        }}
      >
        Add timer
      </SmallBtn>
    </div>
  );
}

interface AddGroupFormProps {
  onAdd: (name: string, color: string) => void;
  defaultColor: string;
}

function AddGroupForm({ onAdd, defaultColor }: AddGroupFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor);

  useEffect(() => {
    setColor(defaultColor);
  }, [defaultColor]);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Input placeholder="Group name" value={name} onChange={setName} />
      <label
        style={{
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
          boxShadow: `0 0 12px ${withAlpha(color, 0.6)}`,
          position: "relative",
          cursor: "pointer",
          background: color,
        }}
        title="Pick group color"
      >
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
        />
      </label>
      <SmallBtn
        onClick={() => {
          onAdd(name, color);
          setName("");
          setColor(defaultColor);
        }}
      >
        Add group
      </SmallBtn>
    </div>
  );
}

interface AbsTimerItemProps {
  timer: AbsTimer;
  groups: AbsTimerGroup[];
  accent: string;
  onUpdate: (id: string, updates: { label?: string; ts?: number; groupId?: string }) => void;
  onStatusChange: (id: string, status: AbsTimerStatus) => void;
  onDelete: (id: string) => void;
  onCopyOverlay: () => void;
  onToggleOverview: (id: string, include: boolean) => void;
  timeZone: string;
}

function AbsTimerItem({
  timer,
  groups,
  accent,
  onUpdate,
  onStatusChange,
  onDelete,
  onCopyOverlay,
  onToggleOverview,
  timeZone,
}: AbsTimerItemProps) {
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(timer.label || "");
  const [dtDraft, setDtDraft] = useState(formatDateTimeLocalInput(timer.ts));
  const [groupDraft, setGroupDraft] = useState(timer.groupId);

  useEffect(() => {
    setLabelDraft(timer.label || "");
    setDtDraft(formatDateTimeLocalInput(timer.ts));
    setGroupDraft(timer.groupId);
  }, [timer]);

  useEffect(() => {
    setGroupDraft((prev) => {
      if (groups.some((g) => g.id === prev)) return prev;
      return groups[0]?.id || timer.groupId;
    });
  }, [groups, timer.groupId]);

  const save = () => {
    if (!dtDraft) return;
    const ts = new Date(dtDraft).getTime();
    if (!Number.isFinite(ts)) return;
    const trimmed = labelDraft.trim();
    const targetGroup = groups.some((g) => g.id === groupDraft)
      ? groupDraft
      : groups[0]?.id || timer.groupId;
    onUpdate(timer.id, { label: trimmed, ts, groupId: targetGroup });
    setEditing(false);
  };

  const cancel = () => {
    setLabelDraft(timer.label || "");
    setDtDraft(formatDateTimeLocalInput(timer.ts));
    setGroupDraft(timer.groupId);
    setEditing(false);
  };

  const nowMs = now();
  const remaining = timer.ts - nowMs;
  const timeLine =
    remaining > 0
      ? `Time left: ${formatDHMS(remaining)} (${formatMMSS(remaining)})`
      : `Ended ${formatDHMS(-remaining)} ago`;
  const countdownProgress = absTimerCountdownProgress(timer.status, remaining);
  const countdownTrack = withAlpha(mixColor(accent, COLOR.bg, 0.65), 0.5);
  const countdownFill = mixColor(accent, "#ffffff", 0.15);
  let statusText = "Active";
  let statusColor = mixColor(accent, "#ffffff", 0.2);
  if (timer.status === "completed") {
    statusText = "Completed";
    statusColor = COLOR.good;
  } else if (timer.status === "expired") {
    statusText = "Expired";
    statusColor = COLOR.danger;
  } else if (remaining <= 0) {
    statusText = "Ended";
    statusColor = COLOR.danger;
  }

  const includeInOverview = timer.includeInOverview === true;

  return (
    <div style={cardRowStyle(accent)}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {editing ? (
          <div style={{ display: "grid", gap: 8 }}>
            <Input placeholder="Label" value={labelDraft} onChange={setLabelDraft} />
            <Input type="datetime-local" value={dtDraft} onChange={setDtDraft} />
            <Select value={groupDraft} onChange={setGroupDraft}>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </Select>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontWeight: 600, wordBreak: "break-word" }}>{timer.label || "Timer"}</div>
            <div style={{ fontSize: 13, color: COLOR.subtle }}>
              At: {new Date(timer.ts).toLocaleString(undefined, { timeZone })}
            </div>
            <div style={{ fontSize: 14 }}>{timeLine}</div>
            <div style={{ fontSize: 13, color: statusColor }}>Status: {statusText}</div>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 11, color: COLOR.subtle }}>30-day countdown</div>
              <div
                style={{
                  height: 6,
                  background: countdownTrack,
                  borderRadius: 999,
                  overflow: "hidden",
                  boxShadow: `inset 0 0 4px ${withAlpha("#000000", 0.35)}`,
                }}
              >
                <div
                  style={{
                    width: `${countdownProgress * 100}%`,
                    background: countdownFill,
                    height: "100%",
                    transition: "width 0.3s ease",
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {editing ? (
          <>
            <SmallBtn onClick={save}>Save</SmallBtn>
            <SmallBtn onClick={cancel}>Cancel</SmallBtn>
            <SmallBtn danger onClick={() => onDelete(timer.id)}>
              Delete
            </SmallBtn>
          </>
        ) : (
          <>
            <SmallBtn onClick={() => setEditing(true)}>Edit</SmallBtn>
            {timer.status !== "completed" && (
              <SmallBtn onClick={() => onStatusChange(timer.id, "completed")}>Mark Completed</SmallBtn>
            )}
            {timer.status !== "expired" && (
              <SmallBtn onClick={() => onStatusChange(timer.id, "expired")}>Mark Expired</SmallBtn>
            )}
            {timer.status !== "active" && (
              <SmallBtn onClick={() => onStatusChange(timer.id, "active")}>Mark Active</SmallBtn>
            )}
            <SmallBtn onClick={onCopyOverlay}>Copy Overlay URL</SmallBtn>
            <SmallBtn danger onClick={() => onDelete(timer.id)}>
              Delete
            </SmallBtn>
          </>
        )}
        <Checkbox
          checked={includeInOverview}
          onChange={(v) => onToggleOverview(timer.id, v)}
          label="Include in overview"
        />
      </div>
    </div>
  );
}

interface AbsTimerGroupSectionProps {
  group: AbsTimerGroup;
  timers: AbsTimer[];
  groups: AbsTimerGroup[];
  onUpdateGroup: (id: string, updates: Partial<AbsTimerGroup>) => void;
  onUpdateTimer: (id: string, updates: { label?: string; ts?: number; groupId?: string }) => void;
  onStatusChange: (id: string, status: AbsTimerStatus) => void;
  onDeleteTimer: (id: string) => void;
  onCopyOverlay: (id: string) => void;
  onToggleOverview: (id: string, include: boolean) => void;
  timeZone: string;
}

function AbsTimerGroupSection({
  group,
  timers,
  groups,
  onUpdateGroup,
  onUpdateTimer,
  onStatusChange,
  onDeleteTimer,
  onCopyOverlay,
  onToggleOverview,
  timeZone,
}: AbsTimerGroupSectionProps) {
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(group.name);
  const [colorDraft, setColorDraft] = useState(group.color);

  useEffect(() => {
    setNameDraft(group.name);
    setColorDraft(group.color);
  }, [group.name, group.color]);

  const saveGroup = () => {
    onUpdateGroup(group.id, { name: nameDraft, color: colorDraft });
    setEditing(false);
  };

  const cancelGroup = () => {
    setNameDraft(group.name);
    setColorDraft(group.color);
    setEditing(false);
  };

  const sortedTimers = [...timers].sort((a, b) => a.ts - b.ts);

  return (
    <div
      style={{
        background: COLOR.card,
        border: `1px solid ${COLOR.border}`,
        borderRadius: 14,
        padding: 14,
        boxShadow: "0 4px 18px rgba(0,0,0,.22)",
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              background: group.color,
              boxShadow: `0 0 10px ${withAlpha(group.color, 0.7)}`,
              border: `1px solid ${withAlpha(mixColor(group.color, "#000000", 0.3), 0.9)}`,
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: 15, fontWeight: 600 }}>{group.name}</div>
        </div>
        {editing ? (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <Input value={nameDraft} onChange={setNameDraft} placeholder="Group name" />
            <label
              style={{
                width: 32,
                height: 32,
                borderRadius: "50%",
                border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
                boxShadow: `0 0 10px ${withAlpha(colorDraft, 0.6)}`,
                position: "relative",
                cursor: "pointer",
                background: colorDraft,
              }}
              title="Pick group color"
            >
              <input
                type="color"
                value={colorDraft}
                onChange={(e) => setColorDraft(e.target.value)}
                style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
              />
            </label>
            <SmallBtn onClick={saveGroup}>Save</SmallBtn>
            <SmallBtn onClick={cancelGroup}>Cancel</SmallBtn>
          </div>
        ) : (
          <SmallBtn onClick={() => setEditing(true)}>Edit group</SmallBtn>
        )}
      </div>
      {sortedTimers.length === 0 ? (
        <p style={{ color: COLOR.subtle, fontSize: 13, margin: 0 }}>No timers in this group yet.</p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {sortedTimers.map((timer) => (
            <AbsTimerItem
              key={timer.id}
              timer={timer}
              groups={groups}
              accent={group.color}
              onUpdate={onUpdateTimer}
              onStatusChange={onStatusChange}
              onDelete={onDeleteTimer}
              onCopyOverlay={() => onCopyOverlay(timer.id)}
              onToggleOverview={onToggleOverview}
              timeZone={timeZone}
            />
          ))}
        </div>
      )}
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
  color?: string;
  durationMs?: number;
  remainingMs?: number;
  includeInOverview?: boolean;
}

interface TimerDisplayData extends TimerData {
  remainingMs: number;
  totalMs: number;
  progress: number;
  colorResolved: string;
  includeInOverview: boolean;
}

function computeTimerRemainingMs(t: TimerData, nowMs: number) {
  if (t.isPaused) {
    if (Number.isFinite(t.pausedRemaining)) return Math.max(0, (t.pausedRemaining as number) || 0);
    if (Number.isFinite(t.targetTs)) return Math.max(0, (t.targetTs as number) - nowMs);
    return 0;
  }
  if (Number.isFinite(t.targetTs)) return Math.max(0, (t.targetTs as number) - nowMs);
  return 0;
}

function computeTimerTotalMs(t: TimerData, remaining: number, nowMs: number) {
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

function resolveTimerColor(t: TimerData, index: number) {
  return sanitizeTimerColor(t.color, index);
}

interface TimerRowProps {
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

function TimerRow({
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
              onChange={(e) => onColorChange(e.target.value)}
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

interface TimerOverviewListProps {
  timers: TimerDisplayData[];
  absTimers: AbsTimerDisplay[];
  timeZone: string;
}

function TimerOverviewList({ timers, absTimers, timeZone }: TimerOverviewListProps) {
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
                rem > 0
                  ? `Time left: ${formatDHMS(rem)} (${formatMMSS(rem)})`
                  : `Ended ${formatDHMS(-rem)} ago`;
              const countdownProgress = absTimerCountdownProgress(a.status, rem);
              const countdownTrack = withAlpha(mixColor(accent, COLOR.bg, 0.65), 0.5);
              const countdownFill = mixColor(accent, "#ffffff", 0.15);
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
              const timelineColor = mixColor(accent, "#ffffff", 0.2);
              return (
                <div key={a.id} style={cardRowStyle(accent)}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ fontWeight: 600 }}>{a.label || "Timer"}</div>
                    <div style={{ fontSize: 12, color: COLOR.subtle }}>{a.group.name}</div>
                    <div style={{ fontSize: 13, color: COLOR.subtle }}>
                      <span>At: {new Date(a.ts).toLocaleString(undefined, { timeZone: zone })}</span>
                    </div>
                    <div style={{ fontSize: 12, color: timelineColor }}>{timeLine}</div>
                    <div style={{ fontSize: 12, color: statusColor }}>Status: {statusText}</div>
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={{ fontSize: 11, color: COLOR.subtle }}>30-day countdown</div>
                      <div
                        style={{
                          height: 6,
                          background: countdownTrack,
                          borderRadius: 999,
                          overflow: "hidden",
                          boxShadow: `inset 0 0 4px ${withAlpha("#000000", 0.35)}`,
                        }}
                      >
                        <div
                          style={{
                            width: `${countdownProgress * 100}%`,
                            background: countdownFill,
                            height: "100%",
                            transition: "width 0.3s ease",
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function cardRowStyle(accent?: string): React.CSSProperties {
  const base = accent ?? COLOR.slate700;
  const gradStart = withAlpha(mixColor(base, COLOR.bg, 0.4), 0.97);
  const gradEnd = withAlpha(mixColor(base, "#000000", 0.55), 0.97);
  const borderColor = withAlpha(mixColor(base, "#000000", 0.55), 0.9);
  const leftBorder = accent ? mixColor(base, "#ffffff", 0.15) : undefined;
  const shadow = withAlpha(mixColor(base, "#000000", 0.5), 0.45);
  return {
    background: `linear-gradient(140deg, ${gradStart} 0%, ${gradEnd} 100%)`,
    border: `1px solid ${borderColor}`,
    borderRadius: 14,
    color: COLOR.text,
    padding: 10,
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "start",
    gap: 10,
    borderLeft: accent ? `3px solid ${leftBorder}` : undefined,
    paddingLeft: accent ? 14 : 10,
    boxShadow: `0 10px 24px ${shadow}`,
    height: "100%",
  };
}

interface AbsTimer {
  id: string;
  label?: string;
  ts: number;
  groupId: string;
  status?: AbsTimerStatus;
  includeInOverview?: boolean;
}

interface AbsTimerDisplay extends AbsTimer {
  group: AbsTimerGroup;
  status: AbsTimerStatus;
  includeInOverview: boolean;
}

interface TimerExportPayload {
  version: number;
  generatedAt: string;
  groups: AbsTimerGroup[];
  timers: {
    id: string;
    label?: string;
    ts: number;
    status: AbsTimerStatus;
    groupId: string;
    groupName: string;
    includeInOverview: boolean;
  }[];
}

interface TimerImportGroupData {
  id?: string;
  name: string;
  color: string;
}

interface TimerImportTimerData {
  id?: string;
  label?: string;
  ts: number;
  groupId?: string;
  groupName?: string;
  status: AbsTimerStatus;
  includeInOverview?: boolean;
}

interface TimerImportBundle {
  groups: TimerImportGroupData[];
  timers: TimerImportTimerData[];
}

interface TimerImportResult {
  addedGroups: number;
  updatedGroups: number;
  addedTimers: number;
}

function createTimerExportPayload(groups: AbsTimerGroup[], timers: AbsTimer[]): TimerExportPayload {
  const groupMap = new Map(groups.map((g, index) => [g.id, { ...g, color: sanitizeTimerColor(g.color, index) }]));
  const exportedGroups = groups.map((g, index) => ({
    id: g.id,
    name: g.name,
    color: sanitizeTimerColor(g.color, index),
  }));
  const exportedTimers = timers.map((t) => {
    const group = groupMap.get(t.groupId);
    const status: AbsTimerStatus =
      t.status === "completed" || t.status === "expired" ? t.status : "active";
    return {
      id: t.id,
      label: t.label,
      ts: t.ts,
      status,
      groupId: group?.id ?? t.groupId,
      groupName: group?.name ?? "",
      includeInOverview: t.includeInOverview === true,
    };
  });
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    groups: exportedGroups,
    timers: exportedTimers,
  };
}

function sanitizeTimerImportData(value: unknown): TimerImportBundle | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const groupInput = Array.isArray(raw.groups) ? raw.groups : [];
  const timerInput = Array.isArray(raw.timers) ? raw.timers : [];
  const groups: TimerImportGroupData[] = [];
  groupInput.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const g = entry as Record<string, unknown>;
    const idRaw = typeof g.id === "string" ? g.id.trim() : undefined;
    const nameRaw = typeof g.name === "string" ? g.name.trim() : "";
    const colorRaw = typeof g.color === "string" ? g.color.trim() : undefined;
    const name = nameRaw || `Group ${index + 1}`;
    const color = sanitizeTimerColor(colorRaw, index);
    groups.push({ id: idRaw && idRaw.length ? idRaw : undefined, name, color });
  });
  const timers: TimerImportTimerData[] = [];
  const validStatus = new Set<AbsTimerStatus>(["active", "completed", "expired"]);
  timerInput.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const t = entry as Record<string, unknown>;
    const ts = Number(t.ts);
    if (!Number.isFinite(ts)) return;
    const label = typeof t.label === "string" ? t.label.trim() : undefined;
    const groupId = typeof t.groupId === "string" ? t.groupId.trim() : undefined;
    const groupName = typeof t.groupName === "string" ? t.groupName.trim() : undefined;
    const statusRaw = typeof t.status === "string" ? t.status.trim().toLowerCase() : "active";
    const status = validStatus.has(statusRaw as AbsTimerStatus)
      ? (statusRaw as AbsTimerStatus)
      : "active";
    const includeRaw = (t as Record<string, unknown>).includeInOverview;
    let includeInOverview = false;
    if (typeof includeRaw === "boolean") includeInOverview = includeRaw;
    else if (typeof includeRaw === "string")
      includeInOverview = includeRaw.trim().toLowerCase() === "true";
    timers.push({
      id: typeof t.id === "string" ? t.id.trim() || undefined : undefined,
      label,
      ts,
      groupId: groupId && groupId.length ? groupId : undefined,
      groupName: groupName && groupName.length ? groupName : undefined,
      status,
      includeInOverview,
    });
  });
  if (!groups.length && !timers.length) return null;
  return { groups, timers };
}

function mergeImportedGroups(
  existing: AbsTimerGroup[],
  imported: TimerImportGroupData[]
): {
  nextGroups: AbsTimerGroup[];
  idMap: Map<string, string>;
  nameMap: Map<string, string>;
  added: number;
  updated: number;
} {
  if (!imported.length) {
    const nameMap = new Map(existing.map((g) => [normalizeGroupName(g.name), g.id]));
    return { nextGroups: existing, idMap: new Map(), nameMap, added: 0, updated: 0 };
  }
  const next = existing.map((g) => ({ ...g }));
  const idIndex = new Map<string, number>();
  const nameIndex = new Map<string, number>();
  next.forEach((group, idx) => {
    idIndex.set(group.id, idx);
    nameIndex.set(normalizeGroupName(group.name), idx);
  });
  const idMap = new Map<string, string>();
  let added = 0;
  let updated = 0;
  imported.forEach((group) => {
    const trimmedName = group.name.trim() || `Group ${next.length + added + 1}`;
    const normalizedName = normalizeGroupName(trimmedName);
    const rawId = group.id?.trim();
    let targetIdx: number | undefined;
    if (rawId && idIndex.has(rawId)) {
      targetIdx = idIndex.get(rawId);
    } else if (normalizedName && nameIndex.has(normalizedName)) {
      targetIdx = nameIndex.get(normalizedName);
    }
    if (targetIdx != null) {
      const current = next[targetIdx];
      const sanitizedColor = sanitizeTimerColor(group.color, targetIdx);
      const sanitizedName = trimmedName;
      if (current.name !== sanitizedName || current.color !== sanitizedColor) {
        next[targetIdx] = { ...current, name: sanitizedName, color: sanitizedColor };
        updated += 1;
      }
      if (rawId) idMap.set(rawId, next[targetIdx].id);
      if (normalizedName) nameIndex.set(normalizedName, targetIdx);
      return;
    }
    const sanitizedColor = sanitizeTimerColor(group.color, next.length);
    const newId = rawId && !idIndex.has(rawId) ? rawId : crypto.randomUUID();
    const finalName = trimmedName || `Group ${next.length + 1}`;
    const newGroup: AbsTimerGroup = { id: newId, name: finalName, color: sanitizedColor };
    next.push(newGroup);
    idIndex.set(newId, next.length - 1);
    if (normalizedName) nameIndex.set(normalizedName, next.length - 1);
    if (rawId) idMap.set(rawId, newId);
    added += 1;
  });
  const nameMap = new Map<string, string>();
  next.forEach((group) => nameMap.set(normalizeGroupName(group.name), group.id));
  return {
    nextGroups: added === 0 && updated === 0 ? existing : next,
    idMap,
    nameMap,
    added,
    updated,
  };
}

function prepareImportedTimers(
  imported: TimerImportTimerData[],
  groups: AbsTimerGroup[],
  idMap: Map<string, string>,
  nameMap: Map<string, string>
): AbsTimer[] {
  if (!imported.length) return [];
  const groupIdSet = new Set(groups.map((g) => g.id));
  const fallbackId = findFallbackGroupId(groups);
  const normalizedNameMap = new Map(groups.map((g) => [normalizeGroupName(g.name), g.id]));
  const result: AbsTimer[] = [];
  imported.forEach((timer) => {
    let targetGroupId: string | undefined;
    if (timer.groupId) {
      const mapped = idMap.get(timer.groupId) ?? timer.groupId;
      if (groupIdSet.has(mapped)) targetGroupId = mapped;
    }
    if (!targetGroupId && timer.groupName) {
      const normalized = normalizeGroupName(timer.groupName);
      const mapped = nameMap.get(normalized) ?? normalizedNameMap.get(normalized);
      if (mapped && groupIdSet.has(mapped)) targetGroupId = mapped;
    }
    if (!targetGroupId) targetGroupId = fallbackId;
    const label = timer.label?.trim() || "";
    const status: AbsTimerStatus =
      timer.status === "completed" || timer.status === "expired" ? timer.status : "active";
    result.push({
      id: crypto.randomUUID(),
      label,
      ts: timer.ts,
      groupId: targetGroupId,
      status,
      includeInOverview: timer.includeInOverview === true,
    });
  });
  return result;
}

function timerDedupKey(timer: AbsTimer) {
  return `${timer.groupId}|${timer.label ?? ""}|${timer.ts}`;
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
  tpHistory: ResourceHistorySnapshot;
  rpHistory: ResourceHistorySnapshot;
  historyRetentionMs: number;
}

function OverlayView({
  overlay,
  curTP,
  curRP,
  tpFull,
  rpFull,
  nextReset,
  timers,
  absTimers,
  timeZone,
  tpHistory,
  rpHistory,
  historyRetentionMs,
}: OverlayViewProps) {
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
        <div style={{ marginTop: 8 }}>
          <Sparkline
            points={tpHistory.points}
            color={COLOR.tp}
            cap={TP_CAP}
            currentValue={curTP.value}
            retentionMs={historyRetentionMs}
            label="TP"
            height={32}
          />
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
        <div style={{ marginTop: 8 }}>
          <Sparkline
            points={rpHistory.points}
            color={COLOR.rp}
            cap={RP_CAP}
            currentValue={curRP.value}
            retentionMs={historyRetentionMs}
            label="RP"
            height={32}
          />
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
  dailyReset?: {
    atReset?: boolean;
    hourBefore?: boolean;
  };
}

interface FiredState {
  tp: Record<string, boolean>;
  rp: Record<string, boolean>;
  timers: Record<string, boolean>;
  resets?: Record<string, boolean>;
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

function maybeFireReset(
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
  const [historyRaw, setHistoryState] = useLocalStorage<ResourceHistoryState>(
    "uma.history",
    createEmptyHistoryState()
  );
  const [fansCaratsRaw, setFansCaratsState] = useLocalStorage<FansCaratsState>("uma.fansCarats", {
    entries: [],
    runLog: [],
  });
  const [fansCaratsConfigRaw, setFansCaratsConfig] = useLocalStorage<FansCaratsConfig>(
    "uma.fansCarats.config",
    { weeklyFansTarget: DEFAULT_WEEKLY_FANS_TARGET }
  );
  const [wastedResetRaw, setWastedResetState] = useLocalStorage<WastedResetState>("uma.wastedReset", {
    tp: null,
    rp: null,
  });
  const [notif, setNotif] = useLocalStorage<NotificationState>("uma.notif", {
    enabled: false,
    tpMilestones: { "30": true, "60": true, "90": true, full: true },
    rpMilestones: { full: true },
    timers: true,
    dailyReset: { atReset: true, hourBefore: true },
  });
  const [timers, setTimers] = useLocalStorage<TimerData[]>("uma.customTimers", []);
  const [absGroups, setAbsGroups] = useLocalStorage<AbsTimerGroup[]>(
    "uma.absTimerGroups",
    DEFAULT_ABS_TIMER_GROUPS
  );
  const [absTimers, setAbsTimers] = useLocalStorage<AbsTimer[]>("uma.absTimers", []);
  const [fired, setFired] = useLocalStorage<FiredState>("uma.fired", {
    tp: {},
    rp: {},
    timers: {},
    resets: {},
  });
  const [timezone, setTimezone] = useLocalStorage<string>("uma.timezone", DEFAULT_TZ);
  const [hotkeys, setHotkeys] = useLocalStorage<HotkeySettings>("uma.hotkeys", DEFAULT_HOTKEY_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tzDraft, setTzDraft] = useState(timezone);
  const [tzError, setTzError] = useState<string | null>(null);
  const [hotkeyToast, setHotkeyToast] = useState<HotkeyToastState | null>(null);
  const [activeHotkeyCapture, setActiveHotkeyCapture] = useState<HotkeyActionId | null>(null);
  const handleHotkeyActionRef = useRef<(id: HotkeyActionId) => boolean>(() => false);
  const lastHistorySampleRef = useRef<{ tp: number; rp: number }>({ tp: 0, rp: 0 });
  const lastResetTsRef = useRef<number | null>(null);

  const activeTimeZone = ensureTimeZone(timezone);
  const overlayApi = typeof window !== "undefined" ? window.umaOverlay : undefined;
  const overlayChannelRef = useRef<BroadcastChannel | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(OVERLAY_SNAPSHOT_CHANNEL);
    overlayChannelRef.current = channel;
    return () => {
      overlayChannelRef.current = null;
      channel.close();
    };
  }, []);

  useEffect(() => {
    setHotkeys((prev) => {
      const sanitized = sanitizeHotkeySettings(prev);
      return hotkeySettingsEqual(prev, sanitized) ? prev : sanitized;
    });
  }, [setHotkeys]);

  useEffect(() => {
    if (!hotkeys.enabled && activeHotkeyCapture != null) setActiveHotkeyCapture(null);
  }, [hotkeys.enabled, activeHotkeyCapture]);

  useEffect(() => {
    if (settingsOpen) return;
    if (activeHotkeyCapture != null) setActiveHotkeyCapture(null);
  }, [settingsOpen, activeHotkeyCapture]);

  useEffect(() => {
    if (!isValidTimeZone(timezone)) setTimezone(DEFAULT_TZ);
  }, [timezone, setTimezone]);

  useEffect(() => {
    if (!settingsOpen) setTzDraft(timezone);
  }, [timezone, settingsOpen]);

  useEffect(() => {
    if (!hotkeyToast) return;
    if (typeof window === "undefined") return;
    const id = window.setTimeout(() => setHotkeyToast(null), 2400);
    return () => window.clearTimeout(id);
  }, [hotkeyToast]);

  useEffect(() => {
    setAbsGroups((prev) => {
      const base = prev.length ? prev : DEFAULT_ABS_TIMER_GROUPS;
      let changed = prev.length !== base.length;
      const sanitized = base.map((g, index) => {
        const id = typeof g.id === "string" && g.id ? g.id : crypto.randomUUID();
        const name = g.name?.trim() || DEFAULT_ABS_TIMER_GROUPS[index]?.name || `Group ${index + 1}`;
        const color = sanitizeTimerColor(g.color, index);
        if (id !== g.id || name !== g.name || color !== g.color) changed = true;
        return { id, name, color };
      });
      if (!sanitized.length) return DEFAULT_ABS_TIMER_GROUPS;
      return changed ? sanitized : prev;
    });
  }, [setAbsGroups]);

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
  const history = useMemo(() => sanitizeHistoryState(historyRaw), [historyRaw]);
  const wastedReset = useMemo(() => sanitizeWastedResetState(wastedResetRaw), [wastedResetRaw]);
  const fansCaratsStateSanitized = useMemo(() => sanitizeFansCaratsState(fansCaratsRaw), [fansCaratsRaw]);
  const fansCaratsConfig = useMemo(() => sanitizeFansCaratsConfig(fansCaratsConfigRaw), [fansCaratsConfigRaw]);
  const fansCaratsEntries = fansCaratsStateSanitized.entries;
  const fansCaratsRunLog = fansCaratsStateSanitized.runLog;
  const fansCaratsDailyStats = useMemo(
    () => buildFansCaratsDailyStats(fansCaratsEntries),
    [fansCaratsEntries]
  );
  const fansCaratsRolling7 = useMemo(
    () => buildRollingTotals(fansCaratsDailyStats, 7),
    [fansCaratsDailyStats]
  );
  const fansCaratsWeeklySummaries = useMemo(
    () => buildWeeklySummaries(fansCaratsDailyStats),
    [fansCaratsDailyStats]
  );
  const fansTrend = useMemo(
    () => buildTrendSeries(fansCaratsDailyStats, "fansDelta", 30),
    [fansCaratsDailyStats]
  );
  const caratsTrend = useMemo(
    () => buildTrendSeries(fansCaratsDailyStats, "caratsDelta", 30),
    [fansCaratsDailyStats]
  );

  const upsertFansCaratsEntry = useCallback(
    (entry: FansCaratsEntry) => {
      setFansCaratsState((prev) => {
        const base = sanitizeFansCaratsState(prev);
        const nextEntries = base.entries.filter((e) => e.date !== entry.date);
        nextEntries.push({ date: entry.date, fans: entry.fans, carats: entry.carats });
        nextEntries.sort((a, b) => a.date.localeCompare(b.date));
        const unchanged =
          base.entries.length === nextEntries.length &&
          base.entries.every(
            (existing, index) =>
              existing.date === nextEntries[index].date &&
              existing.fans === nextEntries[index].fans &&
              existing.carats === nextEntries[index].carats
          );
        if (unchanged) return prev;
        return { entries: nextEntries, runLog: base.runLog };
      });
    },
    [setFansCaratsState]
  );

  const deleteFansCaratsEntry = useCallback(
    (date: string) => {
      setFansCaratsState((prev) => {
        const base = sanitizeFansCaratsState(prev);
        const nextEntries = base.entries.filter((entry) => entry.date !== date);
        if (nextEntries.length === base.entries.length) return prev;
        return { entries: nextEntries, runLog: base.runLog };
      });
    },
    [setFansCaratsState]
  );

  const saveRunLogEntry = useCallback(
    (entry: RunLogEntryInput) => {
      setFansCaratsState((prev) => {
        const base = sanitizeFansCaratsState(prev);
        const normalizedDate = normalizeISODate(entry.date);
        if (!normalizedDate) return prev;
        const fansRaw = Number(entry.fans);
        const fansValue = Number.isFinite(fansRaw) ? Math.max(0, Math.round(fansRaw)) : 0;
        const type = RUN_LOG_TYPE_SET.has(entry.type) ? entry.type : "other";
        const notes = (entry.notes ?? "").toString().trim().slice(0, 500);
        const existing = entry.id ? base.runLog.find((run) => run.id === entry.id) : undefined;
        const id = existing?.id
          ?? (typeof entry.id === "string" && entry.id.trim().length > 0 ? entry.id : generateId("run"));
        const createdAt = existing?.createdAt ?? Date.now();
        const nextRunLog = base.runLog.filter((run) => run.id !== id);
        nextRunLog.push({ id, date: normalizedDate, fans: fansValue, type, notes, createdAt });
        nextRunLog.sort((a, b) => {
          if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
          const dateDiff = b.date.localeCompare(a.date);
          if (dateDiff !== 0) return dateDiff;
          return b.id.localeCompare(a.id);
        });
        const unchanged =
          base.runLog.length === nextRunLog.length &&
          base.runLog.every(
            (run, index) =>
              run.id === nextRunLog[index].id &&
              run.date === nextRunLog[index].date &&
              run.fans === nextRunLog[index].fans &&
              run.type === nextRunLog[index].type &&
              run.notes === nextRunLog[index].notes &&
              run.createdAt === nextRunLog[index].createdAt,
          );
        if (unchanged) return prev;
        return { entries: base.entries, runLog: nextRunLog };
      });
    },
    [setFansCaratsState],
  );

  const deleteRunLogEntry = useCallback(
    (id: string) => {
      setFansCaratsState((prev) => {
        const base = sanitizeFansCaratsState(prev);
        const nextRunLog = base.runLog.filter((entry) => entry.id !== id);
        if (nextRunLog.length === base.runLog.length) return prev;
        return { entries: base.entries, runLog: nextRunLog };
      });
    },
    [setFansCaratsState],
  );

  const updateWeeklyFansTarget = useCallback(
    (target: number) => {
      setFansCaratsConfig((prev) => {
        const current = sanitizeFansCaratsConfig(prev);
        const next = sanitizeFansCaratsConfig({ weeklyFansTarget: target });
        if (current.weeklyFansTarget === next.weeklyFansTarget) return prev;
        return next;
      });
    },
    [setFansCaratsConfig]
  );

  useEffect(() => {
    const sanitized = sanitizeWastedResetState(wastedResetRaw);
    if (!wastedResetStateEqual(wastedResetRaw, sanitized)) setWastedResetState(sanitized);
  }, [wastedResetRaw, setWastedResetState]);

  const updateHistory = useCallback(
    (mutator: (draft: ResourceHistoryState, timestamp: number) => boolean, timestamp?: number) => {
      const ts = timestamp ?? now();
      setHistoryState((prev) => {
        const base = sanitizeHistoryState(prev);
        const draft = cloneHistoryState(base);
        const changed = mutator(draft, ts);
        if (!changed) return prev;
        trimHistoryInPlace(draft.tp, ts - HISTORY_RETENTION_MS);
        trimHistoryInPlace(draft.rp, ts - HISTORY_RETENTION_MS);
        return draft;
      });
    },
    [setHistoryState]
  );

  const sampleHistoryPoint = useCallback(
    (kind: ResourceKind, value: number, timestamp: number, force = false) => {
      let changed = false;
      updateHistory((draft, ts) => {
        const snapshot = kind === "tp" ? draft.tp : draft.rp;
        const lastSample = lastHistorySampleRef.current[kind];
        if (!force && lastSample && ts - lastSample < HISTORY_SAMPLE_INTERVAL_MS && snapshot.points.length > 0)
          return false;
        changed = pushHistoryPoint(snapshot, value, ts, force || snapshot.points.length === 0);
        return changed;
      }, timestamp);
      if (changed) lastHistorySampleRef.current[kind] = timestamp;
    },
    [updateHistory]
  );

  const recordHistoryEvent = useCallback(
    (kind: ResourceKind, value: number, input: ResourceHistoryEventInput, timestamp?: number) => {
      const ts = timestamp ?? now();
      updateHistory((draft, tsNow) => {
        const snapshot = kind === "tp" ? draft.tp : draft.rp;
        pushHistoryPoint(snapshot, value, tsNow, true);
        addHistoryEventToSnapshot(snapshot, kind, value, tsNow, input);
        return true;
      }, ts);
      lastHistorySampleRef.current[kind] = ts;
    },
    [updateHistory]
  );

  useEffect(() => {
    if (history.tp.points.length)
      lastHistorySampleRef.current.tp = history.tp.points[history.tp.points.length - 1].ts;
    if (history.rp.points.length)
      lastHistorySampleRef.current.rp = history.rp.points[history.rp.points.length - 1].ts;
  }, [history.tp.points, history.rp.points]);

  const fallbackGroupId = useMemo(
    () => findFallbackGroupId(absGroups.length ? absGroups : DEFAULT_ABS_TIMER_GROUPS),
    [absGroups]
  );

  const groupsForForms = absGroups.length ? absGroups : DEFAULT_ABS_TIMER_GROUPS;
  const formDefaultGroupId = groupsForForms.some((g) => g.id === fallbackGroupId)
    ? fallbackGroupId
    : groupsForForms[0]?.id || DEFAULT_ABS_TIMER_GROUPS[0].id;

  useEffect(() => {
    setAbsTimers((prev) => {
      if (!prev.length) return prev;
      const validIds = new Set(absGroups.map((g) => g.id));
      let changed = false;
      const updated = prev.map((t) => {
        const groupId = validIds.has(t.groupId) ? t.groupId : fallbackGroupId;
        const status: AbsTimerStatus =
          t.status === "completed" || t.status === "expired" ? t.status : "active";
        if (t.groupId !== groupId || t.status !== status) {
          changed = true;
          return { ...t, groupId, status };
        }
        return t;
      });
      return changed ? updated : prev;
    });
  }, [absGroups, fallbackGroupId, setAbsTimers]);

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const nowMs = now();
    setTimers((prev) =>
      prev.map((t, index) => {
        if (!t)
          return {
            id: crypto.randomUUID(),
            label: "Timer",
            targetTs: nowMs,
            isPaused: false,
            pausedRemaining: null,
            created: nowMs,
            color: defaultTimerColor(index),
            durationMs: 0,
            includeInOverview: true,
          };
        const rem = Number.isFinite(t.remainingMs) ? (t.remainingMs as number) : 0;
        const hasTarget = Number.isFinite(t.targetTs);
        const created = Number.isFinite(t.created) ? (t.created as number) : nowMs;
        const candidate: TimerData = {
          ...t,
          targetTs: hasTarget ? (t.targetTs as number) : nowMs + rem,
          pausedRemaining: t.isPaused ? (Number.isFinite(t.pausedRemaining) ? t.pausedRemaining : rem) : null,
          created,
        };
        const remaining = computeTimerRemainingMs(candidate, nowMs);
        const duration = Number.isFinite(t.durationMs)
          ? Math.max(0, t.durationMs as number)
          : computeTimerTotalMs(candidate, remaining, nowMs);
        const includeInOverview = t.includeInOverview !== false;
        return {
          ...candidate,
          color: sanitizeTimerColor(candidate.color, index),
          durationMs: duration,
          includeInOverview,
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decoratedTimers = useMemo(() => {
    const nowMs = now();
    return timers.map((t, index) => {
      const remaining = computeTimerRemainingMs(t, nowMs);
      const total = computeTimerTotalMs(t, remaining, nowMs);
      const colorResolved = resolveTimerColor(t, index);
      const progress = total > 0 ? clamp(1 - remaining / total, 0, 1) : 1;
      const includeInOverview = t.includeInOverview !== false;
      return {
        ...t,
        remainingMs: remaining,
        totalMs: total,
        progress,
        colorResolved,
        includeInOverview,
      } as TimerDisplayData;
    });
  }, [timers, tick]);

  const timersByGroup = useMemo(() => {
    const map = new Map<string, AbsTimer[]>();
    for (const timer of absTimers) {
      const targetGroupId = absGroups.some((g) => g.id === timer.groupId)
        ? timer.groupId
        : fallbackGroupId;
      if (!map.has(targetGroupId)) map.set(targetGroupId, []);
      map.get(targetGroupId)!.push(timer);
    }
    return map;
  }, [absTimers, absGroups, fallbackGroupId]);

  const decoratedAbsTimers = useMemo(() => {
    const fallbackGroup =
      absGroups.find((g) => g.id === fallbackGroupId) ?? DEFAULT_ABS_TIMER_GROUPS[0];
    const byId = new Map<string, AbsTimerGroup>();
    for (const group of absGroups) byId.set(group.id, group);
    if (!byId.has(fallbackGroup.id)) byId.set(fallbackGroup.id, fallbackGroup);
    return absTimers.map((t) => {
      const group = byId.get(t.groupId) ?? fallbackGroup;
      const status: AbsTimerStatus =
        t.status === "completed" || t.status === "expired" ? t.status : "active";
      const includeInOverview = t.includeInOverview === true;
      return { ...t, group, status, includeInOverview };
    });
  }, [absTimers, absGroups, fallbackGroupId]);

  const timerSummary = useMemo(() => {
    const arr = decoratedTimers.filter((t) => t.includeInOverview);
    arr.sort((a, b) => {
      const weight = (x: TimerDisplayData) => {
        if (!x.isPaused && x.remainingMs > 0) return 0;
        if (x.isPaused && x.remainingMs > 0) return 1;
        return 2;
      };
      const wa = weight(a);
      const wb = weight(b);
      if (wa !== wb) return wa - wb;
      return a.remainingMs - b.remainingMs;
    });
    return arr;
  }, [decoratedTimers]);

  const nextTimerColor = useMemo(() => defaultTimerColor(timers.length), [timers.length]);
  const nextGroupColor = useMemo(() => defaultTimerColor(absGroups.length), [absGroups.length]);

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

  useEffect(() => {
    const ts = now();
    sampleHistoryPoint("tp", curTP.value, ts);
    sampleHistoryPoint("rp", curRP.value, ts);
  }, [tick, curTP.value, curRP.value, sampleHistoryPoint]);

  useEffect(() => {
    const previous = lastResetTsRef.current;
    const nowTs = now();
    if (previous != null && previous !== nextReset && previous <= nowTs) {
      recordHistoryEvent("tp", curTP.value, { type: "reset", note: "Daily reset", force: true }, nowTs);
      recordHistoryEvent("rp", curRP.value, { type: "reset", note: "Daily reset", force: true }, nowTs);
    }
    lastResetTsRef.current = nextReset;
  }, [nextReset, curTP.value, curRP.value, recordHistoryEvent]);

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
    setFired((prev) => {
      const resets = prev.resets || {};
      const prefix = `${nextReset}:`;
      const nextResets = Object.fromEntries(
        Object.entries(resets).filter(([key]) => key.startsWith(prefix))
      );
      if (Object.keys(nextResets).length === Object.keys(resets).length) return prev;
      return { ...prev, resets: nextResets };
    });
  }, [nextReset, setFired]);

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
        if (a.status !== "completed" && a.status !== "expired" && a.ts <= now())
          maybeFireAbs(a.id, a.label || "Timer", fired, setFired);
    }
    const dailyReset = {
      atReset: notif.dailyReset?.atReset !== false,
      hourBefore: notif.dailyReset?.hourBefore !== false,
    };
    const untilReset = nextReset - now();
    if (dailyReset.hourBefore)
      maybeFireReset(
        `${nextReset}:hour`,
        "Daily reset in 1 hour",
        "One hour until daily reset.",
        untilReset <= 3600000 && untilReset > 0,
        fired,
        setFired
      );
    if (dailyReset.atReset)
      maybeFireReset(
        `${nextReset}:reset`,
        "Daily reset",
        "Daily reset is live!",
        untilReset <= 0,
        fired,
        setFired
      );
  }, [curTP.value, curRP.value, timers, absTimers, notif, fired, setFired, nextReset]);

  const tpMilestoneTimes = useMemo(
    () => milestoneTimes({ ...curTP, nextPoint: curTP.nextPoint }, TP_RATE_MS, [30, 60, 90]),
    [curTP]
  );
  const rpFull = useMemo(() => timeToFull(curRP, RP_RATE_MS, RP_CAP), [curRP]);
  const tpFull = useMemo(() => timeToFull(curTP, TP_RATE_MS, TP_CAP), [curTP]);
  const overlaySnapshot = useMemo<OverlaySnapshotPayload>(() => {
    const nowMs = now();
    const buildSnapshot = (
      current: CurrentResource,
      rateMs: number,
      cap: number
    ): OverlayResourceSnapshot => {
      const nextMs = Math.max(0, current.nextPoint - nowMs);
      const need = Math.max(0, cap - current.value);
      const first = Math.max(0, nextMs);
      const fullMs = need === 0 ? 0 : first + Math.max(0, need - 1) * rateMs;
      return {
        value: current.value,
        nextMs,
        fullMs,
        atCap: current.value >= cap,
      };
    };
    return {
      tp: buildSnapshot(curTP, TP_RATE_MS, TP_CAP),
      rp: buildSnapshot(curRP, RP_RATE_MS, RP_CAP),
      timestamp: nowMs,
    };
  }, [curTP, curRP, tick]);

  useEffect(() => {
    const channel = overlayChannelRef.current;
    if (!channel) return;
    try {
      channel.postMessage(overlaySnapshot);
    } catch {
      // ignore broadcast errors
    }
  }, [overlaySnapshot]);
  const tpWasted = useMemo(() => {
    const nowTs = now();
    return computeWastedAtCap(
      history.tp.points,
      curTP.value,
      TP_CAP,
      TP_RATE_MS,
      HISTORY_RETENTION_MS,
      nowTs,
      wastedReset.tp
    );
  }, [history.tp.points, curTP.value, tick, wastedReset.tp]);
  const rpWasted = useMemo(() => {
    const nowTs = now();
    return computeWastedAtCap(
      history.rp.points,
      curRP.value,
      RP_CAP,
      RP_RATE_MS,
      HISTORY_RETENTION_MS,
      nowTs,
      wastedReset.rp
    );
  }, [history.rp.points, curRP.value, tick, wastedReset.rp]);
  const resetWastedStats = useCallback(() => {
    const ts = now();
    setWastedResetState({ tp: ts, rp: ts });
    sampleHistoryPoint("tp", curTP.value, ts, true);
    sampleHistoryPoint("rp", curRP.value, ts, true);
  }, [setWastedResetState, sampleHistoryPoint, curTP.value, curRP.value]);
  const hotkeyBindingsMap = useMemo(() => {
    const map = new Map<string, HotkeyActionId>();
    for (const action of HOTKEY_ACTIONS) {
      const binding = hotkeys.bindings[action.id];
      if (binding) map.set(binding, action.id);
    }
    return map;
  }, [hotkeys.bindings]);
  const hotkeyCaptureActive = activeHotkeyCapture != null;

  const updateHotkeys = useCallback(
    (updater: (prev: HotkeySettings) => HotkeySettings) => {
      setHotkeys((prev) => {
        const base = sanitizeHotkeySettings(prev);
        const next = updater(base);
        return hotkeySettingsEqual(base, next) ? prev : next;
      });
    },
    [setHotkeys]
  );

  const toggleHotkeysPause = useCallback(() => {
    updateHotkeys((prev) => ({ ...prev, paused: !prev.paused }));
  }, [updateHotkeys]);

  const setHotkeysPaused = useCallback(
    (paused: boolean) => {
      updateHotkeys((prev) => ({ ...prev, paused }));
    },
    [updateHotkeys]
  );

  const setHotkeysEnabled = useCallback(
    (enabled: boolean) => {
      updateHotkeys((prev) => ({ ...prev, enabled }));
    },
    [updateHotkeys]
  );

  const setHotkeysAllowRepeat = useCallback(
    (allow: boolean) => {
      updateHotkeys((prev) => ({ ...prev, allowRepeat: allow }));
    },
    [updateHotkeys]
  );

  const setHotkeyBinding = useCallback(
    (actionId: HotkeyActionId, binding: string | null) => {
      updateHotkeys((prev) => {
        const normalized = binding ? normalizeBindingString(binding) : null;
        const nextBindings: HotkeyBindings = { ...prev.bindings };
        if (normalized) {
          for (const action of HOTKEY_ACTIONS) {
            if (action.id !== actionId && nextBindings[action.id] === normalized) {
              nextBindings[action.id] = null;
            }
          }
        }
        nextBindings[actionId] = normalized;
        return { ...prev, bindings: nextBindings };
      });
    },
    [updateHotkeys]
  );

  const clearHotkeyBinding = useCallback(
    (actionId: HotkeyActionId) => {
      setHotkeyBinding(actionId, null);
    },
    [setHotkeyBinding]
  );

  const startHotkeyCapture = useCallback((actionId: HotkeyActionId) => {
    setActiveHotkeyCapture(actionId);
  }, []);

  const stopHotkeyCapture = useCallback(() => {
    setActiveHotkeyCapture(null);
  }, []);

  useEffect(() => {
    handleHotkeyActionRef.current = (actionId) => {
      const action = HOTKEY_ACTION_LOOKUP.get(actionId);
      if (!action) return false;
      if (action.resource === "tp") {
        const before = curTP.value;
        const actual = Math.min(action.amount, Math.max(before, 0));
        if (actual <= 0) return false;
        spendTP(actual);
        const newValue = clamp(before - actual, 0, TP_CAP);
        setHotkeyToast({
          id: Date.now(),
          message: `${action.verb} ${actual} TP (now ${newValue}/${TP_CAP})`,
        });
        // TODO: integrate click sound when an audio hook is available.
        return true;
      }
      if (action.resource === "rp") {
        const before = curRP.value;
        const actual = Math.min(action.amount, Math.max(before, 0));
        if (actual <= 0) return false;
        spendRP(actual);
        const newValue = clamp(before - actual, 0, RP_CAP);
        setHotkeyToast({
          id: Date.now(),
          message: `${action.verb} ${actual} RP (now ${newValue}/${RP_CAP})`,
        });
        // TODO: integrate click sound when an audio hook is available.
        return true;
      }
      return false;
    };
  }, [curTP, curRP, spendTP, spendRP, setHotkeyToast]);

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
    setActiveHotkeyCapture(null);
  }

  function applyTPUpdate(
    targetValue: number,
    current: CurrentResource,
    nowMs: number,
    type: ResourceHistoryEventInput["type"],
    note?: string,
    force = false
  ) {
    const clamped = clamp(Math.round(targetValue), 0, TP_CAP);
    const delta = clamped - current.value;
    if (!force && delta === 0) return;
    setTP((prev) => ({ base: clamped, last: nowMs, nextOverride: prev.nextOverride ?? current.nextPoint }));
    recordHistoryEvent("tp", clamped, { type, delta, note, force }, nowMs);
  }

  function applyRPUpdate(
    targetValue: number,
    current: CurrentResource,
    nowMs: number,
    type: ResourceHistoryEventInput["type"],
    note?: string,
    force = false
  ) {
    const clamped = clamp(Math.round(targetValue), 0, RP_CAP);
    const delta = clamped - current.value;
    if (!force && delta === 0) return;
    setRP((prev) => ({ base: clamped, last: nowMs, nextOverride: prev.nextOverride ?? current.nextPoint }));
    recordHistoryEvent("rp", clamped, { type, delta, note, force }, nowMs);
  }

  function changeTP(delta: number, type: ResourceHistoryEventInput["type"], note?: string, force = false) {
    const nowMs = now();
    const current = computeCurrent(tp.base, tp.last, TP_RATE_MS, TP_CAP, tp.nextOverride, nowMs);
    applyTPUpdate(current.value + delta, current, nowMs, type, note, force);
  }

  function changeRP(delta: number, type: ResourceHistoryEventInput["type"], note?: string, force = false) {
    const nowMs = now();
    const current = computeCurrent(rp.base, rp.last, RP_RATE_MS, RP_CAP, rp.nextOverride, nowMs);
    applyRPUpdate(current.value + delta, current, nowMs, type, note, force);
  }

  function setTPAmount(value: number, type: ResourceHistoryEventInput["type"] = "manual", note?: string, force = false) {
    const nowMs = now();
    const current = computeCurrent(tp.base, tp.last, TP_RATE_MS, TP_CAP, tp.nextOverride, nowMs);
    applyTPUpdate(value, current, nowMs, type, note, force);
  }

  function setRPAmount(value: number, type: ResourceHistoryEventInput["type"] = "manual", note?: string, force = false) {
    const nowMs = now();
    const current = computeCurrent(rp.base, rp.last, RP_RATE_MS, RP_CAP, rp.nextOverride, nowMs);
    applyRPUpdate(value, current, nowMs, type, note, force);
  }

  function adjustTP(delta: number) {
    changeTP(delta, "manual");
  }
  function adjustRP(delta: number) {
    changeRP(delta, "manual");
  }
  function spendTP(amount: number) {
    changeTP(-amount, "spend");
  }
  function spendRP(amount: number) {
    changeRP(-amount, "spend");
  }
  function setNextPointOverride(kind: "tp" | "rp", str: string) {
    const ms = parseFlexible(str);
    if (ms == null) return;
    const target = now() + ms;
    if (kind === "tp") setTP((prev) => ({ ...prev, nextOverride: target }));
    else setRP((prev) => ({ ...prev, nextOverride: target }));
  }
  function addTimer(
    label: string,
    input: string,
    colorInput: string,
    includeInOverview: boolean
  ) {
    const ms = parseFlexible(input);
    if (ms == null) return;
    const nowMs = now();
    setTimers((prev) => {
      const color = sanitizeTimerColor(colorInput, prev.length);
      const t: TimerData = {
        id: crypto.randomUUID(),
        label,
        targetTs: nowMs + ms,
        isPaused: false,
        pausedRemaining: null,
        created: nowMs,
        color,
        durationMs: ms,
        includeInOverview: includeInOverview !== false,
      };
      return [...prev, t];
    });
  }
  function pauseTimer(id: string, pause: boolean) {
    const nowMs = now();
    setTimers((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        if (pause && !t.isPaused) {
          const remaining = Number.isFinite(t.targetTs) ? Math.max(0, (t.targetTs as number) - nowMs) : 0;
          return {
            ...t,
            isPaused: true,
            pausedRemaining: remaining,
          };
        }
        if (!pause && t.isPaused) {
          const rem = Number.isFinite(t.pausedRemaining)
            ? Math.max(0, (t.pausedRemaining as number) || 0)
            : Math.max(0, (t.targetTs ?? nowMs) - nowMs);
          return {
            ...t,
            isPaused: false,
            targetTs: nowMs + rem,
            pausedRemaining: null,
          };
        }
        return t;
      })
    );
  }
  function addMinutes(id: string, mins: number) {
    const delta = mins * 60000;
    const nowMs = now();
    setTimers((prev) =>
      prev.map((t, index) => {
        if (t.id !== id) return t;
        const baseDuration = Number.isFinite(t.durationMs)
          ? Math.max(0, t.durationMs as number)
          : computeTimerTotalMs(t, computeTimerRemainingMs(t, nowMs), nowMs);
        if (t.isPaused) {
          const rem = Number.isFinite(t.pausedRemaining)
            ? Math.max(0, (t.pausedRemaining as number) || 0)
            : Math.max(0, (t.targetTs ?? nowMs) - nowMs);
          return {
            ...t,
            pausedRemaining: rem + delta,
            durationMs: Math.max(0, baseDuration + delta),
            color: sanitizeTimerColor(t.color, index),
          };
        }
        const targetBase = Number.isFinite(t.targetTs) ? (t.targetTs as number) : nowMs;
        return {
          ...t,
          targetTs: targetBase + delta,
          durationMs: Math.max(0, baseDuration + delta),
          color: sanitizeTimerColor(t.color, index),
        };
      })
    );
  }
  function resetTimer(id: string) {
    setTimers((prev) =>
      prev.map((t, index) =>
        t.id === id
          ? {
              ...t,
              isPaused: true,
              pausedRemaining: 0,
              durationMs: Number.isFinite(t.durationMs) ? Math.max(0, t.durationMs as number) : 0,
              color: sanitizeTimerColor(t.color, index),
            }
          : t
      )
    );
  }
  function changeTimerColor(id: string, colorInput: string) {
    setTimers((prev) =>
      prev.map((t, index) => (t.id === id ? { ...t, color: sanitizeTimerColor(colorInput, index) } : t))
    );
  }
  function setTimerIncludeInOverview(id: string, include: boolean) {
    setTimers((prev) => prev.map((t) => (t.id === id ? { ...t, includeInOverview: include } : t)));
  }
  function deleteTimer(id: string) {
    setTimers((prev) => prev.filter((t) => t.id !== id));
  }
  function addAbsGroup(name: string, colorInput: string) {
    setAbsGroups((prev) => {
      const label = name.trim() || `Group ${prev.length + 1}`;
      const color = sanitizeTimerColor(colorInput, prev.length);
      return [...prev, { id: crypto.randomUUID(), name: label, color }];
    });
  }

  function editAbsGroup(id: string, updates: Partial<AbsTimerGroup>) {
    setAbsGroups((prev) =>
      prev.map((group, index) => {
        if (group.id !== id) return group;
        const nextName = updates.name != null ? updates.name.trim() : group.name;
        const nextColor =
          updates.color != null ? sanitizeTimerColor(updates.color, index) : group.color;
        return { ...group, name: nextName || group.name, color: nextColor };
      })
    );
  }

  function addAbsTimer(
    groupId: string,
    label: string,
    whenTs: string,
    includeInOverview: boolean
  ) {
    if (!whenTs) return;
    const ts = new Date(whenTs).getTime();
    if (Number.isNaN(ts)) return;
    const targetGroup = absGroups.some((g) => g.id === groupId) ? groupId : fallbackGroupId;
    setAbsTimers((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        label,
        ts,
        groupId: targetGroup,
        status: "active",
        includeInOverview: includeInOverview === true,
      },
    ]);
  }

  function updateAbsTimer(
    id: string,
    updates: { label?: string; ts?: number; groupId?: string }
  ) {
    setAbsTimers((prev) =>
      prev.map((timer) => {
        if (timer.id !== id) return timer;
        let nextGroupId = timer.groupId;
        if (updates.groupId && absGroups.some((g) => g.id === updates.groupId))
          nextGroupId = updates.groupId;
        else if (!absGroups.some((g) => g.id === nextGroupId)) nextGroupId = fallbackGroupId;
        const next: AbsTimer = { ...timer, groupId: nextGroupId };
        if (updates.label != null) next.label = updates.label;
        const tsUpdate = updates.ts;
        if (tsUpdate != null && Number.isFinite(tsUpdate)) next.ts = tsUpdate;
        return next;
      })
    );
  }

  function setAbsTimerStatus(id: string, status: AbsTimerStatus) {
    setAbsTimers((prev) => prev.map((timer) => (timer.id === id ? { ...timer, status } : timer)));
  }

  function setAbsTimerIncludeInOverview(id: string, include: boolean) {
    setAbsTimers((prev) =>
      prev.map((timer) =>
        timer.id === id ? { ...timer, includeInOverview: include ? true : false } : timer
      )
    );
  }

  function deleteAbsTimer(id: string) {
    setAbsTimers((prev) => prev.filter((x) => x.id !== id));
  }

  const handleImportAbsTimers = useCallback(
    (bundle: TimerImportBundle): TimerImportResult => {
      const { nextGroups, idMap, nameMap, added, updated } = mergeImportedGroups(absGroups, bundle.groups);
      if (nextGroups !== absGroups) setAbsGroups(nextGroups);
      const prepared = prepareImportedTimers(bundle.timers, nextGroups, idMap, nameMap);
      if (!prepared.length)
        return {
          addedGroups: added,
          updatedGroups: updated,
          addedTimers: 0,
        };
      const existingKeys = new Set(absTimers.map((t) => timerDedupKey(t)));
      const unique: AbsTimer[] = [];
      prepared.forEach((timer) => {
        const key = timerDedupKey(timer);
        if (existingKeys.has(key)) return;
        existingKeys.add(key);
        unique.push(timer);
      });
      if (unique.length) setAbsTimers((prev) => [...prev, ...unique]);
      return {
        addedGroups: added,
        updatedGroups: updated,
        addedTimers: unique.length,
      };
    },
    [absGroups, absTimers, setAbsGroups, setAbsTimers]
  );

  const q = useQuery();
  const hud = q.get("hud") === "1";
  const overlay = q.get("overlay");
  const overlayHotkeysParam = q.get("hotkeys") === "1";
  const overlayHotkeysAllowed = overlay ? overlayHotkeysParam : true;
  const hotkeysActive = hotkeys.enabled && !hotkeys.paused && overlayHotkeysAllowed && !hotkeyCaptureActive;
  const dailyResetSettings = {
    atReset: notif.dailyReset?.atReset !== false,
    hourBefore: notif.dailyReset?.hourBefore !== false,
  };
  const resourceColumns = hud
    ? "repeat(auto-fit, minmax(240px, 1fr))"
    : "repeat(auto-fit, minmax(300px, 1fr))";

  useEffect(() => {
    if (!hotkeysActive) return;
    if (typeof window === "undefined") return;
    const pressed = new Set<string>();
    const lastTrigger = new Map<HotkeyActionId, number>();

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (shouldIgnoreHotkeyEvent(event)) return;
      const binding = bindingFromEvent(event);
      if (!binding) return;
      const actionId = hotkeyBindingsMap.get(binding);
      if (!actionId) return;
      if (!hotkeys.allowRepeat && (event.repeat || pressed.has(binding))) return;
      const nowMs = Date.now();
      if (hotkeys.allowRepeat) {
        const prev = lastTrigger.get(actionId) ?? 0;
        if (nowMs - prev < HOTKEY_THROTTLE_MS) return;
      }
      const handled = handleHotkeyActionRef.current(actionId);
      if (!handled) return;
      event.preventDefault();
      event.stopPropagation();
      pressed.add(binding);
      lastTrigger.set(actionId, nowMs);
    };

    const handleKeyup = (event: KeyboardEvent) => {
      const binding = bindingFromEvent(event);
      if (!binding) return;
      pressed.delete(binding);
    };

    const clearPressed = () => {
      pressed.clear();
    };

    const handleVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.hidden) pressed.clear();
    };

    window.addEventListener("keydown", handleKeydown);
    window.addEventListener("keyup", handleKeyup);
    window.addEventListener("blur", clearPressed);
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("keydown", handleKeydown);
      window.removeEventListener("keyup", handleKeyup);
      window.removeEventListener("blur", clearPressed);
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [hotkeysActive, hotkeys.allowRepeat, hotkeyBindingsMap]);

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
    const bgGradient = `radial-gradient(circle at 20% 20%, ${mixColor(COLOR.bg, "#1f3b73", 0.35)} 0%, ${COLOR.bg} 55%, ${mixColor(
      COLOR.bg,
      "#000000",
      0.45
    )} 100%)`;
    document.body.style.background = bgGradient;
    document.body.style.color = COLOR.text;
  }, []);

  const tzDraftTrimmed = tzDraft.trim();
  const tzDraftIsValid = tzDraftTrimmed.length > 0 && isValidTimeZone(tzDraftTrimmed);
  const tzPreview = settingsOpen && tzDraftIsValid
    ? new Date().toLocaleString(undefined, { timeZone: tzDraftTrimmed })
    : null;
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
          tpHistory={history.tp}
          rpHistory={history.rp}
          historyRetentionMs={HISTORY_RETENTION_MS}
        />
        <HotkeyToast toast={hotkeyToast} />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "12px 8px 28px", color: COLOR.text }}>
      <Header
        hud={hud}
        onOpenSettings={toggleSettings}
        timeZone={activeTimeZone}
        isSettingsOpen={settingsOpen}
        hotkeysEnabled={hotkeys.enabled}
        hotkeysPaused={hotkeys.paused}
        onToggleHotkeysPause={toggleHotkeysPause}
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
            <OverlaySettingsPanel
              overlayApi={overlayApi}
              palette={{
                text: COLOR.text,
                subtle: COLOR.subtle,
                border: withAlpha(COLOR.border, 0.6),
                accent: COLOR.tp,
              }}
            />
            <div
              style={{
                borderTop: `1px solid ${withAlpha(COLOR.border, 0.6)}`,
                marginTop: 12,
                paddingTop: 12,
                display: "grid",
                gap: 8,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Resource stats</div>
                <div style={{ fontSize: 12, color: COLOR.subtle, marginTop: 4 }}>
                  Reset the time at cap and wasted RP/TP counters.
                </div>
              </div>
              <div>
                <SmallBtn onClick={resetWastedStats}>Reset wasted RP/TP tracking</SmallBtn>
              </div>
            </div>
            <div
              style={{
                borderTop: `1px solid ${withAlpha(COLOR.border, 0.6)}`,
                marginTop: 12,
                paddingTop: 12,
                display: "grid",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>Hotkeys</div>
                <div style={{ fontSize: 12, color: COLOR.subtle, marginTop: 4 }}>
                  Configure keyboard shortcuts for spending TP and RP. Hotkeys are ignored while typing or when
                  modals are open.
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
                <Checkbox
                  checked={hotkeys.enabled}
                  onChange={(v) => setHotkeysEnabled(v)}
                  label="Enable hotkeys"
                />
                <Checkbox
                  checked={hotkeys.paused}
                  onChange={(v) => setHotkeysPaused(v)}
                  label="Pause hotkeys"
                  disabled={!hotkeys.enabled}
                />
                <Checkbox
                  checked={hotkeys.allowRepeat}
                  onChange={(v) => setHotkeysAllowRepeat(v)}
                  label="Allow repeat while holding (150ms throttle)"
                  disabled={!hotkeys.enabled}
                />
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {HOTKEY_ACTIONS.map((action) => {
                  const binding = hotkeys.bindings[action.id];
                  const capturing = activeHotkeyCapture === action.id;
                  return (
                    <div
                      key={action.id}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 12,
                        alignItems: "center",
                        justifyContent: "space-between",
                      }}
                    >
                      <div style={{ flex: "1 1 220px", minWidth: 200 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{action.label}</div>
                        <div style={{ fontSize: 12, color: COLOR.subtle, marginTop: 2 }}>
                          Default: {formatBinding(action.defaultBinding)}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <KeyCapture
                          binding={binding ?? null}
                          capturing={capturing}
                          onStartCapture={() => startHotkeyCapture(action.id)}
                          onStopCapture={stopHotkeyCapture}
                          onBindingChange={(value) => setHotkeyBinding(action.id, value)}
                          disabled={!hotkeys.enabled}
                        />
                        <SmallBtn
                          onClick={() => clearHotkeyBinding(action.id)}
                          disabled={!hotkeys.enabled || !binding}
                        >
                          Clear
                        </SmallBtn>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ fontSize: 12, color: COLOR.subtle }}>
                Overlay sources have hotkeys disabled by default. Append <code>?hotkeys=1</code> to an overlay URL to
                opt in when using OBS.
              </div>
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: "grid", gridTemplateColumns: resourceColumns, gap: 12 }}>
        <ResourceCard
          accent={COLOR.tp}
          name="TP"
          cap={TP_CAP}
          rateMs={TP_RATE_MS}
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
          onSetAmount={(value) => setTPAmount(value)}
          history={history.tp}
          historyRetentionMs={HISTORY_RETENTION_MS}
          wasted={tpWasted}
        />

        <ResourceCard
          accent={COLOR.rp}
          name="RP"
          cap={RP_CAP}
          rateMs={RP_RATE_MS}
          current={curRP}
          onMinus={() => adjustRP(-1)}
          onPlus={() => adjustRP(1)}
          onSpend30={null}
          onUseOne={() => spendRP(1)}
          milestones={[]}
          milestoneTimes={{}}
          fullInfo={rpFull}
          onSetNextOverride={(v) => setNextPointOverride("rp", v)}
          hud={hud}
          onCopyOverlay={() => copyOverlayURL("rp")}
          timeZone={activeTimeZone}
          onSetAmount={(value) => setRPAmount(value)}
          history={history.rp}
          historyRetentionMs={HISTORY_RETENTION_MS}
          wasted={rpWasted}
        />
      </div>

      <Card title="Fans & Carats Analytics">
        <FansCaratsAnalytics
          entries={fansCaratsEntries}
          dailyStats={fansCaratsDailyStats}
          rollingTotals={fansCaratsRolling7}
          weeklySummaries={fansCaratsWeeklySummaries}
          weeklyTarget={fansCaratsConfig.weeklyFansTarget}
          onSubmit={upsertFansCaratsEntry}
          onDelete={deleteFansCaratsEntry}
          onUpdateWeeklyTarget={updateWeeklyFansTarget}
          fansTrend={fansTrend}
          caratsTrend={caratsTrend}
          runLogEntries={fansCaratsRunLog}
          onSaveRunLogEntry={saveRunLogEntry}
          onDeleteRunLogEntry={deleteRunLogEntry}
        />
      </Card>

      <Card title="Daily Reset & Timer Overview">
        <CountdownRow targetMs={nextReset} timeZone={activeTimeZone} />
        <div style={{ marginTop: 12 }}>
          <TimerOverviewList
            timers={timerSummary}
            absTimers={decoratedAbsTimers}
            timeZone={activeTimeZone}
          />
        </div>
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
          <Label>Daily reset:</Label>
          <Checkbox
            checked={dailyResetSettings.hourBefore}
            onChange={(v) =>
              setNotif((n) => ({
                ...n,
                dailyReset: { ...n.dailyReset, hourBefore: v },
              }))
            }
            label="1h warning"
          />
          <Checkbox
            checked={dailyResetSettings.atReset}
            onChange={(v) =>
              setNotif((n) => ({
                ...n,
                dailyReset: { ...n.dailyReset, atReset: v },
              }))
            }
            label="At reset"
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

      <Card title="Custom Flexible Timers">
        <AddTimerForm onAdd={addTimer} defaultColor={nextTimerColor} />
        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12 }}>
          {decoratedTimers.length === 0 ? (
            <p style={{ color: COLOR.subtle, fontSize: 14 }}>No custom timers yet.</p>
          ) : (
            decoratedTimers.map((meta) => (
              <TimerRow
                key={meta.id}
                t={meta}
                meta={meta}
                onAddMinutes={(m) => addMinutes(meta.id, m)}
                onPause={(p) => pauseTimer(meta.id, p)}
                onReset={() => resetTimer(meta.id)}
                onDelete={() => deleteTimer(meta.id)}
                onCopy={() => copyOverlayURL("timer", meta.id)}
                onColorChange={(color) => changeTimerColor(meta.id, color)}
                onToggleOverview={(include) => setTimerIncludeInOverview(meta.id, include)}
              />
            ))
          )}
        </div>
      </Card>

      <Card title="Exact Date/Time Timers">
        <div style={{ display: "grid", gap: 12 }}>
          <TimerImportExportControls
            groups={absGroups.length ? absGroups : DEFAULT_ABS_TIMER_GROUPS}
            timers={absTimers}
            onImport={handleImportAbsTimers}
          />
          <AddGroupForm onAdd={addAbsGroup} defaultColor={nextGroupColor} />
          <AddAbsTimerForm
            onAdd={addAbsTimer}
            groups={groupsForForms}
            defaultGroupId={formDefaultGroupId}
          />
        </div>
        <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
          {groupsForForms.map((group) => (
            <AbsTimerGroupSection
              key={group.id}
              group={group}
              timers={timersByGroup.get(group.id) ?? []}
              groups={groupsForForms}
              onUpdateGroup={editAbsGroup}
              onUpdateTimer={updateAbsTimer}
              onStatusChange={setAbsTimerStatus}
              onDeleteTimer={deleteAbsTimer}
              onCopyOverlay={(id) => copyOverlayURL("abs", id)}
              onToggleOverview={setAbsTimerIncludeInOverview}
              timeZone={activeTimeZone}
            />
          ))}
        </div>
      </Card>

      <footer style={{ color: COLOR.subtle, fontSize: 12, paddingTop: 16, paddingBottom: 12 }}>
        Streamer HUD: add <code>?hud=1</code> to the URL for compact panels. Overlay links: each card has a "Copy
        Overlay URL" to render a minimal scene for OBS as a browser source. Inputs accept "mm:ss, 10m, 2h, or seconds".
      </footer>
      <HotkeyToast toast={hotkeyToast} />
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

    const base = nowMs - 5 * 60 * 1000;
    const capSeries = [
      { ts: base, value: 100 },
      { ts: base + 60 * 1000, value: 100 },
    ];
    const wastedAtCap = computeWastedAtCap(
      capSeries,
      100,
      100,
      60 * 1000,
      HISTORY_RETENTION_MS,
      base + 60 * 1000,
      null,
    );
    eq(Math.round(wastedAtCap.ms / 1000), 60, "computeWastedAtCap captures minutes at cap");

    const afterSpendSeries = [
      ...capSeries,
      { ts: base + 60 * 1000 + 1000, value: 50 },
    ];
    const wastedAfterSpend = computeWastedAtCap(
      afterSpendSeries,
      50,
      100,
      60 * 1000,
      HISTORY_RETENTION_MS,
      base + 60 * 1000 + 1000,
      null,
    );
    eq(
      Math.round(wastedAfterSpend.ms / 1000),
      Math.round(wastedAtCap.ms / 1000),
      "computeWastedAtCap remains stable immediately after spending",
    );

    const wastedLater = computeWastedAtCap(
      afterSpendSeries,
      50,
      100,
      60 * 1000,
      HISTORY_RETENTION_MS,
      base + 60 * 1000 + 10 * 60 * 1000,
      null,
    );
    eq(
      Math.round(wastedLater.ms / 1000),
      Math.round(wastedAtCap.ms / 1000),
      "computeWastedAtCap does not decrease once off cap",
    );

    const normalizedDate = normalizeISODate("2024-07-06");
    eq(normalizedDate, "2024-07-06", "normalizeISODate accepts valid strings");
    const weekStart = startOfWeekISO("2024-07-06");
    eq(weekStart, "2024-07-01", "startOfWeekISO returns Monday start");
    const fcState = sanitizeFansCaratsState({
      entries: [
        { date: "2024-07-01", fans: 1000, carats: 25 },
        { date: "2024-07-02", fans: 1200, carats: 30 },
      ],
    });
    eq(fcState.entries.length, 2, "sanitizeFansCaratsState keeps valid entries");
    const runLogSanitized = sanitizeFansCaratsState({
      entries: [],
      runLog: [
        { id: "", date: "2024-07-03", fans: 1500, type: "training", notes: "note", createdAt: Date.now() },
        { id: "dup", date: "bad", fans: "nan", type: "mystery", notes: 123, createdAt: "nope" as unknown as number },
      ],
    });
    eq(runLogSanitized.runLog.length >= 1, true, "sanitizeFansCaratsState keeps run log entries");
    eq(runLogSanitized.runLog[0].type, "training", "sanitizeFansCaratsState normalizes run log type");
    const dailyStats = buildFansCaratsDailyStats(fcState.entries);
    eq(dailyStats[1].fansDelta, 200, "buildFansCaratsDailyStats computes fan delta");
    const weeklySummaries = buildWeeklySummaries(dailyStats);
    eq(
      weeklySummaries.length === 1 && Math.round(weeklySummaries[0].fansDelta) === 200,
      true,
      "buildWeeklySummaries aggregates fan delta",
    );
  } catch (e) {
    console.warn("Test harness error: ", e);
  }
})();
