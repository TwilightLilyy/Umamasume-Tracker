import React, { useEffect } from "react";

import { COLOR } from "../constants";
import { mixColor, withAlpha } from "../utils/color";
import { bindingFromEvent, formatBinding } from "../utils/hotkeys";

export interface KeyCaptureProps {
  binding: string | null;
  capturing: boolean;
  onStartCapture: () => void;
  onStopCapture: () => void;
  onBindingChange: (binding: string | null) => void;
  disabled?: boolean;
}

export function KeyCapture({ binding, capturing, onStartCapture, onStopCapture, onBindingChange, disabled }: KeyCaptureProps) {
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
