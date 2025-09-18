import { sanitizeTimerColor } from "./color";

export type AbsTimerStatus = "active" | "completed" | "expired";

export interface AbsTimerGroup {
  id: string;
  name: string;
  color: string;
}

export interface AbsTimer {
  id: string;
  label?: string;
  ts: number;
  status: AbsTimerStatus;
  groupId: string;
  includeInOverview?: boolean;
}

export interface AbsTimerDisplay extends AbsTimer {
  group: AbsTimerGroup;
  includeInOverview: boolean;
}

export const DEFAULT_ABS_TIMER_GROUPS: AbsTimerGroup[] = [
  { id: "uma-banners", name: "Uma banners", color: "#f97316" },
  { id: "support-card-banners", name: "Support card banners", color: "#38bdf8" },
  { id: "champions-meeting", name: "Champions Meeting", color: "#a855f7" },
  { id: "other", name: "Other", color: "#22c55e" },
];

export function normalizeGroupName(name: string) {
  return name.trim().toLowerCase();
}

export function findFallbackGroupId(groups: AbsTimerGroup[]) {
  if (!groups.length) return DEFAULT_ABS_TIMER_GROUPS[0].id;
  const other = groups.find((g) => normalizeGroupName(g.name).includes("other"));
  return other?.id ?? groups[0].id;
}

export interface TimerExportPayload {
  version: number;
  generatedAt: string;
  groups: { id: string; name: string; color: string }[];
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

export interface TimerImportGroupData {
  id?: string;
  name: string;
  color: string;
}

export interface TimerImportTimerData {
  id?: string;
  label?: string;
  ts: number;
  groupId?: string;
  groupName?: string;
  status: AbsTimerStatus;
  includeInOverview?: boolean;
}

export interface TimerImportBundle {
  groups: TimerImportGroupData[];
  timers: TimerImportTimerData[];
}

export interface TimerImportResult {
  addedGroups: number;
  updatedGroups: number;
  addedTimers: number;
}

export function createTimerExportPayload(groups: AbsTimerGroup[], timers: AbsTimer[]): TimerExportPayload {
  const groupMap = new Map(groups.map((g, index) => [g.id, { ...g, color: sanitizeTimerColor(g.color, index) }]));
  const exportedGroups = groups.map((g, index) => ({
    id: g.id,
    name: g.name,
    color: sanitizeTimerColor(g.color, index),
  }));
  const exportedTimers = timers.map((t) => {
    const group = groupMap.get(t.groupId);
    const status: AbsTimerStatus = t.status === "completed" || t.status === "expired" ? t.status : "active";
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

export function sanitizeTimerImportData(value: unknown): TimerImportBundle | null {
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
    else if (typeof includeRaw === "string") includeInOverview = includeRaw.trim().toLowerCase() === "true";
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

export function mergeImportedGroups(
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

export function prepareImportedTimers(
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

export function timerDedupKey(timer: AbsTimer) {
  return `${timer.groupId}|${timer.label ?? ""}|${timer.ts}`;
}

