import React, { useState } from "react";

import { COLOR } from "../constants";
import { sanitizeTimerColor } from "../utils/color";
import { Input, SmallBtn } from "./ui";

export interface AddGroupFormProps {
  onAdd: (name: string, color: string) => void;
  defaultColor: string;
}

export function AddGroupForm({ onAdd, defaultColor }: AddGroupFormProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(defaultColor);

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <Input placeholder="Group name" value={name} onChange={setName} />
      <label
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          border: `1px solid ${COLOR.border}`,
          boxShadow: `0 0 10px rgba(0,0,0,0.45)`,
          position: "relative",
          cursor: "pointer",
          background: color,
        }}
        title="Pick group color"
      >
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(sanitizeTimerColor(e.target.value, 0))}
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
