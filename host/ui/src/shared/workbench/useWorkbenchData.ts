import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
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
import { compileExpr } from "./expr";
import type { Scene3DStats } from "./Scene3DView";
import type { XyCurve } from "./XyPane";
import type { Marker, TransformStamped } from "./markers";
import { defaultFixedFrame, knownFrames } from "./tf";
import {
  COLORS,
  fillEmptyImgSels,
  fmtTs,
  type CameraPreset,
  type DataBus,
  type FieldMeta,
  type LogLevels,
  type LogLine,
  type PanelState,
  type ViewMode,
  type WorkbenchFormula,
} from "./types";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend, zoomPlugin);
(window as unknown as { Hammer: typeof Hammer }).Hammer = Hammer;

type WorkbenchDataOptions = {
  panels: PanelState[];
  setPanels: Dispatch<SetStateAction<PanelState[]>>;
  plotIndex: number;
  busOut: (bus: DataBus) => void;
  imageSubscribe?: (names: string[]) => void;
  replay: boolean;
  cursorT?: number | null;
  onSeek?: (time: number) => void;
};

export function useWorkbenchData({
  panels,
  setPanels,
  plotIndex,
  busOut,
  imageSubscribe,
  replay,
  cursorT = null,
  onSeek,
}: WorkbenchDataOptions) {
  const [mode, setMode] = useState<ViewMode>("sliding");
  const [win, setWin] = useState(10);
  const [history, setHistory] = useState(60);
  const [manual, setManual] = useState(false);
  const [fields, setFields] = useState<Record<string, FieldMeta>>({});
  const [formulas, setFormulas] = useState<WorkbenchFormula[]>([]);
  const [formulaDraft, setFormulaDraft] = useState("");
  const [formulaSource, setFormulaSource] = useState("");

  const [logs, setLogs] = useState<LogLine[]>([]);
  const [logLevels, setLogLevels] = useState<LogLevels>({ DEBUG: true, INFO: true, WARN: true, ERROR: true });
  const [logFilterText, setLogFilterText] = useState("");
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [logShowTs, setLogShowTs] = useState(true);
  const [maxLogBuffer, setMaxLogBuffer] = useState(2000);

  const [images, setImages] = useState<Record<string, string>>({});
  const [streams, setStreams] = useState<string[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [xyChannels, setXyChannels] = useState<string[]>([]);
  const [xyVersion, setXyVersion] = useState(0);
  const [xyDb, setXyDb] = useState(true);
  const [xyShowPeak, setXyShowPeak] = useState(true);

  const [show3DGrid, setShow3DGrid] = useState(true);
  const [gridSize3D, setGridSize3D] = useState(20);
  const [selectedNsFilter, setSelectedNsFilter] = useState("all");
  const [visibleNs, setVisibleNs] = useState<Record<string, boolean>>({});
  const [visibleObjects, setVisibleObjects] = useState<Record<string, boolean>>({});
  const [cameraPreset, setCameraPreset] = useState<CameraPreset | null>(null);
  const [scene3DStats, setScene3DStats] = useState<Scene3DStats>({ count: 0, namespaces: {}, types: {}, objects: [], frames: [] });
  const [tfByChild, setTfByChild] = useState<Record<string, TransformStamped>>({});
  const [fixedFrame, setFixedFrame] = useState("");
  const [showTfAxes, setShowTfAxes] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const seriesRef = useRef<Record<string, { x: number; y: number }[]>>({});
  const fieldsRef = useRef(fields);
  const formulasRef = useRef(formulas);
  const viewRef = useRef({ mode, win, history, manual });
  const lastX = useRef(0);
  const colorN = useRef(0);
  const logBuf = useRef<LogLine[]>([]);
  const imgBuf = useRef<Record<string, string>>({});
  const streamBuf = useRef<string[]>([]);
  const markerBuf = useRef<Marker[]>([]);
  const tfBuf = useRef<TransformStamped[]>([]);
  const xyRef = useRef<Record<string, XyCurve>>({});
  const xyDirty = useRef(false);
  const chartDirty = useRef(false);
  const rafRef = useRef(0);
  const replayRef = useRef(replay);
  const cursorRef = useRef<number | null>(cursorT);
  const seekRef = useRef(onSeek);
  const dragCursor = useRef(false);
  const mouseX = useRef(0);
  const maxLogBufferRef = useRef(maxLogBuffer);
  const imagesRef = useRef(images);

  replayRef.current = replay;
  cursorRef.current = cursorT;
  seekRef.current = onSeek;
  fieldsRef.current = fields;
  formulasRef.current = formulas;
  maxLogBufferRef.current = maxLogBuffer;
  imagesRef.current = images;
  viewRef.current = { ...viewRef.current, mode, win, history };

  const syncChart = useCallback(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const meta = fieldsRef.current;
    const labels = Object.keys(seriesRef.current).filter((key) => meta[key]?.on !== false);
    const normalDatasets = labels.map((label) => ({
      label,
      data: seriesRef.current[label],
      borderColor: meta[label]?.color || COLORS[0],
      backgroundColor: meta[label]?.color || COLORS[0],
      pointRadius: 0,
      borderWidth: 1.6,
    }));
    const formulaDatasets = formulasRef.current
      .filter((formula) => formula.enabled && formula.fn && formula.source && seriesRef.current[formula.source])
      .map((formula) => {
        const rawPoints = seriesRef.current[formula.source] || [];
        const data = rawPoints
          .map((point) => {
            const y = formula.fn!(point.y);
            return Number.isFinite(y) ? { x: point.x, y } : null;
          })
          .filter(Boolean);
        return {
          label: `f(x): ${formula.expr} [x=${formula.source}]`,
          data: data as any,
          borderColor: formula.color,
          backgroundColor: "transparent",
          pointRadius: 0,
          borderWidth: 1.6,
          borderDash: [5, 4],
        };
      });
    chart.data.datasets = [...normalDatasets, ...formulaDatasets];
    const view = viewRef.current;
    const follow = replayRef.current && cursorRef.current != null ? cursorRef.current : lastX.current;
    if (!view.manual && view.mode !== "paused") {
      const windowSeconds = view.win || 10;
      if (view.mode === "centered") {
        chart.options.scales!.x!.min = follow - windowSeconds / 2;
        chart.options.scales!.x!.max = follow + windowSeconds / 2;
      } else {
        chart.options.scales!.x!.min = Math.max(0, follow - windowSeconds);
        chart.options.scales!.x!.max = Math.max(windowSeconds, follow);
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
      setLogs((previous) => {
        const next = previous.concat(batch);
        const limit = maxLogBufferRef.current || 2000;
        return next.length > limit ? next.slice(-Math.floor(limit * 0.8)) : next;
      });
    }
    const pending = imgBuf.current;
    const pendingNames = Object.keys(pending);
    if (pendingNames.length) {
      imgBuf.current = {};
      setImages((previous) => {
        const next = { ...previous };
        for (const name of pendingNames) {
          const url = pending[name];
          const old = next[name];
          if (old && old.startsWith("blob:") && old !== url) URL.revokeObjectURL(old);
          next[name] = url;
        }
        imagesRef.current = next;
        return next;
      });
      setPanels((previous) => fillEmptyImgSels(previous, pendingNames[pendingNames.length - 1]));
    }
    if (streamBuf.current.length) {
      const list = streamBuf.current;
      streamBuf.current = [];
      setStreams((previous) => {
        const unique = new Set(previous);
        list.forEach((name) => unique.add(name));
        return [...unique].sort();
      });
      setPanels((previous) => fillEmptyImgSels(previous, list[0] || ""));
    }
    if (markerBuf.current.length) {
      const batch = markerBuf.current;
      markerBuf.current = [];
      setMarkers(batch);
    }
    if (tfBuf.current.length) {
      const batch = tfBuf.current;
      tfBuf.current = [];
      setTfByChild((previous) => {
        const next = { ...previous };
        for (const tf of batch) {
          if (tf.child) next[tf.child] = tf;
        }
        return next;
      });
    }
    if (xyDirty.current) {
      xyDirty.current = false;
      setXyVersion((version) => version + 1);
    }
  }, [setPanels, syncChart]);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(flush);
  }, [flush]);

  const invalidateChart = useCallback(() => {
    chartDirty.current = true;
    schedule();
  }, [schedule]);

  const addFormula = useCallback(() => {
    const expr = formulaDraft.trim();
    if (!expr) return;
    const names = Object.keys(fieldsRef.current);
    const source = formulaSource || names[0] || "";
    if (!source) {
      alert("请先选择自变量 x 来源");
      return;
    }
    try {
      const fn = compileExpr(expr);
      setFormulas((previous) => [
        ...previous,
        {
          id: Date.now(),
          expr,
          source,
          enabled: true,
          fn,
          color: COLORS[(previous.length + 4) % COLORS.length],
        },
      ]);
      setFormulaDraft("");
      invalidateChart();
    } catch (error) {
      alert(`公式语法错误: ${error}`);
    }
  }, [formulaDraft, formulaSource, invalidateChart]);

  const exportLogs = useCallback(() => {
    if (!logs.length) return;
    const content = logs
      .map((line) => {
        const time = line.t != null ? `${line.t.toFixed(3)}s` : line.ts ? fmtTs(line.ts) : "";
        return `[${time}] [${line.level.toUpperCase()}] ${line.msg}`;
      })
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `omniscope_logs_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.log`;
    anchor.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  const clearMarkers = useCallback(() => {
    setMarkers([]);
    setScene3DStats({ count: 0, namespaces: {}, types: {}, objects: [], frames: [] });
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const urls = new Set([...Object.values(imagesRef.current), ...Object.values(imgBuf.current)]);
      urls.forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
    };
  }, []);

  useEffect(() => {
    invalidateChart();
  }, [mode, win, history, manual, fields, cursorT, invalidateChart]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (plotIndex < 0 || !canvas || !host) return;
    const chart = new Chart(canvas, {
      type: "line",
      plugins: [
        {
          id: "replayCursor",
          afterDraw(currentChart) {
            const time = cursorRef.current;
            if (!replayRef.current || time == null || !Number.isFinite(time)) return;
            const xScale = currentChart.scales.x;
            if (!xScale) return;
            const x = xScale.getPixelForValue(time);
            const area = currentChart.chartArea;
            if (x < area.left - 2 || x > area.right + 2) return;
            const context = currentChart.ctx;
            context.save();
            context.beginPath();
            context.moveTo(x, area.top);
            context.lineTo(x, area.bottom);
            context.lineWidth = dragCursor.current ? 2.5 : 1.5;
            context.strokeStyle = "#ff7043";
            context.stroke();
            context.beginPath();
            context.moveTo(x, area.top);
            context.lineTo(x - 6, area.top - 7);
            context.lineTo(x + 6, area.top - 7);
            context.closePath();
            context.fillStyle = "#ff7043";
            context.fill();
            context.restore();
          },
        },
      ],
      data: { datasets: [] },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        onClick(event, _elements, currentChart) {
          if (!replayRef.current || !seekRef.current || dragCursor.current) return;
          const xScale = currentChart.scales.x;
          if (!xScale || event.x == null) return;
          const current = cursorRef.current;
          if (current != null) {
            const cursorX = xScale.getPixelForValue(current);
            if (Math.abs(event.x - cursorX) <= 12) return;
          }
          const time = xScale.getValueForPixel(event.x);
          if (time != null && Number.isFinite(time)) seekRef.current(time);
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
    const onMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX.current = event.clientX - rect.left;
    };
    canvas.addEventListener("mousemove", onMove);
    let lastWidth = 0;
    let lastHeight = 0;
    const fit = () => {
      const width = Math.floor(host.clientWidth);
      const height = Math.floor(host.clientHeight);
      if (width < 2 || height < 2) return;
      if (Math.abs(width - lastWidth) <= 1 && Math.abs(height - lastHeight) <= 1) return;
      lastWidth = width;
      lastHeight = height;
      chart.resize(width, height);
    };
    let resizeFrame = 0;
    const observer = new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        fit();
      });
    });
    observer.observe(host);
    fit();
    syncChart();
    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      canvas.removeEventListener("mousemove", onMove);
      observer.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
  }, [plotIndex, syncChart]);

  const names = [...new Set([...streams, ...Object.keys(images)])].sort();
  const wantedImages = [
    ...new Set(
      panels
        .filter((panel) => panel.kind === "image")
        .map((panel) => panel.imgSel || names[0] || "")
        .filter(Boolean)
    ),
  ].sort();
  const wantedKey = wantedImages.join("\0");

  useEffect(() => {
    if (!imageSubscribe) return;
    imageSubscribe(wantedKey ? wantedKey.split("\0") : []);
  }, [wantedKey, imageSubscribe]);

  const bus = useMemo<DataBus>(() => ({
    addPoint(field, time, value) {
      if (!seriesRef.current[field]) seriesRef.current[field] = [];
      const points = seriesRef.current[field];
      points.push({ x: time, y: value });
      lastX.current = time;
      if (!replayRef.current) {
        const historySeconds = viewRef.current.history || 60;
        const cutoff = time - historySeconds;
        while (points.length > 1 && points[0].x < cutoff) points.shift();
        if (points.length > 8000) points.splice(0, points.length - 6000);
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
    setStreams(nextNames) {
      streamBuf.current.push(...nextNames);
      schedule();
    },
    setCurve(channel, curve) {
      xyRef.current[channel] = curve;
      xyDirty.current = true;
      setXyChannels((previous) => previous.includes(channel) ? previous : [...previous, channel].sort());
      schedule();
    },
    addMarker(marker) {
      markerBuf.current.push(marker);
      schedule();
    },
    addMarkers(nextMarkers) {
      markerBuf.current.push(...nextMarkers);
      schedule();
    },
    addTf(tf) {
      tfBuf.current.push(tf);
      schedule();
    },
    addTfs(tfs) {
      tfBuf.current.push(...tfs);
      schedule();
    },
    loadReplay(series, replayLogs, duration, replayMarkers) {
      const nextSeries: Record<string, { x: number; y: number }[]> = {};
      const nextFields = { ...fieldsRef.current };
      for (const [field, points] of Object.entries(series || {})) {
        nextSeries[field] = points.map(([x, y]) => ({ x, y }));
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
      setLogs((replayLogs || []).map((line) => ({
        level: line.level,
        msg: line.msg,
        ts: line.ts,
        t: line.t,
      })));
      if (replayMarkers) setMarkers(replayMarkers.map((record) => record.marker));
      chartDirty.current = true;
      schedule();
    },
    clear() {
      seriesRef.current = {};
      lastX.current = 0;
      logBuf.current = [];
      setMarkers([]);
      xyRef.current = {};
      setXyChannels([]);
      setXyVersion((version) => version + 1);
      chartDirty.current = false;
      Object.values(imgBuf.current).forEach((url) => {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      });
      imgBuf.current = {};
      if (chartRef.current) {
        chartRef.current.data.datasets = [];
        chartRef.current.update("none");
      }
      setLogs([]);
      tfBuf.current = [];
      setTfByChild({});
      setFixedFrame("");
      setImages((previous) => {
        Object.values(previous).forEach((url) => {
          if (url.startsWith("blob:")) URL.revokeObjectURL(url);
        });
        imagesRef.current = {};
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
  }), [schedule]);

  useEffect(() => {
    busOut(bus);
  }, [bus, busOut]);

  useEffect(() => {
    const frames = knownFrames(tfByChild);
    if (!frames.length) return;
    if (!fixedFrame || !frames.includes(fixedFrame)) {
      setFixedFrame(defaultFixedFrame(tfByChild));
    }
  }, [tfByChild, fixedFrame]);

  return {
    mode, setMode,
    win, setWin,
    history, setHistory,
    manual,
    fields, setFields,
    formulas, setFormulas,
    formulaDraft, setFormulaDraft,
    formulaSource, setFormulaSource,
    addFormula,
    invalidateChart,
    logs, setLogs,
    logLevels, setLogLevels,
    logFilterText, setLogFilterText,
    logAutoScroll, setLogAutoScroll,
    logShowTs, setLogShowTs,
    maxLogBuffer, setMaxLogBuffer,
    exportLogs,
    images,
    streams,
    names,
    markers, setMarkers,
    clearMarkers,
    xyChannels,
    xyVersion,
    xyRef,
    xyDb, setXyDb,
    xyShowPeak, setXyShowPeak,
    show3DGrid, setShow3DGrid,
    gridSize3D, setGridSize3D,
    selectedNsFilter, setSelectedNsFilter,
    visibleNs, setVisibleNs,
    visibleObjects, setVisibleObjects,
    cameraPreset, setCameraPreset,
    scene3DStats, setScene3DStats,
    tfByChild, setTfByChild,
    fixedFrame, setFixedFrame,
    showTfAxes, setShowTfAxes,
    canvasRef,
    hostRef,
    chartRef,
    replayRef,
    cursorRef,
    seekRef,
    dragCursor,
  };
}
