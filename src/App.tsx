import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  HOTKEY_THROTTLE_MS,
  HOTKEY_ACTIONS,
  HOTKEY_ACTION_LOOKUP,
  DEFAULT_HOTKEY_SETTINGS,
  type HotkeyActionId,
  type HotkeySettings,
  bindingFromEvent,
  formatBinding,
  hotkeySettingsEqual,
  sanitizeHotkeySettings,
  shouldIgnoreHotkeyEvent,
  normalizeBindingString,
} from "./utils/hotkeys";
import { useLocalStorage } from "./hooks/useLocalStorage";
import {
  computeCurrent,
  sanitizeResource,
  shallowEqualResource,
  milestoneTimes,
  timeToFull,
  type CurrentResource,
  type ResourceState,
} from "./utils/resources";
import {
  DEFAULT_ABS_TIMER_GROUPS,
  findFallbackGroupId,
  mergeImportedGroups,
  prepareImportedTimers,
  sanitizeTimerImportData,
  timerDedupKey,
  type AbsTimer,
  type AbsTimerDisplay,
  type AbsTimerGroup,
  type AbsTimerStatus,
  type TimerImportBundle,
  type TimerImportResult,
} from "./utils/absTimers";
import {
  computeTimerRemainingMs,
  computeTimerTotalMs,
  resolveTimerColor,
  type TimerData,
  type TimerDisplayData,
} from "./utils/timers";
import {
  ensureTimeZone,
  formatDHMS,
  formatMMSS,
  formatDateTimeLocalInput,
  getTZOffsetDesignator,
  isValidTimeZone,
  nextDailyResetTS,
  now,
  parseFlexible,
} from "./utils/time";
import { clamp, defaultTimerColor, sanitizeTimerColor, withAlpha } from "./utils/color";
import {
  canNotify,
  ensurePermission,
  maybeFire,
  maybeFireAbs,
  maybeFireReset,
  maybeFireTimer,
  notify,
  type FiredState,
} from "./utils/notifications";
import { COLOR, DEFAULT_TZ, RP_CAP, RP_RATE_MS, TP_CAP, TP_RATE_MS } from "./constants";
import { Header } from "./components/Header";
import { Card, Checkbox, Input, Label, RowRight, SmallBtn } from "./components/ui";
import { ResourceCard } from "./components/ResourceCard";
import { AddTimerForm } from "./components/AddTimerForm";
import { TimerRow } from "./components/TimerRow";
import { AddGroupForm } from "./components/AddGroupForm";
import { AddAbsTimerForm } from "./components/AddAbsTimerForm";
import { TimerImportExportControls } from "./components/TimerImportExportControls";
import { AbsTimerGroupSection } from "./components/AbsTimers";
import { TimerOverviewList } from "./components/TimerOverviewList";
import { CountdownRow } from "./components/CountdownRow";
import { KeyCapture } from "./components/KeyCapture";
import { HotkeyToast, type HotkeyToastState } from "./components/HotkeyToast";
import { OverlayView } from "./components/OverlayView";

function useQuery() {
  const [q, setQ] = useState(() => new URLSearchParams(window.location.search));
  useEffect(() => {
    const onPop = () => setQ(new URLSearchParams(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  return q;
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

function computeTimerMeta(timers: TimerData[]) {
  const nowMs = now();
  return timers.map((t, index) => {
    const remaining = computeTimerRemainingMs(t, nowMs);
    const total = computeTimerTotalMs(t, remaining, nowMs);
    const progress = total === 0 ? 1 : clamp(1 - remaining / total, 0, 1);
    return {
      ...t,
      remainingMs: remaining,
      totalMs: total,
      progress,
      colorResolved: resolveTimerColor(t, index),
      includeInOverview: t.includeInOverview === true,
    } as TimerDisplayData;
  });
}

function decorateAbsTimers(
  timers: AbsTimer[],
  groups: AbsTimerGroup[],
  fallbackGroupId: string
): AbsTimerDisplay[] {
  const byId = new Map(groups.map((g) => [g.id, g]));
  return timers.map((timer) => {
    const group = byId.get(timer.groupId) ?? byId.get(fallbackGroupId) ?? groups[0];
    const status: AbsTimerStatus =
      timer.status === "completed" || timer.status === "expired" ? timer.status : "active";
    return {
      ...timer,
      group: group ?? { id: fallbackGroupId, name: "Timers", color: COLOR.tp },
      status,
      includeInOverview: timer.includeInOverview === true,
    };
  });
}

function summarizeTimers(timers: TimerDisplayData[]) {
  return timers.filter((t) => t.includeInOverview);
}

function summarizeAbsTimers(absTimers: AbsTimerDisplay[]) {
  return absTimers;
}

export default function UmaResourceTracker() {
  const [tpRaw, setTP] = useLocalStorage<ResourceState>("uma.tp", {
    base: TP_CAP,
    last: now(),
    nextOverride: null,
  });
  const [rpRaw, setRP] = useLocalStorage<ResourceState>("uma.rp", {
    base: RP_CAP,
    last: now(),
    nextOverride: null,
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

  const activeTimeZone = ensureTimeZone(timezone);

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
          : computeTimerTotalMs(t, remaining, nowMs);
        return {
          ...candidate,
          remainingMs: remaining,
          durationMs: duration,
          color: sanitizeTimerColor(t.color, index),
        };
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decoratedTimers = useMemo(() => computeTimerMeta(timers), [timers, tick]);

  const timersByGroup = useMemo(() => {
    const map = new Map<string, AbsTimer[]>();
    for (const timer of absTimers) {
      const list = map.get(timer.groupId) ?? [];
      list.push(timer);
      map.set(timer.groupId, list);
    }
    return map;
  }, [absTimers]);

  const decoratedAbsTimers = useMemo(
    () => decorateAbsTimers(absTimers, groupsForForms, fallbackGroupId),
    [absTimers, groupsForForms, fallbackGroupId, tick]
  );

  const timerSummary = useMemo(() => summarizeTimers(decoratedTimers), [decoratedTimers]);
  const absSummary = useMemo(() => summarizeAbsTimers(decoratedAbsTimers), [decoratedAbsTimers]);

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
  const nextReset = useMemo(() => nextDailyResetTS(new Date(), activeTimeZone), [tick, activeTimeZone]);
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
      if (notif.tpMilestones[String(m)]) maybeFire(`tp_${m}`, `TP ${m} ready`, tpVal >= m, fired, setFired);
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
        const nextBindings = { ...prev.bindings };
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
        return true;
      }
      return false;
    };
  }, [curTP, curRP]);

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

  function adjustTP(delta: number) {
    setTP((prev) => {
      const next = clamp(prev.base + delta, 0, TP_CAP);
      const nowMs = now();
      return { ...prev, base: next, last: nowMs };
    });
  }

  function adjustRP(delta: number) {
    setRP((prev) => {
      const next = clamp(prev.base + delta, 0, RP_CAP);
      const nowMs = now();
      return { ...prev, base: next, last: nowMs };
    });
  }

  function spendTP(amount: number) {
    setTP((prev) => {
      const next = clamp(prev.base - amount, 0, TP_CAP);
      const nowMs = now();
      return {
        ...prev,
        base: next,
        last: nowMs,
        nextOverride: computeCurrent(next, nowMs, TP_RATE_MS, TP_CAP, prev.nextOverride, nowMs).nextPoint,
      };
    });
  }

  function spendRP(amount: number) {
    setRP((prev) => {
      const next = clamp(prev.base - amount, 0, RP_CAP);
      const nowMs = now();
      return {
        ...prev,
        base: next,
        last: nowMs,
        nextOverride: computeCurrent(next, nowMs, RP_RATE_MS, RP_CAP, prev.nextOverride, nowMs).nextPoint,
      };
    });
  }

  function setNextPointOverride(resource: "tp" | "rp", value: string) {
    const parsed = parseFlexible(value);
    if (parsed == null) return;
    const target = now() + parsed;
    if (resource === "tp") setTP((prev) => ({ ...prev, nextOverride: target }));
    else setRP((prev) => ({ ...prev, nextOverride: target }));
  }

  function addTimer(label: string, dur: string, color: string, includeInOverview: boolean) {
    const parsed = parseFlexible(dur);
    if (parsed == null) return;
    const nowMs = now();
    const id = crypto.randomUUID();
    setTimers((prev) => [
      ...prev,
      {
        id,
        label: label.trim(),
        targetTs: nowMs + parsed,
        isPaused: false,
        pausedRemaining: null,
        created: nowMs,
        color: sanitizeTimerColor(color, prev.length),
        durationMs: parsed,
        includeInOverview,
      },
    ]);
  }

  function pauseTimer(id: string, pause: boolean) {
    const nowMs = now();
    setTimers((prev) =>
      prev.map((t, index) => {
        if (t.id !== id) return t;
        if (pause) {
          const remaining = computeTimerRemainingMs(t, nowMs);
          return {
            ...t,
            isPaused: true,
            pausedRemaining: remaining,
            color: sanitizeTimerColor(t.color, index),
          };
        }
        return {
          ...t,
          isPaused: false,
          targetTs: nowMs + (t.pausedRemaining ?? 0),
          pausedRemaining: null,
          created: nowMs,
          color: sanitizeTimerColor(t.color, index),
        };
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
        const nextColor = updates.color != null ? sanitizeTimerColor(updates.color, index) : group.color;
        return { ...group, name: nextName || group.name, color: nextColor };
      })
    );
  }

  function addAbsTimer(groupId: string, label: string, whenTs: string, includeInOverview: boolean) {
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

  function updateAbsTimer(id: string, updates: { label?: string; ts?: number; groupId?: string }) {
    setAbsTimers((prev) =>
      prev.map((timer) => {
        if (timer.id !== id) return timer;
        let nextGroupId = timer.groupId;
        if (updates.groupId && absGroups.some((g) => g.id === updates.groupId)) nextGroupId = updates.groupId;
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
      prev.map((timer) => (timer.id === id ? { ...timer, includeInOverview: include ? true : false } : timer))
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
  const resourceColumns = hud ? "repeat(auto-fit, minmax(240px, 1fr))" : "repeat(auto-fit, minmax(300px, 1fr))";

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
        notify("Copy failed", "Unable to copy to clipboard");
      });
    }
  }

  const tzDraftTrimmed = tzDraft.trim();
  const tzDraftIsValid = !tzDraftTrimmed || isValidTimeZone(tzDraftTrimmed);
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
                  Configure keyboard shortcuts for spending TP and RP. Hotkeys are ignored while typing or when modals are
                  open.
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
                Overlay sources have hotkeys disabled by default. Append <code>?hotkeys=1</code> to an overlay URL to opt in
                when using OBS.
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
          onUseOne={() => spendRP(1)}
          milestones={[]}
          milestoneTimes={{}}
          fullInfo={rpFull}
          onSetNextOverride={(v) => setNextPointOverride("rp", v)}
          hud={hud}
          onCopyOverlay={() => copyOverlayURL("rp")}
          timeZone={activeTimeZone}
        />
      </div>

      <Card title="Daily Reset & Timer Overview">
        <CountdownRow targetMs={nextReset} timeZone={activeTimeZone} />
        <div style={{ marginTop: 12 }}>
          <TimerOverviewList timers={timerSummary} absTimers={absSummary} timeZone={activeTimeZone} />
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
        <div
          style={{
            marginTop: 12,
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: 12,
          }}
        >
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
        Streamer HUD: add <code>?hud=1</code> to the URL for compact panels. Overlay links: each card has a "Copy Overlay
        URL" to render a minimal scene for OBS as a browser source. Inputs accept "mm:ss, 10m, 2h, or seconds".
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
  } catch (e) {
    console.warn("Test harness error: ", e);
  }
})();
