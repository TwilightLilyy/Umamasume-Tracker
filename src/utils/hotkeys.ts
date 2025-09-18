import { HOTKEY_THROTTLE_MS } from "../constants";

export type HotkeyActionId = "tpSpend30" | "tpSpend1" | "rpSpend1" | "rpSpend5";

export interface HotkeyActionConfig {
  id: HotkeyActionId;
  label: string;
  resource: "tp" | "rp";
  amount: number;
  defaultBinding: string | null;
  verb: string;
}

export const HOTKEY_ACTIONS: HotkeyActionConfig[] = [
  { id: "tpSpend30", label: "Spend 30 TP", resource: "tp", amount: 30, defaultBinding: "t", verb: "Spent" },
  { id: "tpSpend1", label: "Spend 1 TP", resource: "tp", amount: 1, defaultBinding: null, verb: "Spent" },
  { id: "rpSpend1", label: "Use 1 RP", resource: "rp", amount: 1, defaultBinding: "r", verb: "Used" },
  { id: "rpSpend5", label: "Use 5 RP", resource: "rp", amount: 5, defaultBinding: null, verb: "Used" },
];

export type HotkeyBindings = Record<HotkeyActionId, string | null>;

export interface HotkeySettings {
  enabled: boolean;
  paused: boolean;
  allowRepeat: boolean;
  bindings: HotkeyBindings;
}

export const DEFAULT_HOTKEY_SETTINGS: HotkeySettings = {
  enabled: true,
  paused: false,
  allowRepeat: false,
  bindings: HOTKEY_ACTIONS.reduce((acc, action) => {
    acc[action.id] = action.defaultBinding;
    return acc;
  }, {} as HotkeyBindings),
};

export const HOTKEY_ACTION_LOOKUP = new Map<HotkeyActionId, HotkeyActionConfig>(
  HOTKEY_ACTIONS.map((action) => [action.id, action])
);

const MODIFIER_ORDER = ["ctrl", "alt", "shift", "meta"] as const;
type ModifierKey = (typeof MODIFIER_ORDER)[number];
const MODIFIER_SET = new Set<ModifierKey>(MODIFIER_ORDER);

function canonicalKeyName(key: string | null | undefined) {
  if (!key) return null;
  const lower = key.toLowerCase();
  if (lower === "" || lower === "dead" || lower === "unidentified") return null;
  if (lower === " ") return "space";
  if (lower === "spacebar") return "space";
  if (lower === "escape") return "esc";
  if (lower === "os") return "meta";
  return lower;
}

export function normalizeBindingString(binding: string | null | undefined): string | null {
  if (!binding) return null;
  const parts = binding
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part.length > 0);
  if (!parts.length) return null;
  const modifiers: ModifierKey[] = [];
  let keyPart: string | null = null;
  for (const part of parts) {
    if (MODIFIER_SET.has(part as ModifierKey)) {
      const mod = part as ModifierKey;
      if (!modifiers.includes(mod)) modifiers.push(mod);
      continue;
    }
    keyPart = canonicalKeyName(part);
  }
  if (!keyPart) return null;
  if (MODIFIER_SET.has(keyPart as ModifierKey)) return null;
  const orderedModifiers = MODIFIER_ORDER.filter((mod) => modifiers.includes(mod));
  return [...orderedModifiers, keyPart].join("+");
}

export function bindingFromEvent(event: KeyboardEvent): string | null {
  const modifiers: ModifierKey[] = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("meta");
  const keyPart = canonicalKeyName(event.key);
  if (!keyPart) return null;
  if (MODIFIER_SET.has(keyPart as ModifierKey) && modifiers.length === 0) return null;
  const orderedModifiers = MODIFIER_ORDER.filter((mod) => modifiers.includes(mod));
  return normalizeBindingString([...orderedModifiers, keyPart].join("+"));
}

export function formatBinding(binding: string | null) {
  if (!binding) return "Unassigned";
  const parts = binding.split("+");
  return parts
    .map((part) => {
      if (part === "ctrl") return "Ctrl";
      if (part === "alt") return "Alt";
      if (part === "shift") return "Shift";
      if (part === "meta") return "Meta";
      if (part === "space") return "Space";
      if (part === "esc") return "Esc";
      if (part.length === 1) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" + ");
}

export function sanitizeHotkeySettings(settings: HotkeySettings | null | undefined) {
  const base = settings && typeof settings === "object" ? settings : DEFAULT_HOTKEY_SETTINGS;
  const sanitized: HotkeySettings = {
    enabled: !!base.enabled,
    paused: !!base.paused,
    allowRepeat: !!base.allowRepeat,
    bindings: { ...DEFAULT_HOTKEY_SETTINGS.bindings },
  };
  for (const action of HOTKEY_ACTIONS) {
    const normalized = normalizeBindingString(base.bindings?.[action.id] ?? action.defaultBinding);
    sanitized.bindings[action.id] = normalized;
  }
  return sanitized;
}

export function hotkeySettingsEqual(a: HotkeySettings, b: HotkeySettings) {
  if (a.enabled !== b.enabled || a.paused !== b.paused || a.allowRepeat !== b.allowRepeat) return false;
  for (const action of HOTKEY_ACTIONS) {
    if ((a.bindings[action.id] ?? null) !== (b.bindings[action.id] ?? null)) return false;
  }
  return true;
}

export function isEditableElement(element: Element | null) {
  if (!element) return false;
  if (element instanceof HTMLInputElement) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLElement && element.isContentEditable) return true;
  return false;
}

export function hasActiveModal() {
  if (typeof document === "undefined") return false;
  const ariaModal = document.querySelector('[aria-modal="true"]:not([aria-hidden="true"])');
  if (ariaModal) return true;
  const openDialog = document.querySelector("dialog[open]");
  if (openDialog) return true;
  const roleDialog = document.querySelector('[role="dialog"]:not([aria-hidden="true"])');
  return !!roleDialog;
}

export function shouldIgnoreHotkeyEvent(event: KeyboardEvent) {
  const target = event.target as Element | null;
  if (isEditableElement(target)) return true;
  const active = typeof document !== "undefined" ? document.activeElement : null;
  if (isEditableElement(active)) return true;
  if (hasActiveModal()) return true;
  return false;
}

export { HOTKEY_THROTTLE_MS };
