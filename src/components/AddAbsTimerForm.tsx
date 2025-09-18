import React, { useEffect, useState } from "react";

import type { AbsTimerGroup } from "../utils/absTimers";
import { Checkbox, Input, Select, SmallBtn } from "./ui";

export interface AddAbsTimerFormProps {
  onAdd: (groupId: string, label: string, dateTime: string, includeInOverview: boolean) => void;
  groups: AbsTimerGroup[];
  defaultGroupId: string;
}

export function AddAbsTimerForm({ onAdd, groups, defaultGroupId }: AddAbsTimerFormProps) {
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
        Add
      </SmallBtn>
    </div>
  );
}
