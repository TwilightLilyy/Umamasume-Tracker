import { DEFAULT_TZ } from "../constants";

export const now = () => Date.now();

export function isValidTimeZone(value: string) {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function ensureTimeZone(value: string) {
  return isValidTimeZone(value) ? value : DEFAULT_TZ;
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

export function getTZOffsetDesignator(timeZone: string) {
  const zone = ensureTimeZone(timeZone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    let off = parts.find((p) => p.type === "timeZoneName")?.value || "GMT-05:00";
    if (off.startsWith("GMT")) off = off.slice(3);
    if (off.startsWith("UTC")) off = off.slice(3);
    off = off.trim();
    const sign = off[0];
    if ((sign === "+" || sign === "-") && off.length >= 5) {
      if (off.indexOf(":") === -1 && off.length === 5) return `${off.slice(0, 3)}:${off.slice(3)}`;
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

export function formatDateTimeLocalInput(ts: number) {
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const offset = date.getTimezoneOffset();
  const local = new Date(ts - offset * 60000);
  return local.toISOString().slice(0, 16);
}
