import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  Legend,
} from "chart.js";
import zoomPlugin from "chartjs-plugin-zoom";
import Hammer from "hammerjs";
import { compileExpr, type ExprFn } from "./expr";
import { type Marker } from "./markers";
import { Scene3DView, type Scene3DStats } from "./Scene3DView";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend, zoomPlugin);
(window as unknown as { Hammer: typeof Hammer }).Hammer = Hammer;

export type DataBus = {
  addPoint: (field: string, t: number, v: number) => void;
  addLog: (level: string, msg: string, ts?: number) => void;
  setImage: (name: string, objectUrl: string) => void;
  setStreams: (names: string[]) => void;
  addMarker?: (m: Marker) => void;
  addMarkers?: (ms: Marker[]) => void;
  loadReplay: (
    series: Record<string, [number, number][]>,
    logs: { t: number; ts?: number; level: string; msg: string }[],
    duration: number,
    markers?: { t: number; ts?: number; marker: Marker }[]
  ) => void;
  clear: () => void;
  resetView: () => void;
};

type PanelKind = "plot" | "log" | "image" | "3d";
type PanelState = { kind: PanelKind; imgSel: string };
type LogLine = { level: string; msg: string; ts?: number; t?: number };
type ViewMode = "sliding" | "centered" | "paused";

const COLORS = [
  "#00f0ff", // Cyber Cyan
  "#10b981", // Emerald Green
  "#f59e0b", // Laser Amber
  "#8b5cf6", // Electric Violet
  "#ec4899", // Neon Pink
  "#06b6d4", // Electric Teal
  "#eab308", // Yellow
  "#3b82f6", // Quantum Blue
];

function fillEmptyImgSels(panels: PanelState[], fallback: string): PanelState[] {
  if (!fallback) return panels;
  let changed = false;
  const next = panels.map((p) => {
    if (p.kind !== "image" || p.imgSel) return p;
    changed = true;
    return { ...p, imgSel: fallback };
  });
  return changed ? next : panels;
}

function normLevel(lv: string) {
  const u = (lv || "INFO").toUpperCase();
  if (u === "WARNING") return "WARN";
  if (u === "FATAL" || u === "CRITICAL") return "ERROR";
  if (u === "DEBUG" || u === "INFO" || u === "WARN" || u === "ERROR") return u;
  return "INFO";
}

function fmtTs(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts / 1e6);
  if (Number.isNaN(d.getTime())) return "";
  return d.toTimeString().slice(0, 8) + "." + String(d.getMilliseconds()).padStart(3, "0");
}

export function DebugWorkbench({
  busOut,
  imageSubscribe,
  replay = false,
  cursorT = null,
  onSeek,
}: {
  busOut: (bus: DataBus) => void;
  imageSubscribe?: (names: string[]) => void;
  replay?: boolean;
  cursorT?: number | null;
  onSeek?: (t: number) => void;
}) {
  const [panels, setPanels] = useState<PanelState[]>([
    { kind: "plot", imgSel: "" },
    { kind: "3d", imgSel: "" },
    { kind: "image", imgSel: "" },
    { kind: "log", imgSel: "" },
  ]);
  const [layoutMode, setLayoutMode] = useState<"grid" | "horizontal">("grid");
  const [prevPanels, setPrevPanels] = useState<PanelState[] | null>(null);

  const applyGrid4 = useCallback(() => {
    setPanels([
      { kind: "plot", imgSel: "" },
      { kind: "3d", imgSel: "" },
      { kind: "image", imgSel: "" },
      { kind: "log", imgSel: "" },
    ]);
    setLayoutMode("grid");
    setPrevPanels(null);
  }, []);
  const [sidebar, setSidebar] = useState(true);
  const [selectedPaneIdx, setSelectedPaneIdx] = useState<number>(0);
  const [show3DGrid, setShow3DGrid] = useState<boolean>(true);
  const [gridSize3D, setGridSize3D] = useState<number>(20);
  const [show3DAxes, setShow3DAxes] = useState<boolean>(true);
  const [selectedNsFilter, setSelectedNsFilter] = useState<string>("all");
  const [visibleNs, setVisibleNs] = useState<Record<string, boolean>>({});
  const [visibleObjects, setVisibleObjects] = useState<Record<string, boolean>>({});
  const [cameraPreset, setCameraPreset] = useState<{ id: number; type: "reset" | "top" | "front" | "side" } | null>(null);
  const [scene3DStats, setScene3DStats] = useState<Scene3DStats>({
    count: 0,
    namespaces: {},
    types: {},
    objects: [],
  });
  const [mode, setMode] = useState<ViewMode>("sliding");
  const [win, setWin] = useState(10);
  const [history, setHistory] = useState(60);
  const [fields, setFields] = useState<Record<string, { color: string; on: boolean }>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logLevels, setLogLevels] = useState<{ DEBUG: boolean; INFO: boolean; WARN: boolean; ERROR: boolean }>({
    DEBUG: true,
    INFO: true,
    WARN: true,
    ERROR: true,
  });
  const [logFilterText, setLogFilterText] = useState("");
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [logShowTs, setLogShowTs] = useState(true);
  const [maxLogBuffer, setMaxLogBuffer] = useState(2000);
  const maxLogBufferRef = useRef(maxLogBuffer);
  maxLogBufferRef.current = maxLogBuffer;

  // Image viewport controls & settings
  const [imgScale, setImgScale] = useState(1);
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 });
  const [showImgCrosshair, setShowImgCrosshair] = useState(true);
  const [showImgHudInfo, setShowImgHudInfo] = useState(true);
  const [imgSmooth, setImgSmooth] = useState(true);

  const logStats = useMemo(() => {
    let debug = 0;
    let info = 0;
    let warn = 0;
    let error = 0;
    for (let i = 0; i < logs.length; i++) {
      const lv = normLevel(logs[i].level);
      if (lv === "DEBUG") debug++;
      else if (lv === "INFO") info++;
      else if (lv === "WARN") warn++;
      else if (lv === "ERROR") error++;
    }
    return { debug, info, warn, error, total: logs.length };
  }, [logs]);

  const visibleLogCount = useMemo(() => {
    let re: RegExp | null = null;
    if (logFilterText.trim()) {
      try {
        re = new RegExp(logFilterText.trim(), "i");
      } catch {
        re = null;
      }
    }
    const q = logFilterText.trim().toLowerCase();
    return logs.filter((l) => {
      if (!logLevels[normLevel(l.level) as keyof typeof logLevels]) return false;
      if (!q) return true;
      if (re) return re.test(l.msg) || re.test(l.level);
      return l.msg.toLowerCase().includes(q) || normLevel(l.level).toLowerCase().includes(q);
    }).length;
  }, [logs, logLevels, logFilterText]);

  const exportLogs = useCallback(() => {
    if (logs.length === 0) return;
    const content = logs
      .map((l) => {
        const ts = l.t != null ? `${l.t.toFixed(3)}s` : l.ts ? fmtTs(l.ts) : "";
        return `[${ts}] [${normLevel(l.level)}] ${l.msg}`;
      })
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `omniscope_logs_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);
  const [images, setImages] = useState<Record<string, string>>({});
  const [streams, setStreams] = useState<string[]>([]);
  const [manual, setManual] = useState(false);
  const manualRef = useRef(false);
  const kinds = panels.map((p) => p.kind);

  const displayed3DObjects = useMemo(() => {
    if (selectedNsFilter === "all") return scene3DStats.objects || [];
    return (scene3DStats.objects || []).filter((obj) => obj.ns === selectedNsFilter);
  }, [scene3DStats.objects, selectedNsFilter]);

  type WorkbenchFormula = {
    id: number;
    expr: string;
    source: string;
    enabled: boolean;
    fn?: ExprFn | null;
    color: string;
  };
  const [formulas, setFormulas] = useState<WorkbenchFormula[]>([]);
  const [formulaDraft, setFormulaDraft] = useState("");
  const [formulaSource, setFormulaSource] = useState("");
  const [markers, setMarkers] = useState<Marker[]>([]);
  const formulasRef = useRef(formulas);
  formulasRef.current = formulas;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const seriesRef = useRef<Record<string, { x: number; y: number }[]>>({});
  const fieldsRef = useRef(fields);
  const viewRef = useRef({ mode, win, history, manual });
  const lastX = useRef(0);
  const colorN = useRef(0);
  const logBuf = useRef<LogLine[]>([]);
  const imgBuf = useRef<Record<string, string>>({});
  const streamBuf = useRef<string[]>([]);
  const markerBuf = useRef<Marker[]>([]);
  const chartDirty = useRef(false);
  const rafRef = useRef(0);
  const replayRef = useRef(replay);
  const cursorRef = useRef<number | null>(cursorT);
  const seekRef = useRef(onSeek);
  const dragCursor = useRef(false);
  const mouseX = useRef(0);
  replayRef.current = replay;
  cursorRef.current = cursorT;
  seekRef.current = onSeek;

  fieldsRef.current = fields;
  // manual 由滚轮/拖动立刻写入。不能在这里用 state 覆盖，否则下一帧数据会把缩放清掉。
  viewRef.current = { ...viewRef.current, mode, win, history };

  const syncChart = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const meta = fieldsRef.current;
    const labels = Object.keys(seriesRef.current).filter((k) => meta[k]?.on !== false);
    const normalDatasets = labels.map((label) => ({
      label,
      data: seriesRef.current[label],
      borderColor: meta[label]?.color || COLORS[0],
      backgroundColor: meta[label]?.color || COLORS[0],
      pointRadius: 0,
      borderWidth: 1.6,
    }));

    const formulaDatasets = formulasRef.current
      .filter((f) => f.enabled && f.fn && f.source && seriesRef.current[f.source])
      .map((f) => {
        const rawPts = seriesRef.current[f.source] || [];
        const data = rawPts
          .map((pt) => {
            const y = f.fn!(pt.y);
            return Number.isFinite(y) ? { x: pt.x, y } : null;
          })
          .filter(Boolean);
        return {
          label: `f(x): ${f.expr} [x=${f.source}]`,
          data: data as any,
          borderColor: f.color,
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.6,
          borderDash: [5, 4],
        };
      });

    chart.data.datasets = [...normalDatasets, ...formulaDatasets];
    const v = viewRef.current;
    const follow = replayRef.current && cursorRef.current != null ? cursorRef.current : lastX.current;
    if (!v.manual && v.mode !== "paused") {
      const w = v.win || 10;
      if (v.mode === "centered") {
        chart.options.scales!.x!.min = follow - w / 2;
        chart.options.scales!.x!.max = follow + w / 2;
      } else {
        chart.options.scales!.x!.min = Math.max(0, follow - w);
        chart.options.scales!.x!.max = Math.max(w, follow);
      }
    }
    chart.update("none");
  }, []);

  const flush = useCallback(() => {
    rafRef.current = 0;
    if (chartDirty.current) {
      chartDirty.current = false;
      syncChart();
    }
    if (logBuf.current.length) {
      const batch = logBuf.current;
      logBuf.current = [];
      setLogs((prev) => {
        const next = prev.concat(batch);
        const limit = maxLogBufferRef.current || 2000;
        return next.length > limit ? next.slice(-Math.floor(limit * 0.8)) : next;
      });
    }
    const pending = imgBuf.current;
    const pendingNames = Object.keys(pending);
    if (pendingNames.length) {
      imgBuf.current = {};
      setImages((prev) => {
        const next = { ...prev };
        for (const name of pendingNames) {
          const url = pending[name];
          const old = next[name];
          if (old && old.startsWith("blob:") && old !== url) URL.revokeObjectURL(old);
          next[name] = url;
        }
        return next;
      });
      setPanels((prev) => fillEmptyImgSels(prev, pendingNames[pendingNames.length - 1]));
    }
    if (streamBuf.current.length) {
      const list = streamBuf.current;
      streamBuf.current = [];
      setStreams((prev) => {
        const s = new Set(prev);
        list.forEach((n) => s.add(n));
        return [...s].sort();
      });
      setPanels((prev) => fillEmptyImgSels(prev, list[0] || ""));
    }
    if (markerBuf.current.length) {
      const batch = markerBuf.current;
      markerBuf.current = [];
      setMarkers(batch);
    }
  }, [syncChart]);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const addFormula = () => {
    const expr = formulaDraft.trim();
    if (!expr) return;
    const names = Object.keys(fieldsRef.current);
    const src = formulaSource || names[0] || "";
    if (!src) {
      alert("请先选择自变量 x 来源");
      return;
    }
    try {
      const fn = compileExpr(expr);
      setFormulas((prev) => [
        ...prev,
        {
          id: Date.now(),
          expr,
          source: src,
          enabled: true,
          fn,
          color: COLORS[(prev.length + 4) % COLORS.length],
        },
      ]);
      setFormulaDraft("");
      chartDirty.current = true;
      schedule();
    } catch (e) {
      alert(`公式语法错误: ${e}`);
    }
  };

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  useEffect(() => {
    chartDirty.current = true;
    schedule();
  }, [mode, win, history, manual, fields, cursorT, schedule]);

  const plotIndex = kinds.indexOf("plot");

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (plotIndex < 0 || !canvas || !host) return;
    const chart = new Chart(canvas, {
      type: "line",
      plugins: [
        {
          id: "replayCursor",
          afterDraw(ch) {
            const t = cursorRef.current;
            if (!replayRef.current || t == null || !Number.isFinite(t)) return;
            const xScale = ch.scales.x;
            if (!xScale) return;
            const x = xScale.getPixelForValue(t);
            const area = ch.chartArea;
            if (x < area.left - 2 || x > area.right + 2) return;
            const ctx = ch.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x, area.top);
            ctx.lineTo(x, area.bottom);
            ctx.lineWidth = dragCursor.current ? 2.5 : 1.5;
            ctx.strokeStyle = "#ff7043";
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(x, area.top);
            ctx.lineTo(x - 6, area.top - 7);
            ctx.lineTo(x + 6, area.top - 7);
            ctx.closePath();
            ctx.fillStyle = "#ff7043";
            ctx.fill();
            ctx.restore();
          },
        },
      ],
      data: { datasets: [] },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        onClick(evt, _els, ch) {
          if (!replayRef.current || !seekRef.current || dragCursor.current) return;
          const xScale = ch.scales.x;
          if (!xScale || evt.x == null) return;
          const cur = cursorRef.current;
          if (cur != null) {
            const cx = xScale.getPixelForValue(cur);
            if (Math.abs(evt.x - cx) <= 12) return;
          }
          const t = xScale.getValueForPixel(evt.x);
          if (t != null && Number.isFinite(t)) seekRef.current(t);
        },
        plugins: {
          legend: { display: false },
          zoom: {
            pan: {
              enabled: true,
              mode: "x" as const,
              overScaleMode: "y" as const,
              onPanStart: () => {
                if (dragCursor.current) return false;
                viewRef.current = { ...viewRef.current, manual: true };
                setManual(true);
              },
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: () => (mouseX.current < 50 ? "y" : "x"),
              overScaleMode: "y" as const,
              onZoomStart: () => {
                if (dragCursor.current) return false;
                viewRef.current = { ...viewRef.current, manual: true };
                setManual(true);
              },
            },
            limits: { x: { min: 0 } },
          },
        },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: 10,
            ticks: { color: "#8e8e9c", font: { size: 11, family: "ui-monospace, monospace" } },
            grid: { color: "rgba(255,255,255,0.06)" },
            border: { color: "rgba(255,255,255,0.08)" },
          },
          y: {
            type: "linear",
            ticks: { color: "#8e8e9c", font: { size: 11, family: "ui-monospace, monospace" } },
            grid: { color: "rgba(255,255,255,0.06)" },
            border: { color: "rgba(255,255,255,0.08)" },
          },
        },
      },
    });
    chartRef.current = chart;
    const onMove = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      mouseX.current = e.clientX - r.left;
    };
    canvas.addEventListener("mousemove", onMove);
    let lastW = 0;
    let lastH = 0;
    const fit = () => {
      const w = Math.floor(host.clientWidth);
      const h = Math.floor(host.clientHeight);
      if (w < 2 || h < 2) return;
      if (Math.abs(w - lastW) <= 1 && Math.abs(h - lastH) <= 1) return;
      lastW = w;
      lastH = h;
      chart.resize(w, h);
    };
    const ro = new ResizeObserver(() => fit());
    ro.observe(host);
    fit();
    syncChart();
    return () => {
      canvas.removeEventListener("mousemove", onMove);
      ro.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
  }, [plotIndex, syncChart]);

  const names = [...new Set([...streams, ...Object.keys(images)])].sort();
  const wantedImgs = [
    ...new Set(
      panels
        .filter((p) => p.kind === "image")
        .map((p) => p.imgSel || names[0] || "")
        .filter(Boolean)
    ),
  ].sort();

  const wantedKey = wantedImgs.join("\0");
  useEffect(() => {
    if (!imageSubscribe) return;
    imageSubscribe(wantedKey ? wantedKey.split("\0") : []);
  }, [wantedKey, imageSubscribe]);

  const bus = useMemo<DataBus>(() => {
    return {
      addPoint(field, t, v) {
        if (!seriesRef.current[field]) seriesRef.current[field] = [];
        const arr = seriesRef.current[field];
        arr.push({ x: t, y: v });
        lastX.current = t;
        if (!replayRef.current) {
          const hist = viewRef.current.history || 60;
          const cut = t - hist;
          while (arr.length > 1 && arr[0].x < cut) arr.shift();
          if (arr.length > 8000) arr.splice(0, arr.length - 6000);
        }
        if (!fieldsRef.current[field]) {
          const color = COLORS[colorN.current % COLORS.length];
          colorN.current += 1;
          const on = Object.keys(fieldsRef.current).length < 6;
          fieldsRef.current = { ...fieldsRef.current, [field]: { color, on } };
          setFields(fieldsRef.current);
        }
        chartDirty.current = true;
        schedule();
      },
      addLog(level, msg, ts) {
        logBuf.current.push({ level, msg, ts });
        if (logBuf.current.length > 2000) logBuf.current.splice(0, logBuf.current.length - 1600);
        schedule();
      },
      setImage(name, objectUrl) {
        const queued = imgBuf.current[name];
        if (queued && queued.startsWith("blob:") && queued !== objectUrl) URL.revokeObjectURL(queued);
        imgBuf.current[name] = objectUrl;
        schedule();
      },
      setStreams(names) {
        streamBuf.current.push(...names);
        schedule();
      },
      addMarker(m) {
        markerBuf.current.push(m);
        schedule();
      },
      addMarkers(ms) {
        markerBuf.current.push(...ms);
        schedule();
      },
      loadReplay(series, logs, duration, replayMarkers) {
        const nextSeries: Record<string, { x: number; y: number }[]> = {};
        const nextFields = { ...fieldsRef.current };
        for (const [field, pts] of Object.entries(series || {})) {
          nextSeries[field] = pts.map(([x, y]) => ({ x, y }));
          if (!nextFields[field]) {
            nextFields[field] = {
              color: COLORS[colorN.current % COLORS.length],
              on: Object.keys(nextFields).length < 6,
            };
            colorN.current += 1;
          }
        }
        seriesRef.current = nextSeries;
        fieldsRef.current = nextFields;
        lastX.current = duration;
        setFields(nextFields);
        logBuf.current = [];
        setLogs(
          (logs || []).map((l) => ({
            level: l.level,
            msg: l.msg,
            ts: l.ts,
            t: l.t,
          }))
        );
        if (replayMarkers) {
          setMarkers(replayMarkers.map((rm) => rm.marker));
        }
        chartDirty.current = true;
        schedule();
      },
      clear() {
        seriesRef.current = {};
        lastX.current = 0;
        logBuf.current = [];
        setMarkers([]);
        chartDirty.current = false;
        Object.values(imgBuf.current).forEach((u) => {
          if (u.startsWith("blob:")) URL.revokeObjectURL(u);
        });
        imgBuf.current = {};
        if (chartRef.current) {
          chartRef.current.data.datasets = [];
          chartRef.current.update("none");
        }
        setLogs([]);
        setImages((prev) => {
          Object.values(prev).forEach((u) => {
            if (u.startsWith("blob:")) URL.revokeObjectURL(u);
          });
          return {};
        });
      },
      resetView() {
        viewRef.current = { ...viewRef.current, manual: false };
        setManual(false);
        const chart = chartRef.current as (Chart & { resetZoom?: () => void }) | null;
        chart?.resetZoom?.();
        chartDirty.current = true;
        schedule();
      },
    };
  }, [schedule]);

  useEffect(() => {
    busOut(bus);
  }, [bus, busOut]);

  const clampedSelectedIdx = Math.min(selectedPaneIdx, Math.max(0, panels.length - 1));
  const activePanel = panels[clampedSelectedIdx] || panels[0];
  const activeKind = activePanel?.kind || "plot";
  const currentImgSel = activePanel?.imgSel || names[0] || "";

  const handleSetImageStream = (streamName: string) => {
    setPanels((prev) => {
      const next = [...prev];
      if (next[clampedSelectedIdx]) {
        next[clampedSelectedIdx] = { ...next[clampedSelectedIdx], imgSel: streamName };
      }
      return next;
    });
    setImgScale(1);
    setImgPan({ x: 0, y: 0 });
  };

  return (
    <div className="workbench-root">
      <aside className={sidebar ? "dbg-side" : "dbg-side collapsed"}>
        <button type="button" className="side-toggle" onClick={() => setSidebar((s) => !s)}>
          {sidebar ? "◀" : "▶"}
        </button>
        {sidebar && (
          <div className="side-body">
            <div className="side-title">
              {activeKind === "plot" && "曲线绘图设置"}
              {activeKind === "3d" && "3D 空间设置"}
              {activeKind === "image" && "实时图像设置"}
              {activeKind === "log" && "运行日志设置"}
            </div>

            {/* Plot Context Settings */}
            {activeKind === "plot" && (
              <>
                <div className="side-sec">
                  <div className="side-h">显示模式</div>
                  {(["sliding", "centered", "paused"] as ViewMode[]).map((m) => (
                    <label key={m}>
                      <input
                        type="radio"
                        name={replay ? "view-mode-replay" : "view-mode-watch"}
                        checked={mode === m}
                        onChange={() => setMode(m)}
                      />
                      {m === "sliding" ? "滑动" : m === "centered" ? "居中" : "暂停"}
                    </label>
                  ))}
                </div>
                <div className="side-sec">
                  <div className="side-h">窗口 (秒)</div>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={win}
                    onChange={(e) => setWin(Number(e.target.value) || 10)}
                  />
                </div>
                <div className="side-sec">
                  <div className="side-h">历史</div>
                  <select value={history} onChange={(e) => setHistory(Number(e.target.value))}>
                    <option value={30}>30 秒</option>
                    <option value={60}>1 分钟</option>
                    <option value={120}>2 分钟</option>
                    <option value={300}>5 分钟</option>
                  </select>
                </div>
                <div className="side-sec">
                  <div className="side-h">数据字段</div>
                  {Object.keys(fields).length === 0 && <span className="muted">等待数据…</span>}
                  {Object.entries(fields).map(([name, meta]) => (
                    <label key={name} className="field-row">
                      <input
                        type="checkbox"
                        checked={meta.on}
                        onChange={(e) =>
                          setFields((prev) => ({ ...prev, [name]: { ...prev[name], on: e.target.checked } }))
                        }
                      />
                      <span className="swatch" style={{ background: meta.color }} />
                      {name}
                    </label>
                  ))}
                </div>
                <div className="side-sec">
                  <div className="side-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>虚拟公式通道 ƒ(x)</span>
                    <span className="mono" style={{ color: "var(--cyan)", fontSize: "10px" }}>
                      {formulas.length}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <input
                      style={{ fontSize: "11px", padding: "3px 6px", width: "100%" }}
                      placeholder="如: sin(x)  2x  x*57.3"
                      value={formulaDraft}
                      onChange={(e) => setFormulaDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") addFormula();
                      }}
                    />
                    <div style={{ display: "flex", gap: "4px" }}>
                      <select
                        style={{ flex: 1, fontSize: "11px", height: "24px", minWidth: 0 }}
                        value={formulaSource}
                        onChange={(e) => setFormulaSource(e.target.value)}
                      >
                        <option value="">选 x 来源...</option>
                        {Object.keys(fields).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        style={{ padding: "0 8px", height: "24px", fontSize: "11px" }}
                        onClick={addFormula}
                      >
                        +
                      </button>
                    </div>

                    {formulas.map((f) => (
                      <div
                        key={f.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          fontSize: "11px",
                          padding: "2px 0",
                        }}
                      >
                        <label style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer", overflow: "hidden" }}>
                          <input
                            type="checkbox"
                            checked={f.enabled}
                            onChange={() => {
                              setFormulas((prev) =>
                                prev.map((item) => (item.id === f.id ? { ...item, enabled: !item.enabled } : item))
                              );
                              chartDirty.current = true;
                              schedule();
                            }}
                          />
                          <span className="swatch" style={{ background: f.color }} />
                          <span
                            className="mono"
                            style={{ color: f.color, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                            title={`${f.expr} [x=${f.source}]`}
                          >
                            {f.expr}
                          </span>
                        </label>
                        <button
                          type="button"
                          className="ghost"
                          style={{ padding: "0 3px", fontSize: "11px" }}
                          onClick={() => {
                            setFormulas((prev) => prev.filter((item) => item.id !== f.id));
                            chartDirty.current = true;
                            schedule();
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* 3D Context Settings */}
            {activeKind === "3d" && (
              <>
                <div className="side-sec">
                  <div className="side-h">坐标系基准</div>
                  <div style={{ fontSize: 11, fontFamily: "var(--mono)", color: "var(--cyan)", marginBottom: 6 }}>
                    参考系: base_link
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", flexDirection: "column", gap: 3, margin: "6px 0" }}>
                    <div><b style={{ color: "#f43f5e" }}>X 轴</b>：车辆前向 (Red)</div>
                    <div><b style={{ color: "#10b981" }}>Y 轴</b>：车辆左向 (Green)</div>
                    <div><b style={{ color: "#00f0ff" }}>Z 轴</b>：车辆天向 (Cyan)</div>
                  </div>
                  <label style={{ fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
                    <input type="checkbox" checked={show3DAxes} onChange={(e) => setShow3DAxes(e.target.checked)} />
                    显示三轴立体指示箭头
                  </label>
                  <label style={{ fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <input type="checkbox" checked={show3DGrid} onChange={(e) => setShow3DGrid(e.target.checked)} />
                    显示基准网格
                  </label>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                    <div style={{ marginBottom: 4 }}>网格尺寸</div>
                    <select value={gridSize3D} onChange={(e) => setGridSize3D(Number(e.target.value))}>
                      <option value={10}>10 米 (10×10)</option>
                      <option value={20}>20 米 (20×20)</option>
                      <option value={50}>50 米 (50×50)</option>
                    </select>
                  </div>
                </div>

                <div className="side-sec">
                  <div className="side-h" style={{ marginBottom: 4 }}>
                    命名空间与物体过滤
                  </div>
                  <select
                    style={{ width: "100%", fontSize: "11px", height: "26px", padding: "0 6px", margin: "4px 0 8px" }}
                    value={selectedNsFilter}
                    onChange={(e) => setSelectedNsFilter(e.target.value)}
                  >
                    <option value="all">所有命名空间 ({scene3DStats.objects?.length || 0} 物体)</option>
                    {Object.entries(scene3DStats.namespaces).map(([ns, cnt]) => (
                      <option key={ns} value={ns}>
                        {ns} ({cnt} 物体)
                      </option>
                    ))}
                  </select>

                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <span style={{ fontSize: "11px", color: "var(--faint)" }}>
                      {selectedNsFilter === "all" ? "全部图元" : `「${selectedNsFilter}」图元`} ({displayed3DObjects.length})
                    </span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "0 6px", height: "18px", fontSize: "10px" }}
                        onClick={() => {
                          const next = { ...visibleObjects };
                          displayed3DObjects.forEach((obj) => {
                            next[obj.key] = true;
                          });
                          setVisibleObjects(next);
                          if (selectedNsFilter !== "all") {
                            setVisibleNs((prev) => ({ ...prev, [selectedNsFilter]: true }));
                          }
                        }}
                      >
                        全显
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "0 6px", height: "18px", fontSize: "10px" }}
                        onClick={() => {
                          const next = { ...visibleObjects };
                          displayed3DObjects.forEach((obj) => {
                            next[obj.key] = false;
                          });
                          setVisibleObjects(next);
                        }}
                      >
                        全隐
                      </button>
                    </div>
                  </div>

                  {displayed3DObjects.length === 0 ? (
                    <span className="muted" style={{ fontSize: 11 }}>等待 3D 数据…</span>
                  ) : (
                    <div
                      className="object-list-container"
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        maxHeight: "180px",
                        overflowY: "auto",
                        overflowX: "hidden",
                        paddingRight: "2px",
                      }}
                    >
                      {displayed3DObjects.map((obj) => {
                        const isChecked = (visibleNs[obj.ns] !== false) && (visibleObjects[obj.key] !== false);
                        return (
                          <label
                            key={obj.key}
                            className="object-row"
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              fontSize: "11px",
                              padding: "3px 4px",
                              borderRadius: "3px",
                              cursor: "pointer",
                              background: isChecked ? "rgba(255, 255, 255, 0.02)" : "transparent",
                              opacity: isChecked ? 1 : 0.45,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "center", gap: 6, overflow: "hidden", flex: 1 }}>
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  setVisibleObjects((prev) => ({
                                    ...prev,
                                    [obj.key]: !isChecked,
                                  }));
                                }}
                              />
                              <span
                                className="swatch-obj"
                                style={{
                                  width: 8,
                                  height: 8,
                                  borderRadius: 2,
                                  flexShrink: 0,
                                  background: obj.colorHex,
                                }}
                              />
                              <span className="mono" style={{ fontSize: "10px", color: "var(--cyan)", fontWeight: 600 }}>
                                #{obj.id}
                              </span>
                              <span
                                className="mono"
                                style={{
                                  fontSize: "10px",
                                  color: "var(--text)",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                  whiteSpace: "nowrap",
                                }}
                                title={obj.text ? `${obj.typeName}: ${obj.text}` : obj.typeName}
                              >
                                {obj.typeName}
                                {obj.text ? ` (${obj.text})` : ""}
                              </span>
                            </div>
                            {selectedNsFilter === "all" && (
                              <span
                                className="mono"
                                style={{
                                  fontSize: "9px",
                                  color: "var(--faint)",
                                  marginLeft: 4,
                                  flexShrink: 0,
                                }}
                              >
                                {obj.ns}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="side-sec">
                  <div className="side-h">相机预设视角</div>
                  <div className="cam-btn-grid">
                    <button type="button" className="ghost" onClick={() => setCameraPreset({ id: Date.now(), type: "reset" })}>
                      透视视角
                    </button>
                    <button type="button" className="ghost" onClick={() => setCameraPreset({ id: Date.now(), type: "top" })}>
                      顶视 (俯视)
                    </button>
                    <button type="button" className="ghost" onClick={() => setCameraPreset({ id: Date.now(), type: "front" })}>
                      正前视角
                    </button>
                    <button type="button" className="ghost" onClick={() => setCameraPreset({ id: Date.now(), type: "side" })}>
                      正侧视角
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ gridColumn: "span 2" }}
                      onClick={() => setCameraPreset({ id: Date.now(), type: "reset" })}
                    >
                      复位视角
                    </button>
                  </div>
                </div>

                <div className="side-sec">
                  <div className="side-h">图元统计与操作</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                    <div>
                      活动图元：<b className="mono" style={{ color: "var(--cyan)" }}>{scene3DStats.count}</b> 个
                    </div>
                    {Object.entries(scene3DStats.types).length > 0 && (
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
                        {Object.entries(scene3DStats.types).map(([typeName, cnt]) => (
                          <span
                            key={typeName}
                            className="mono"
                            style={{
                              fontSize: 10,
                              background: "rgba(255,255,255,0.05)",
                              padding: "1px 5px",
                              borderRadius: 3,
                            }}
                          >
                            {typeName}: {cnt}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="ghost"
                    style={{ width: "100%", height: 26, fontSize: 11, color: "var(--err)" }}
                    onClick={() => {
                      setMarkers([]);
                      setScene3DStats({ count: 0, namespaces: {}, types: {} });
                    }}
                  >
                    清空空间标记
                  </button>
                </div>
              </>
            )}

            {/* Image Context Settings */}
            {activeKind === "image" && (
              <>
                <div className="side-sec">
                  <div className="side-h">视频流通道选路</div>
                  <div style={{ marginTop: 4, marginBottom: 6 }}>
                    <select
                      value={currentImgSel}
                      onChange={(e) => handleSetImageStream(e.target.value)}
                      style={{ width: "100%", fontSize: 11, height: 26, padding: "0 6px" }}
                    >
                      {names.length === 0 && <option value="">暂无可用视频流</option>}
                      {names.map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--muted)", display: "flex", justifyContent: "space-between" }}>
                    <span>已发现流通道</span>
                    <span className="mono" style={{ color: "var(--cyan)" }}>
                      {names.length} 个
                    </span>
                  </div>
                </div>

                <div className="side-sec">
                  <div className="side-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>视口缩放与平移</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--cyan)" }}>
                      {Math.round(imgScale * 100)}%
                    </span>
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
                    <button
                      type="button"
                      className="ghost"
                      style={{ height: 26, fontSize: 11 }}
                      onClick={() => {
                        setImgScale(1);
                        setImgPan({ x: 0, y: 0 });
                      }}
                    >
                      适应窗口 (Fit)
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ height: 26, fontSize: 11 }}
                      onClick={() => {
                        setImgScale(1);
                        setImgPan({ x: 0, y: 0 });
                      }}
                    >
                      1:1 原生比例
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ height: 26, fontSize: 11 }}
                      onClick={() => setImgScale((s) => Math.min(15, Number((s * 1.25).toFixed(2))))}
                    >
                      放大 (+)
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ height: 26, fontSize: 11 }}
                      onClick={() => setImgScale((s) => Math.max(0.1, Number((s * 0.8).toFixed(2))))}
                    >
                      缩小 (-)
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ gridColumn: "span 2", height: 26, fontSize: 11 }}
                      onClick={() => setImgPan({ x: 0, y: 0 })}
                    >
                      居中复位 (平移 0, 0)
                    </button>
                  </div>

                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>快速倍率预设</div>
                    <div style={{ display: "flex", gap: 4 }}>
                      {[0.5, 1.0, 1.5, 2.0, 4.0].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          className="ghost"
                          style={{
                            flex: 1,
                            height: 22,
                            fontSize: 10,
                            padding: 0,
                            borderColor: Math.abs(imgScale - preset) < 0.05 ? "var(--cyan)" : undefined,
                            color: Math.abs(imgScale - preset) < 0.05 ? "var(--cyan)" : undefined,
                          }}
                          onClick={() => setImgScale(preset)}
                        >
                          {Math.round(preset * 100)}%
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="side-sec">
                  <div className="side-h">辅助图层与 HUD</div>
                  <label style={{ fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={showImgCrosshair}
                      onChange={(e) => setShowImgCrosshair(e.target.checked)}
                    />
                    显示中心瞄准准星与辅助角框
                  </label>
                  <label style={{ fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={showImgHudInfo}
                      onChange={(e) => setShowImgHudInfo(e.target.checked)}
                    />
                    显示浮动水印与流状态信息
                  </label>
                  <label style={{ fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
                    <input
                      type="checkbox"
                      checked={imgSmooth}
                      onChange={(e) => setImgSmooth(e.target.checked)}
                    />
                    双线性平滑插值渲染
                  </label>
                </div>

                <div className="side-sec">
                  <div className="side-h">图传流诊断状态</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
                    <div>
                      活动流：<b className="mono" style={{ color: "var(--cyan)" }}>{currentImgSel || "未选定"}</b>
                    </div>
                    <div>
                      传输状态：
                      <span className="mono" style={{ color: images[currentImgSel] ? "var(--green)" : "var(--amber)" }}>
                        {images[currentImgSel] ? "活跃传输中 (Active)" : "等待首帧数据..."}
                      </span>
                    </div>
                    <div>
                      视口位姿：
                      <span className="mono" style={{ color: "var(--text-strong)" }}>
                        {Math.round(imgScale * 100)}% · ({Math.round(imgPan.x)}, {Math.round(imgPan.y)})
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Log Context Settings */}
            {activeKind === "log" && (
              <>
                <div className="side-sec">
                  <div className="side-h" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>日志级别过滤</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "0 6px", height: "18px", fontSize: "10px" }}
                        onClick={() => setLogLevels({ DEBUG: true, INFO: true, WARN: true, ERROR: true })}
                      >
                        全显
                      </button>
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "0 6px", height: "18px", fontSize: "10px" }}
                        onClick={() => setLogLevels({ DEBUG: false, INFO: false, WARN: true, ERROR: true })}
                      >
                        仅告警
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                    {(["DEBUG", "INFO", "WARN", "ERROR"] as const).map((k) => {
                      const count = logStats[k.toLowerCase() as keyof typeof logStats] || 0;
                      const col =
                        k === "ERROR"
                          ? "var(--err)"
                          : k === "WARN"
                          ? "var(--amber)"
                          : k === "INFO"
                          ? "var(--green)"
                          : "var(--cyan)";
                      return (
                        <label
                          key={k}
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            fontSize: 11,
                            padding: "2px 0",
                            cursor: "pointer",
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                              type="checkbox"
                              checked={logLevels[k]}
                              onChange={(e) => setLogLevels((p) => ({ ...p, [k]: e.target.checked }))}
                            />
                            <span className="mono" style={{ color: col, fontWeight: 600 }}>
                              {k}
                            </span>
                          </div>
                          <span
                            className="mono"
                            style={{
                              fontSize: 10,
                              color: "var(--muted)",
                              background: "rgba(255, 255, 255, 0.05)",
                              padding: "0 5px",
                              borderRadius: 3,
                            }}
                          >
                            {count}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="side-sec">
                  <div className="side-h">关键词 / 正则过滤</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
                    <input
                      style={{ flex: 1, fontSize: 11, height: 24, padding: "0 6px" }}
                      placeholder="过滤消息文本或正则..."
                      value={logFilterText}
                      onChange={(e) => setLogFilterText(e.target.value)}
                    />
                    {logFilterText && (
                      <button
                        type="button"
                        className="ghost"
                        style={{ padding: "0 6px", height: 24, fontSize: 11 }}
                        onClick={() => setLogFilterText("")}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--faint)", marginTop: 4 }}>
                    支持普通字符串包含或 JavaScript 正则
                  </div>
                </div>

                <div className="side-sec">
                  <div className="side-h">终端显示设置</div>
                  <label style={{ fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={logAutoScroll}
                      onChange={(e) => setLogAutoScroll(e.target.checked)}
                    />
                    接收新日志时自动贴底
                  </label>
                  <label style={{ fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
                    <input
                      type="checkbox"
                      checked={logShowTs}
                      onChange={(e) => setLogShowTs(e.target.checked)}
                    />
                    显示精确时间戳
                  </label>
                  <div style={{ marginTop: 6, fontSize: 11, color: "var(--muted)" }}>
                    <div style={{ marginBottom: 4 }}>缓冲区容量</div>
                    <select
                      value={maxLogBuffer}
                      onChange={(e) => setMaxLogBuffer(Number(e.target.value))}
                      style={{ fontSize: 11, height: 24 }}
                    >
                      <option value={500}>500 行</option>
                      <option value={1000}>1000 行</option>
                      <option value={2000}>2000 行</option>
                      <option value={5000}>5000 行</option>
                    </select>
                  </div>
                </div>

                <div className="side-sec">
                  <div className="side-h">统计与导出</div>
                  <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, lineHeight: 1.6 }}>
                    <div>接收总量：<b className="mono" style={{ color: "var(--text-strong)" }}>{logs.length}</b> 行</div>
                    <div>匹配显示：<b className="mono" style={{ color: "var(--cyan)" }}>{visibleLogCount}</b> 行</div>
                    <div>告警统计：<span className="mono" style={{ color: "var(--amber)" }}>{logStats.warn} WARN</span> · <span className="mono" style={{ color: "var(--err)" }}>{logStats.error} ERROR</span></div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <button
                      type="button"
                      className="ghost"
                      style={{ width: "100%", height: 26, fontSize: 11 }}
                      onClick={exportLogs}
                    >
                      导出日志文件 (.log)
                    </button>
                    <button
                      type="button"
                      className="ghost"
                      style={{ width: "100%", height: 26, fontSize: 11, color: "var(--err)" }}
                      onClick={() => setLogs([])}
                    >
                      清空终端日志
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </aside>
      <div className="workbench-main">
        {/* Tiles Container */}
        <div className={`tile-root ${layoutMode === "grid" && panels.length === 4 ? "tile-grid-2x2" : ""}`}>
          {panels.map((panel, i) => {
            const k = panel.kind;
            const imgSel = panel.imgSel || names[0] || "";
            const isSingle = panels.length === 1;
            const isSelected = clampedSelectedIdx === i;
            return (
              <div
                className={`tile-pane ${isSelected ? "active-tile" : ""}`}
                key={i}
                onClick={() => setSelectedPaneIdx(i)}
              >
                <div className="tile-head">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: 12 }}>
                    <span style={{ color: k === "3d" ? "var(--cyan)" : undefined }}>
                      {k === "3d" ? "3D 空间视口 (Markers)" : k === "plot" ? "曲线绘图" : k === "image" ? "实时图像" : "运行日志"}
                    </span>
                  </div>
                  {k !== "image" && k !== "log" && (
                    <select
                      value={k}
                      style={{ marginLeft: 8 }}
                      onChange={(e) => {
                        const kind = e.target.value as PanelKind;
                        setPanels((prev) => {
                          const n = [...prev];
                          const cur = n[i];
                          n[i] = {
                            ...cur,
                            kind,
                            imgSel:
                              kind === "image" && !cur.imgSel ? names[0] || "" : cur.imgSel,
                          };
                          return n;
                        });
                      }}
                    >
                      <option value="plot">绘图</option>
                      <option value="3d">3D 视图 (Markers)</option>
                      <option value="image">图像</option>
                      <option value="log">日志</option>
                    </select>
                  )}
                  <button
                    type="button"
                    className="ghost"
                    title={isSingle ? "还原多窗视口" : "最大化当前视口"}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isSingle) {
                        if (prevPanels && prevPanels.length > 1) {
                          setPanels(prevPanels);
                          setPrevPanels(null);
                        } else {
                          applyGrid4();
                        }
                      } else {
                        setPrevPanels(panels);
                        setPanels([panel]);
                        setLayoutMode("horizontal");
                      }
                    }}
                  >
                    {isSingle ? "还原" : "最大化"}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    title="向右拆分"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPanels((prev) => {
                        const n = [...prev];
                        n.splice(i + 1, 0, { kind: "plot", imgSel: "" });
                        return n.slice(0, 6);
                      });
                    }}
                  >
                    拆分
                  </button>
                  {panels.length > 1 && (
                    <button
                      type="button"
                      className="ghost"
                      title="关闭"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPanels((prev) => prev.filter((_, j) => j !== i));
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>
                <div className="tile-content">
                  {k === "plot" &&
                    (i === plotIndex ? (
                      <div
                        className="plot-host"
                        ref={hostRef}
                        onPointerDown={(e) => {
                          if (!replayRef.current || !seekRef.current) return;
                          const chart = chartRef.current;
                          if (!chart || cursorRef.current == null) return;
                          const rect = chart.canvas.getBoundingClientRect();
                          const px = e.clientX - rect.left;
                          const cx = chart.scales.x.getPixelForValue(cursorRef.current);
                          if (Math.abs(px - cx) > 12) return;
                          dragCursor.current = true;
                          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                          e.preventDefault();
                        }}
                        onPointerMove={(e) => {
                          if (!dragCursor.current || !seekRef.current) return;
                          const chart = chartRef.current;
                          if (!chart) return;
                          const rect = chart.canvas.getBoundingClientRect();
                          const t = chart.scales.x.getValueForPixel(e.clientX - rect.left);
                          if (t != null && Number.isFinite(t)) seekRef.current(t);
                        }}
                        onPointerUp={() => {
                          dragCursor.current = false;
                        }}
                      >
                        <canvas ref={canvasRef} />
                      </div>
                    ) : (
                      <div className="mono muted" style={{ padding: 8 }}>
                        绘图已在其他面板
                      </div>
                    ))}
                  {k === "log" && (
                    <LogPane
                      lines={logs}
                      cursorT={replay ? cursorT : null}
                      onSeek={replay ? onSeek : undefined}
                      levels={logLevels}
                      onLevelsChange={setLogLevels}
                      filterText={logFilterText}
                      onFilterTextChange={setLogFilterText}
                      autoScroll={logAutoScroll}
                      showTs={logShowTs}
                      onClear={() => setLogs([])}
                      onExport={exportLogs}
                    />
                  )}
                  {k === "image" && (
                    <ImagePane
                      sel={imgSel}
                      url={images[imgSel]}
                      scale={clampedSelectedIdx === i ? imgScale : 1}
                      onScaleChange={clampedSelectedIdx === i ? setImgScale : undefined}
                      pan={clampedSelectedIdx === i ? imgPan : { x: 0, y: 0 }}
                      onPanChange={clampedSelectedIdx === i ? setImgPan : undefined}
                      showCrosshair={showImgCrosshair}
                      showHud={showImgHudInfo}
                      smooth={imgSmooth}
                    />
                  )}
                  {k === "3d" && (
                    <Scene3DView
                      markers={markers}
                      onClear={() => setMarkers([])}
                      showGrid={show3DGrid}
                      gridSize={gridSize3D}
                      showAxes={show3DAxes}
                      visibleNs={visibleNs}
                      visibleObjects={visibleObjects}
                      cameraPreset={cameraPreset}
                      onStatsChange={setScene3DStats}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Workbench Bottom Status Bar */}
        <footer className="workbench-statusbar">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span>当前视口:</span>
            <span style={{ color: "var(--cyan)", fontWeight: 600 }}>
              {activeKind === "plot" ? "曲线绘图" : activeKind === "3d" ? "3D 空间视口" : activeKind === "image" ? "实时图像" : "运行日志"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, color: "var(--muted)", fontSize: 11 }}>
            {activeKind === "plot" && (
              <span>
                模式: {mode === "sliding" ? "滑动" : mode === "centered" ? "居中" : "暂停"} · 窗口: {win}s · 活跃通道: {Object.values(fields).filter((f) => f.on).length}/{Object.keys(fields).length}
              </span>
            )}
            {activeKind === "3d" && (
              <span>
                参考系: base_link · 命名空间: {Object.keys(scene3DStats.namespaces).length} · 活动 Marker: {scene3DStats.count} · 网格: {show3DGrid ? `${gridSize3D}m` : "关闭"}
              </span>
            )}
            {activeKind === "image" && (
              <span>
                视频流: {currentImgSel || "默认"} · 缩放: {Math.round(imgScale * 100)}% · 准星: {showImgCrosshair ? "开启" : "隐藏"} · 传输: {images[currentImgSel] ? "在线" : "等待数据"}
              </span>
            )}
            {activeKind === "log" && (
              <span>
                终端日志: {logs.length} 行 · 过滤匹配: {visibleLogCount} 行 · 告警: {logStats.warn + logStats.error} 条
              </span>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--faint)" }}>
            <span>{panels.length === 4 ? "2×2 网格" : panels.length === 1 ? "单屏专注" : `${panels.length} 分屏`}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function LogPane({
  lines,
  cursorT = null,
  onSeek,
  levels,
  onLevelsChange,
  filterText = "",
  onFilterTextChange,
  autoScroll = true,
  showTs = true,
  onClear,
  onExport,
}: {
  lines: LogLine[];
  cursorT?: number | null;
  onSeek?: (t: number) => void;
  levels?: { DEBUG: boolean; INFO: boolean; WARN: boolean; ERROR: boolean };
  onLevelsChange?: React.Dispatch<React.SetStateAction<{ DEBUG: boolean; INFO: boolean; WARN: boolean; ERROR: boolean }>>;
  filterText?: string;
  onFilterTextChange?: (txt: string) => void;
  autoScroll?: boolean;
  showTs?: boolean;
  onClear?: () => void;
  onExport?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [localLv, setLocalLv] = useState({ DEBUG: true, INFO: true, WARN: true, ERROR: true });
  const [localFilter, setLocalFilter] = useState("");
  const [mark, setMark] = useState<{ y: number; kind: "line" | "gap" } | null>(null);

  const activeLv = levels || localLv;
  const setLv = onLevelsChange || setLocalLv;
  const activeFilter = filterText !== undefined ? filterText : localFilter;
  const setFilter = onFilterTextChange || setLocalFilter;

  const visible = useMemo(() => {
    let re: RegExp | null = null;
    const q = activeFilter.trim();
    if (q) {
      try {
        re = new RegExp(q, "i");
      } catch {
        re = null;
      }
    }
    const qLower = q.toLowerCase();

    return lines.filter((l) => {
      const lv = normLevel(l.level) as keyof typeof activeLv;
      if (activeLv[lv] === false) return false;
      if (!q) return true;
      if (re) return re.test(l.msg) || re.test(lv);
      return l.msg.toLowerCase().includes(qLower) || lv.toLowerCase().includes(qLower);
    });
  }, [lines, activeLv, activeFilter]);

  let current = -1;
  if (cursorT != null) {
    for (let i = 0; i < visible.length; i++) {
      const tt = visible[i].t;
      if (tt == null) continue;
      if (tt <= cursorT) current = i;
      else break;
    }
  }

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (cursorT == null) {
      if (autoScroll && stick.current) el.scrollTop = el.scrollHeight;
      return;
    }
    const row = el.querySelector(".log-current") as HTMLElement | null;
    if (row) {
      const top = row.offsetTop;
      const bot = top + row.offsetHeight;
      if (top < el.scrollTop || bot > el.scrollTop + el.clientHeight) {
        el.scrollTop = Math.max(0, top - el.clientHeight / 3);
      }
      const next = visible[current + 1];
      const cur = visible[current];
      if (cur && next && cur.t != null && next.t != null && next.t > cur.t) {
        const frac = (cursorT - cur.t) / (next.t - cur.t);
        if (frac > 0.08 && frac < 0.92) {
          const nEl = row.nextElementSibling as HTMLElement | null;
          const y1 = nEl ? nEl.offsetTop : bot;
          setMark({ y: top + (y1 - top) * frac - el.scrollTop, kind: "gap" });
          return;
        }
      }
      setMark({ y: top + row.offsetHeight / 2 - el.scrollTop, kind: "line" });
    } else {
      setMark(null);
    }
  }, [visible.length, lines.length, cursorT, current, autoScroll]);

  return (
    <div className="log-pane">
      <div className="log-toolbar" style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "0 10px", height: "auto", minHeight: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {(["DEBUG", "INFO", "WARN", "ERROR"] as const).map((k) => (
            <label key={k} style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: 11 }}>
              <input
                type="checkbox"
                checked={activeLv[k]}
                onChange={(e) => setLv((p) => ({ ...p, [k]: e.target.checked }))}
              />
              <span className="mono">{k}</span>
            </label>
          ))}
        </div>

        <input
          style={{ height: 22, fontSize: 11, padding: "0 6px", width: 130 }}
          placeholder="快速搜索..."
          value={activeFilter}
          onChange={(e) => setFilter(e.target.value)}
        />

        <span className="log-count mono" style={{ fontSize: 11, color: "var(--cyan)", marginLeft: "auto" }}>
          {visible.length} / {lines.length}
        </span>

        {onExport && (
          <button type="button" className="ghost" style={{ height: 22, fontSize: 11, padding: "0 6px" }} onClick={onExport} title="导出当前日志为文本文件">
            导出
          </button>
        )}
        {onClear && (
          <button type="button" className="ghost" style={{ height: 22, fontSize: 11, padding: "0 6px", color: "var(--err)" }} onClick={onClear} title="清空日志控制台">
            清空
          </button>
        )}
      </div>
      <div className="log-stream-wrap">
        {mark?.kind === "gap" && <div className="log-tri" style={{ top: mark.y }} />}
        <div
          className="log-stream"
          ref={ref}
          onScroll={() => {
            const el = ref.current;
            if (!el) return;
            stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
          }}
        >
          {visible.length === 0 && (
            <div className="log-line L-DEBUG">
              <span className="log-msg mono" style={{ color: "var(--muted)" }}>
                {lines.length === 0 ? "等待日志数据..." : "无符合过滤条件的日志"}
              </span>
            </div>
          )}
          {visible.map((l, idx) => (
            <div
              key={idx}
              className={`log-line L-${normLevel(l.level)}${idx === current ? " log-current" : ""}${onSeek ? " log-click" : ""}`}
              onClick={() => {
                if (l.t != null) onSeek?.(l.t);
              }}
            >
              {showTs && (
                l.t != null ? (
                  <span className="log-ts">{l.t.toFixed(3)}s</span>
                ) : l.ts ? (
                  <span className="log-ts">{fmtTs(l.ts)}</span>
                ) : null
              )}
              <span className="log-lv">{normLevel(l.level)}</span>
              <span className="log-msg">{l.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ImagePane({
  sel,
  url,
  scale = 1,
  onScaleChange,
  pan = { x: 0, y: 0 },
  onPanChange,
  showCrosshair = true,
  showHud = true,
  smooth = true,
}: {
  sel: string;
  url?: string;
  scale?: number;
  onScaleChange?: React.Dispatch<React.SetStateAction<number>>;
  pan?: { x: number; y: number };
  onPanChange?: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  showCrosshair?: boolean;
  showHud?: boolean;
  smooth?: boolean;
}) {
  const [localScale, setLocalScale] = useState(1);
  const [localPan, setLocalPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const curScale = scale !== undefined ? scale : localScale;
  const setScale = onScaleChange || setLocalScale;

  const curPan = pan !== undefined ? pan : localPan;
  const setPan = onPanChange || setLocalPan;

  return (
    <div className="img-pane">
      <div
        className="img-view"
        onWheel={(e) => {
          e.preventDefault();
          setScale((s) => Math.min(15, Math.max(0.1, Number((s * (e.deltaY > 0 ? 0.9 : 1.1)).toFixed(2)))));
        }}
        onMouseDown={(e) => {
          if (e.button !== 0) return;
          drag.current = { x: e.clientX, y: e.clientY, px: curPan.x, py: curPan.y };
        }}
        onMouseMove={(e) => {
          if (!drag.current) return;
          setPan({
            x: drag.current.px + e.clientX - drag.current.x,
            y: drag.current.py + e.clientY - drag.current.y,
          });
        }}
        onMouseUp={() => {
          drag.current = null;
        }}
        onMouseLeave={() => {
          drag.current = null;
        }}
      >
        {url ? (
          <>
            <img
              src={url}
              alt=""
              draggable={false}
              style={{
                transform: `translate(${curPan.x}px, ${curPan.y}px) scale(${curScale})`,
                imageRendering: smooth ? "auto" : "pixelated",
              }}
            />
            {/* Cyber Vision HUD Overlay */}
            {showCrosshair && (
              <div className="hud-crosshair">
                <span className="hud-corner hud-corner-tl" />
                <span className="hud-corner hud-corner-tr" />
                <span className="hud-corner hud-corner-bl" />
                <span className="hud-corner hud-corner-br" />
              </div>
            )}
            {showHud && (
              <>
                <div
                  style={{
                    position: "absolute",
                    top: "10px",
                    right: "12px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    background: "rgba(0,0,0,0.65)",
                    backdropFilter: "blur(8px)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: "11px",
                    fontFamily: "var(--mono)",
                    color: "var(--text-strong)",
                    pointerEvents: "none",
                  }}
                >
                  <span className="state-tag s-connected" style={{ fontSize: "10px", padding: "1px 6px" }}>
                    STREAM ACTIVE
                  </span>
                  <span style={{ color: "var(--cyan)" }}>{sel}</span>
                  <span style={{ color: "var(--faint)" }}>
                    {curScale !== 1 ? `${Math.round(curScale * 100)}%` : "1:1"}
                  </span>
                </div>
                <div
                  style={{
                    position: "absolute",
                    bottom: "10px",
                    left: "12px",
                    background: "rgba(0,0,0,0.65)",
                    backdropFilter: "blur(8px)",
                    padding: "3px 8px",
                    borderRadius: "4px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    fontSize: "10px",
                    fontFamily: "var(--mono)",
                    color: "var(--cyan)",
                    pointerEvents: "none",
                  }}
                >
                  CAMERA HUD · 60 FPS STREAM
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--muted)" }}>
            <span className="mono" style={{ fontSize: 13 }}>{sel ? `等待图像流数据: ${sel}…` : "暂未配置图像流通道"}</span>
            <span style={{ fontSize: 11, color: "var(--faint)" }}>可在左侧设置栏选择活动视频流或检查发布节点</span>
          </div>
        )}
      </div>
    </div>
  );
}
