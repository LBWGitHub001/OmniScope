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
  busOut: (bus: DataBus) => void;
  imageSubscribe?: (names: string[]) => void;
  replay: boolean;
  cursorT?: number | null;
  onSeek?: (time: number) => void;
};

export function useWorkbenchData({
  panels,
  setPanels,
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

  const plotChartsRef = useRef(new Map<string, Chart>());
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

  const plotOnById = useRef<Record<string, Record<string, boolean> | undefined>>({});
  plotOnById.current = {};
  for (const panel of panels) {
    if (panel.kind === "plot") plotOnById.current[panel.id] = panel.plotOn;
  }

  const fieldVisible = (paneId: string, key: string) => {
    const filter = plotOnById.current[paneId];
    if (filter) return filter[key] === true;
    return fieldsRef.current[key]?.on !== false;
  };

  const syncChart = useCallback(() => {
    const meta = fieldsRef.current;
    const view = viewRef.current;
    const follow = replayRef.current && cursorRef.current != null ? cursorRef.current : lastX.current;
    const windowSeconds = view.win || 10;
    for (const [paneId, chart] of plotChartsRef.current) {
      const labels = Object.keys(seriesRef.current).filter((key) => fieldVisible(paneId, key));
      const normalDatasets = labels.map((label) => ({
        label,
        data: seriesRef.current[label],
        borderColor: meta[label]?.color || COLORS[0],
        backgroundColor: meta[label]?.color || COLORS[0],
        pointRadius: 0,
        borderWidth: 1.6,
      }));
      const formulaDatasets = formulasRef.current
        .filter((formula) =>
          formula.enabled && formula.fn && formula.source && seriesRef.current[formula.source]
          && fieldVisible(paneId, formula.source))
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
      if (!view.manual && view.mode !== "paused") {
        if (view.mode === "centered") {
          chart.options.scales!.x!.min = follow - windowSeconds / 2;
          chart.options.scales!.x!.max = follow + windowSeconds / 2;
        } else {
          chart.options.scales!.x!.min = Math.max(0, follow - windowSeconds);
          chart.options.scales!.x!.max = Math.max(windowSeconds, follow);
        }
      }
      chart.update("none");
    }
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

  const registerPlotChart = useCallback((id: string, chart: Chart) => {
    plotChartsRef.current.set(id, chart);
    invalidateChart();
  }, [invalidateChart]);

  const unregisterPlotChart = useCallback((id: string) => {
    plotChartsRef.current.delete(id);
  }, []);

  const beginManualView = useCallback(() => {
    viewRef.current = { ...viewRef.current, manual: true };
    setManual(true);
  }, []);

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
  }, [mode, win, history, manual, fields, cursorT, panels, invalidateChart]);

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
      for (const chart of plotChartsRef.current.values()) {
        chart.data.datasets = [];
        chart.update("none");
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
      for (const chart of plotChartsRef.current.values()) {
        (chart as Chart & { resetZoom?: () => void }).resetZoom?.();
      }
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
    registerPlotChart,
    unregisterPlotChart,
    beginManualView,
    replayRef,
    cursorRef,
    seekRef,
    dragCursor,
  };
}
