import React, { useEffect, useState } from "react";

import { COLOR } from "../constants";
import { Checkbox, Input, SmallBtn } from "./ui";

export interface AddTimerFormProps {
  onAdd: (label: string, duration: string, color: string, includeInOverview: boolean) => void;
  defaultColor: string;
}

export function AddTimerForm({ onAdd, defaultColor }: AddTimerFormProps) {
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
