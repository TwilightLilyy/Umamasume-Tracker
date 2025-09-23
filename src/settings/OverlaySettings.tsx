import React, { useCallback, useEffect, useMemo, useState, type CSSProperties, type FC } from "react";
import type { OverlayBridge, OverlayState } from "../types/overlay";

interface OverlaySettingsProps {
  overlayApi?: OverlayBridge;
  palette: {
    text: string;
    subtle: string;
    border: string;
    accent: string;
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const buttonBaseStyle = (palette: OverlaySettingsProps["palette"], disabled?: boolean): CSSProperties => ({
  padding: "6px 10px",
  fontSize: 12,
  borderRadius: 8,
  background: "rgba(15, 23, 42, 0.75)",
  color: palette.text,
  border: `1px solid ${palette.border}`,
  cursor: disabled ? "not-allowed" : "pointer",
  opacity: disabled ? 0.55 : 1,
  transition: "transform 0.12s ease, box-shadow 0.12s ease",
  boxShadow: disabled ? "none" : "0 6px 16px rgba(15, 23, 42, 0.35)",
});

const accentButtonStyle = (palette: OverlaySettingsProps["palette"], disabled?: boolean): CSSProperties => ({
  ...buttonBaseStyle(palette, disabled),
  background: `linear-gradient(135deg, ${palette.accent} 0%, rgba(15, 23, 42, 0.7) 100%)`,
  border: `1px solid ${palette.accent}`,
});

const inputStyle = (palette: OverlaySettingsProps["palette"]): CSSProperties => ({
  background: "rgba(15, 23, 42, 0.65)",
  border: `1px solid ${palette.border}`,
  color: palette.text,
  borderRadius: 8,
  padding: "6px 8px",
  fontSize: 13,
  width: "100%",
  boxSizing: "border-box",
});

const checkboxLabelStyle = (palette: OverlaySettingsProps["palette"]): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 6,
  fontSize: 13,
  color: palette.text,
});

const sectionStyle = (palette: OverlaySettingsProps["palette"]): CSSProperties => ({
  borderTop: `1px solid ${palette.border}`,
  marginTop: 12,
  paddingTop: 12,
  display: "grid",
  gap: 10,
});

const subtleTextStyle = (palette: OverlaySettingsProps["palette"]): CSSProperties => ({
  fontSize: 12,
  color: palette.subtle,
});

const statusBadgeStyle = (palette: OverlaySettingsProps["palette"]): CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  padding: "3px 8px",
  borderRadius: 999,
  fontSize: 11,
  background: "rgba(59, 130, 246, 0.18)",
  color: palette.text,
});

const SCALE_STEP = 0.1;
const OPACITY_STEP = 0.05;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const MIN_OPACITY = 0.3;
const MAX_OPACITY = 1;

const OverlaySettingsPanel: FC<OverlaySettingsProps> = ({ overlayApi, palette }) => {
  const [overlayState, setOverlayState] = useState<OverlayState | null>(null);
  const [urlInput, setUrlInput] = useState("");
  const [dirtyUrl, setDirtyUrl] = useState(false);

  useEffect(() => {
    if (!overlayApi) return;
    let disposed = false;
    const applyState = (next: OverlayState) => {
      if (disposed) return;
      setOverlayState(next);
    };
    overlayApi.getState().then((state) => {
      if (!disposed && state) {
        applyState(state);
      }
    });
    const unsubscribe = overlayApi.onState(applyState);
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [overlayApi]);

  useEffect(() => {
    if (!overlayState) return;
    if (!dirtyUrl) {
      setUrlInput(overlayState.overlayUrl ?? "");
    }
  }, [overlayState, dirtyUrl]);

  const locked = overlayState?.locked ?? true;
  const visible = overlayState?.visible ?? false;
  const scalePercent = Math.round((overlayState?.scale ?? 1) * 100);
  const opacityPercent = Math.round((overlayState?.opacity ?? 1) * 100);
  const startWithApp = overlayState?.showOnLaunch ?? false;

  const handleShow = useCallback(() => {
    overlayApi?.show();
  }, [overlayApi]);

  const handleHide = useCallback(() => {
    overlayApi?.hide();
  }, [overlayApi]);

  const handleToggleLock = useCallback(() => {
    overlayApi?.setLocked(!locked);
  }, [overlayApi, locked]);

  const handleResetPosition = useCallback(() => {
    overlayApi?.resetBounds();
  }, [overlayApi]);

  const handleSetUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    overlayApi?.setOverlayUrl(trimmed);
    setDirtyUrl(false);
  }, [overlayApi, urlInput]);

  const handleTestUrl = useCallback(() => {
    const trimmed = urlInput.trim();
    if (!trimmed) return;
    try {
      window.open(trimmed, "_blank", "noopener");
    } catch {
      // ignore
    }
  }, [urlInput]);

  const applyScaleDelta = useCallback(
    (delta: number) => {
      const current = overlayState?.scale ?? 1;
      const next = clamp(Math.round((current + delta) * 100) / 100, MIN_SCALE, MAX_SCALE);
      overlayApi?.setScale(next);
    },
    [overlayApi, overlayState?.scale],
  );

  const applyOpacityDelta = useCallback(
    (delta: number) => {
      const current = overlayState?.opacity ?? 1;
      const next = clamp(Math.round((current + delta) * 100) / 100, MIN_OPACITY, MAX_OPACITY);
      overlayApi?.setOpacity(next);
    },
    [overlayApi, overlayState?.opacity],
  );

  const handleStartWithApp = useCallback(
    (value: boolean) => {
      overlayApi?.setShowOnLaunch(value);
    },
    [overlayApi],
  );

  const statusText = useMemo(() => {
    if (!overlayApi) return "Desktop overlay unavailable";
    if (!overlayState) return "Loading overlay state…";
    return `${visible ? "Visible" : "Hidden"} · ${locked ? "Locked" : "Unlocked"}`;
  }, [overlayApi, overlayState, visible, locked]);

  return (
    <div style={sectionStyle(palette)}>
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: palette.text }}>Overlay window</div>
        <div style={subtleTextStyle(palette)}>
          Configure the transparent desktop overlay. Use Ctrl+Alt+O to toggle visibility and Ctrl+Alt+M to
          lock or unlock editing.
        </div>
      </div>
      {!overlayApi && (
        <div style={subtleTextStyle(palette)}>
          Overlay controls require the Electron desktop build. Launch the desktop app to manage the overlay.
        </div>
      )}
      <div style={{ display: "grid", gap: 8 }}>
        <label style={{ fontSize: 12, color: palette.subtle }}>Overlay URL</label>
        <input
          value={urlInput}
          onChange={(event) => {
            setUrlInput(event.target.value);
            setDirtyUrl(true);
          }}
          placeholder="https://localhost:5173/?hud=1&overlay=tp"
          style={inputStyle(palette)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            style={accentButtonStyle(palette, !overlayApi)}
            disabled={!overlayApi}
            onClick={handleSetUrl}
          >
            Set overlay URL
          </button>
          <button
            type="button"
            style={buttonBaseStyle(palette, !overlayApi)}
            disabled={!overlayApi}
            onClick={handleTestUrl}
          >
            Test URL
          </button>
          <button
            type="button"
            style={buttonBaseStyle(palette, !overlayApi)}
            disabled={!overlayApi}
            onClick={() => overlayApi?.reload()}
          >
            Reload overlay
          </button>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={statusBadgeStyle(palette)}>{statusText}</span>
        <span style={subtleTextStyle(palette)}>Scale: {scalePercent}%</span>
        <span style={subtleTextStyle(palette)}>Opacity: {opacityPercent}%</span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <button type="button" style={accentButtonStyle(palette, !overlayApi)} disabled={!overlayApi} onClick={handleShow}>
          Show overlay
        </button>
        <button type="button" style={buttonBaseStyle(palette, !overlayApi)} disabled={!overlayApi} onClick={handleHide}>
          Hide overlay
        </button>
        <button
          type="button"
          style={buttonBaseStyle(palette, !overlayApi)}
          disabled={!overlayApi}
          onClick={handleToggleLock}
        >
          {locked ? "Unlock overlay" : "Lock overlay"}
        </button>
        <button
          type="button"
          style={buttonBaseStyle(palette, !overlayApi)}
          disabled={!overlayApi}
          onClick={handleResetPosition}
        >
          Reset position
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <span style={subtleTextStyle(palette)}>Scale</span>
        <button
          type="button"
          style={buttonBaseStyle(palette, !overlayApi)}
          disabled={!overlayApi}
          onClick={() => applyScaleDelta(-SCALE_STEP)}
        >
          –
        </button>
        <button
          type="button"
          style={buttonBaseStyle(palette, !overlayApi)}
          disabled={!overlayApi}
          onClick={() => applyScaleDelta(SCALE_STEP)}
        >
          +
        </button>
        <span style={{ ...subtleTextStyle(palette), marginLeft: 12 }}>Opacity</span>
        <button
          type="button"
          style={buttonBaseStyle(palette, !overlayApi)}
          disabled={!overlayApi}
          onClick={() => applyOpacityDelta(-OPACITY_STEP)}
        >
          –
        </button>
        <button
          type="button"
          style={buttonBaseStyle(palette, !overlayApi)}
          disabled={!overlayApi}
          onClick={() => applyOpacityDelta(OPACITY_STEP)}
        >
          +
        </button>
      </div>
      <label style={checkboxLabelStyle(palette)}>
        <input
          type="checkbox"
          checked={startWithApp}
          disabled={!overlayApi}
          onChange={(event) => handleStartWithApp(event.target.checked)}
        />
        Start overlay with the app
      </label>
      <div style={subtleTextStyle(palette)}>
        Tip: When the overlay is unlocked you can drag the header or use the corner grip to resize. Use Ctrl+Alt+=/-
        to scale and Ctrl+Alt+↑/↓ to adjust opacity.
      </div>
    </div>
  );
};

export default OverlaySettingsPanel;
