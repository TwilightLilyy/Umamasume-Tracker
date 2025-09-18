import React, { useCallback, useRef, useState } from "react";

import { COLOR } from "../constants";
import { AbsTimer, AbsTimerGroup, createTimerExportPayload, sanitizeTimerImportData } from "../utils/absTimers";
import type { TimerImportBundle, TimerImportResult } from "../utils/absTimers";
import { SmallBtn } from "./ui";

export interface TimerImportExportControlsProps {
  groups: AbsTimerGroup[];
  timers: AbsTimer[];
  onImport: (bundle: TimerImportBundle) => TimerImportResult;
}

export function TimerImportExportControls({ groups, timers, onImport }: TimerImportExportControlsProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);

  const handleExport = useCallback(() => {
    try {
      if (typeof window === "undefined" || typeof document === "undefined") {
        setImportError("Export is only available in the browser.");
        setImportSuccess(null);
        return;
      }
      const payload = createTimerExportPayload(groups, timers);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `uma-custom-timers-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.warn("Failed to export timers", error);
      setImportError("Failed to export timers.");
      setImportSuccess(null);
    }
  }, [groups, timers]);

  const handleOpenFile = useCallback(() => {
    setImportError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        const sanitized = sanitizeTimerImportData(parsed);
        if (!sanitized) throw new Error("Invalid payload");
        const result = onImport(sanitized);
        if (result.addedTimers === 0 && result.addedGroups === 0 && result.updatedGroups === 0) {
          setImportSuccess("No new timers to import.");
        } else {
          const parts = [
            result.addedTimers > 0 ? `${result.addedTimers} timer${result.addedTimers === 1 ? "" : "s"}` : null,
            result.addedGroups > 0 ? `${result.addedGroups} new group${result.addedGroups === 1 ? "" : "s"}` : null,
            result.updatedGroups > 0
              ? `${result.updatedGroups} group${result.updatedGroups === 1 ? "" : "s"} updated`
              : null,
          ].filter(Boolean);
          setImportSuccess(parts.join(", "));
        }
        setImportError(null);
      } catch (error) {
        console.warn("Failed to import timers", error);
        setImportError("Failed to import timers. Please check the file format.");
        setImportSuccess(null);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [onImport]
  );

  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      <SmallBtn onClick={handleExport} disabled={timers.length === 0}>Export timers</SmallBtn>
      <SmallBtn onClick={handleOpenFile}>Import timers</SmallBtn>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleFileChange}
        style={{ display: "none" }}
      />
      {importError && <span style={{ color: COLOR.danger, fontSize: 12 }}>{importError}</span>}
      {importSuccess && !importError && (
        <span style={{ color: COLOR.good, fontSize: 12 }}>{importSuccess}</span>
      )}
    </div>
  );
}
