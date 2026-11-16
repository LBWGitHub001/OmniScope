import type { ExprFn } from "../../shared/workbench/expr";

export type SymbolRow = {
  name: string;
  addr?: string;
  size?: number;
  words?: string[];
  u32?: number;
  i32?: number;
  f32?: number | null;
  rtt_ms?: number;
  error?: string | null;
  t?: number;
};

export type SwdSnapshot = {
  phase: string;
  message: string;
  project: string;
  elf?: string | null;
  hz: number;
  host: string;
  telnet_port?: number | null;
  symbols: SymbolRow[];
  stats: {
    ok: number;
    fail: number;
    hz: number;
    rtt_p50: number;
    rtt_p95: number;
  };
  rate_limit_bps?: number;
  bps_used?: number;
  omniscope?: {
    plot_addr?: string | null;
    watch_addr?: string | null;
    mailbox_addr?: string | null;
    plot_ok?: boolean;
    watch_ok?: boolean;
    plot_channels?: { index: number; name: string; active: boolean }[];
    plot_dropped?: number;
    watch_count?: number;
  };
  recording?: boolean;
  log?: string;
};

export type ElfMatch = {
  name: string;
  addr: number;
  size: number;
  file?: string;
};

export type WatchEntry = {
  index: number;
  name: string;
  ptr: number;
  elem_type: number;
  elem_name: string;
  elem_size: number;
  kind: number; // 0=monitor 1=param
  access: number; // 0=RO 1=RW
  rows: number;
  cols: number;
  version: number;
  min: number;
  max: number;
  step: number;
  is_array: boolean;
  nbytes: number;
};

export type WatchArrayPayload = {
  rows: number;
  cols: number;
  elemType: number;
  min: number;
  max: number;
  values: ArrayLike<number>;
  t: number;
};

export type FormulaItem = {
  id: number;
  expr: string;
  source: string;
  enabled: boolean;
  fn?: ExprFn | null;
  error?: string | null;
  color: string;
};

export type FieldMode = "f32" | "i32" | "u32" | "hex";
export type WriteStatus = "ok" | "err";
export type HistoryPoint = { t: number; v: number };
export type SerialPort = { device: string; description: string };
export type SerialLog = { dir: string; text: string };
