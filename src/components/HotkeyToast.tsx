import React from "react";

import { COLOR } from "../constants";
import { withAlpha } from "../utils/color";

export interface HotkeyToastState {
  id: number;
  message: string;
}

export function HotkeyToast({ toast }: { toast: HotkeyToastState | null }) {
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
