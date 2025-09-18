import React from "react";

import { COLOR } from "../constants";
import { mixColor, withAlpha } from "../utils/color";

export interface CardProps {
  title: string;
  children: React.ReactNode;
}

export function Card({ title, children }: CardProps) {
  return (
    <div
      style={{
        background: `linear-gradient(150deg, ${withAlpha(mixColor(COLOR.card, COLOR.bg, 0.35), 0.97)} 0%, ${withAlpha(
          mixColor(COLOR.card, "#000000", 0.5),
          0.97
        )} 100%)`,
        border: `1px solid ${withAlpha(mixColor(COLOR.border, "#000000", 0.35), 0.85)}`,
        borderRadius: 14,
        padding: 14,
        boxShadow: `0 14px 32px ${withAlpha(mixColor(COLOR.card, "#000000", 0.55), 0.45)}`,
        marginBottom: 12,
        color: COLOR.text,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  );
}

export function RowRight({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
      {children}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <span style={{ fontSize: 13, color: COLOR.subtle, marginLeft: 6 }}>{children}</span>;
}

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}

export function Checkbox({ checked, onChange, label, disabled }: CheckboxProps) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        userSelect: "none",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span style={{ fontSize: 13 }}>{label}</span>
    </label>
  );
}

export interface ProgressBarProps {
  value: number;
  max: number;
  color: string;
}

export function ProgressBar({ value, max, color }: ProgressBarProps) {
  const pct = Math.round((value / max) * 100);
  const track = withAlpha(mixColor(color, COLOR.bg, 0.7), 0.4);
  const fill = `linear-gradient(90deg, ${withAlpha(mixColor(color, "#ffffff", 0.35), 0.9)} 0%, ${withAlpha(
    mixColor(color, "#000000", 0.1),
    0.95
  )} 100%)`;
  return (
    <div
      style={{
        width: "100%",
        height: 8,
        background: track,
        borderRadius: 999,
        overflow: "hidden",
        boxShadow: `inset 0 0 6px ${withAlpha("#000000", 0.3)}`,
      }}
    >
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          background: fill,
          transition: "width 0.3s ease",
        }}
      />
    </div>
  );
}

export interface SmallBtnProps {
  onClick: () => void;
  children: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}

export function SmallBtn({ onClick, children, danger, disabled }: SmallBtnProps) {
  const base = danger ? COLOR.danger : COLOR.slate700;
  const hover = mixColor(base, "#ffffff", 0.15);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "6px 12px",
        borderRadius: 999,
        background: base,
        color: COLOR.text,
        border: `1px solid ${withAlpha(mixColor(base, "#000000", 0.4), 0.9)}`,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        fontSize: 12,
        transition: "background 0.2s ease",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.background = hover;
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = base;
      }}
    >
      {children}
    </button>
  );
}

export interface InputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}

export function Input({ value, onChange, placeholder, type = "text" }: InputProps) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      style={{
        padding: "8px 12px",
        borderRadius: 10,
        border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
        background: COLOR.bg,
        color: COLOR.text,
        boxShadow: `0 4px 14px ${withAlpha("#000000", 0.28)}`,
        minWidth: 180,
      }}
    />
  );
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}

export function Select({ value, onChange, children }: SelectProps) {
  const optionBackground = withAlpha(mixColor(COLOR.bg, "#ffffff", 0.08), 0.8);

  const styledChildren = React.Children.map(children, (child) => {
    if (React.isValidElement(child) && child.type === "option") {
      return React.cloneElement(child, {
        style: {
          background: optionBackground,
          color: COLOR.text,
        },
      });
    }
    return child;
  });

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{
        padding: "6px 10px",
        borderRadius: 10,
        background: `linear-gradient(135deg, ${withAlpha(mixColor(COLOR.bg, "#ffffff", 0.08), 0.9)} 0%, ${withAlpha(
          mixColor(COLOR.bg, "#000000", 0.4),
          0.95
        )} 100%)`,
        backgroundColor: optionBackground,
        color: COLOR.text,
        border: `1px solid ${withAlpha(COLOR.border, 0.85)}`,
        boxShadow: `0 4px 14px ${withAlpha("#000000", 0.28)}`,
        minWidth: 150,
      }}
    >
      {styledChildren}
    </select>
  );
}
