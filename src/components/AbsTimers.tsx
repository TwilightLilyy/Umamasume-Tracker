import React, { useEffect, useState } from "react";

import { COLOR } from "../constants";
import type { AbsTimer, AbsTimerGroup, AbsTimerStatus } from "../utils/absTimers";
import { ensureTimeZone, formatDHMS, formatDateTimeLocalInput, formatMMSS, now } from "../utils/time";
import { cardRowStyle, mixColor, withAlpha } from "../utils/color";
import { Checkbox, Input, Select, SmallBtn } from "./ui";

export interface AbsTimerItemProps {
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

export function AbsTimerItem({
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
  const zone = ensureTimeZone(timeZone);

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
              At: {new Date(timer.ts).toLocaleString(undefined, { timeZone: zone })}
            </div>
            <div style={{ fontSize: 14 }}>{timeLine}</div>
            <div style={{ fontSize: 13, color: statusColor }}>Status: {statusText}</div>
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

export interface AbsTimerGroupSectionProps {
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

export function AbsTimerGroupSection({
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
