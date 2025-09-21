export type ResourceKind = "tp" | "rp";

export interface ResourceHistoryPoint {
  ts: number;
  value: number;
}

export type ResourceHistoryEventType = "spend" | "manual" | "reset";

export interface ResourceHistoryEvent {
  id: string;
  ts: number;
  kind: ResourceKind;
  type: ResourceHistoryEventType;
  value: number;
  delta?: number;
  note?: string;
}

export interface ResourceHistorySnapshot {
  points: ResourceHistoryPoint[];
  events: ResourceHistoryEvent[];
}

export interface ResourceHistoryState {
  tp: ResourceHistorySnapshot;
  rp: ResourceHistorySnapshot;
}

export interface ResourceHistoryEventInput {
  type: ResourceHistoryEventType;
  delta?: number;
  note?: string;
  force?: boolean;
}

export function createEmptyHistorySnapshot(): ResourceHistorySnapshot {
  return { points: [], events: [] };
}

export function createEmptyHistoryState(): ResourceHistoryState {
  return { tp: createEmptyHistorySnapshot(), rp: createEmptyHistorySnapshot() };
}
