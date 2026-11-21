import type { ExprFn } from "./expr";
import type { Marker, TransformStamped } from "./markers";
import type { XyCurve } from "./XyPane";

export type DataBus = {
  addPoint: (field: string, t: number, v: number) => void;
  addLog: (level: string, msg: string, ts?: number) => void;
  setImage: (name: string, objectUrl: string) => void;
  setStreams: (names: string[]) => void;
  setCurve: (channel: string, curve: XyCurve) => void;
  addMarker?: (marker: Marker) => void;
  addMarkers?: (markers: Marker[]) => void;
  addTf?: (tf: TransformStamped) => void;
  addTfs?: (tfs: TransformStamped[]) => void;
  loadReplay: (
    series: Record<string, [number, number][]>,
    logs: { t: number; ts?: number; level: string; msg: string }[],
    duration: number,
    markers?: { t: number; ts?: number; marker: Marker }[]
  ) => void;
  clear: () => void;
  resetView: () => void;
};

export type PanelKind = "plot" | "log" | "image" | "3d" | "xy";
export type PanelState = {
  id: string;
  kind: PanelKind;
  imgSel: string;
  xySel?: string;
  /** 本面板勾选的曲线。缺省则跟随全局 fields.on（默认左图）。 */
  plotOn?: Record<string, boolean>;
};
export type LogLine = { level: string; msg: string; ts?: number; t?: number };
export type LogLevels = { DEBUG: boolean; INFO: boolean; WARN: boolean; ERROR: boolean };
export type ViewMode = "sliding" | "centered" | "paused";
export type FieldMeta = { color: string; on: boolean };
export type WorkbenchFormula = {
  id: number;
  expr: string;
  source: string;
  enabled: boolean;
  fn?: ExprFn | null;
  color: string;
};
export type CameraPreset = { id: number; type: "reset" | "top" | "front" | "side" };

export const COLORS = ["#4fc3f7", "#ffb74d", "#81c784", "#e57373", "#ba68c8", "#4dd0e1", "#fff176", "#a1887f"];

export function fillEmptyImgSels(panels: PanelState[], fallback: string): PanelState[] {
  if (!fallback) return panels;
  let changed = false;
  const next = panels.map((panel) => {
    if (panel.kind !== "image" || panel.imgSel) return panel;
    changed = true;
    return { ...panel, imgSel: fallback };
  });
  return changed ? next : panels;
}

export function normLevel(level: string) {
  const upper = (level || "INFO").toUpperCase();
  if (upper === "WARNING") return "WARN";
  if (upper === "FATAL" || upper === "CRITICAL") return "ERROR";
  if (upper === "DEBUG" || upper === "INFO" || upper === "WARN" || upper === "ERROR") return upper;
  return "INFO";
}

export function fmtTs(ts?: number) {
  if (!ts) return "";
  const date = new Date(ts / 1e6);
  if (Number.isNaN(date.getTime())) return "";
  return date.toTimeString().slice(0, 8) + "." + String(date.getMilliseconds()).padStart(3, "0");
}
