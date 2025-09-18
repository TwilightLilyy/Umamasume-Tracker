import React from "react";

import { COLOR } from "../constants";
import { ensureTimeZone } from "../utils/time";
import { SmallBtn } from "./ui";

export interface HeaderProps {
  hud: boolean;
  onOpenSettings: () => void;
  timeZone: string;
  isSettingsOpen: boolean;
  hotkeysEnabled: boolean;
  hotkeysPaused: boolean;
  onToggleHotkeysPause: () => void;
}

export function Header({
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
          Uma RP/TP Tracker — Streamer Build2
        </div>
        <div style={{ color: COLOR.subtle, fontSize: 12 }}>
          Dark theme • TP gold • RP blue • HUD mode & overlay URLs
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
