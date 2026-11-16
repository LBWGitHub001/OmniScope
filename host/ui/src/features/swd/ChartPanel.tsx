import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";
import { Chart, LineController, LineElement, PointElement, LinearScale, Legend } from "chart.js";
import type { FormulaItem, HistoryPoint, SymbolRow } from "./types";
import { COLORS } from "./swdUtils";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend);

type ChartPanelProps = {
  symbols?: SymbolRow[];
  plotted: Record<string, boolean>;
  formulas: FormulaItem[];
  plotChNames: Record<number, string>;
  plotPlotted: Record<string, boolean>;
  historyRef: MutableRefObject<Record<string, HistoryPoint[]>>;
  plotHistoryRef: MutableRefObject<Record<string, HistoryPoint[]>>;
  isPaused: boolean;
  onTogglePaused: () => void;
  onTogglePlotChannel: (name: string, plotted: boolean) => void;
  onClear: () => void;
  children?: ReactNode;
};

export function ChartPanel({
  symbols,
  plotted,
  formulas,
  plotChNames,
  plotPlotted,
  historyRef,
  plotHistoryRef,
  isPaused,
  onTogglePaused,
  onTogglePlotChannel,
  onClear,
  children,
}: ChartPanelProps) {
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!chartCanvasRef.current) return;
    const ctx = chartCanvasRef.current.getContext("2d");
    if (!ctx) return;

    const computed = getComputedStyle(chartCanvasRef.current);
    const tickColor = computed.getPropertyValue("--muted").trim() || "#8b929e";
    const gridColor = computed.getPropertyValue("--hairline").trim() || "#252a32";
    const legendColor = computed.getPropertyValue("--text-strong").trim() || "#e6e9ee";
    const monoFont = computed.getPropertyValue("--mono").trim() || "monospace";

    const chart = new Chart(ctx, {
      type: "line",
      data: { datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        scales: {
          x: {
            type: "linear",
            display: true,
            ticks: {
              color: tickColor,
              font: { family: monoFont, size: 10 },
              callback: (value) => `${Number(value).toFixed(1)}s`,
            },
            grid: { color: gridColor },
          },
          y: {
            display: true,
            ticks: {
              color: tickColor,
              font: { family: monoFont, size: 10 },
            },
            grid: { color: gridColor },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: legendColor,
              font: { family: "Inter, sans-serif", size: 11, weight: 600 },
              boxWidth: 10,
              boxHeight: 10,
              usePointStyle: true,
              pointStyle: "circle",
            },
          },
        },
      },
    });

    let animationId = 0;
    const updateChart = () => {
      const datasets: any[] = (symbols || [])
        .filter((symbol) => plotted[symbol.name] !== false)
        .map((symbol, index) => {
          const history = historyRef.current[symbol.name] || [];
          const start = history[0]?.t || 0;
          const color = COLORS[index % COLORS.length];
          return {
            label: symbol.name,
            borderColor: color,
            backgroundColor: `${color}18`,
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.25,
            data: history.map((point) => ({ x: point.t - start, y: point.v })),
          };
        });

      formulas
        .filter((formula) => formula.enabled && formula.fn && formula.source)
        .forEach((formula) => {
          const history = historyRef.current[formula.source] || [];
          const start = history[0]?.t || 0;
          const points = history
            .map((point) => {
              const y = formula.fn!(point.v);
              return Number.isFinite(y) ? { x: point.t - start, y } : null;
            })
            .filter(Boolean);
          datasets.push({
            label: `f(x): ${formula.expr} [x=${formula.source}]`,
            borderColor: formula.color,
            backgroundColor: "transparent",
            borderWidth: 1.8,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0.2,
            data: points as any,
          });
        });

      Object.keys(plotHistoryRef.current).forEach((name, index) => {
        if (plotPlotted[name] === false) return;
        const history = plotHistoryRef.current[name] || [];
        if (history.length === 0) return;
        const start = history[0]?.t || 0;
        const color = COLORS[(index + 4) % COLORS.length];
        datasets.push({
          label: `plot:${name}`,
          borderColor: color,
          backgroundColor: "transparent",
          borderWidth: 1.6,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: false,
          tension: 0.15,
          data: history.map((point) => ({ x: point.t - start, y: point.v })),
        });
      });

      chart.data.datasets = datasets;
      chart.update("none");
      animationId = requestAnimationFrame(updateChart);
    };

    animationId = requestAnimationFrame(updateChart);
    return () => {
      cancelAnimationFrame(animationId);
      chart.destroy();
    };
  }, [symbols, plotted, formulas, plotPlotted, historyRef, plotHistoryRef]);

  return (
    <section className="swd-scope-panel" aria-label="实时示波器">
      <div className="swd-chart-toolbar">
        <div className="swd-chart-heading">
          <span className="swd-chart-title">实时示波器 (Oscilloscope)</span>
          <span className="mono swd-chart-subtitle">· 滚屏波形实时渲染</span>
          {Object.values(plotChNames).length > 0 && (
            <span className="swd-plot-channels">
              <span className="swd-plot-label">固件plot:</span>
              {Object.entries(plotChNames).map(([index, name], channelIndex) => (
                <label
                  key={index}
                  className="swd-plot-channel"
                  style={{ color: COLORS[(channelIndex + 4) % COLORS.length] }}
                >
                  <input
                    type="checkbox"
                    checked={plotPlotted[name] !== false}
                    onChange={(event) => onTogglePlotChannel(name, event.target.checked)}
                  />
                  {name}
                </label>
              ))}
            </span>
          )}
        </div>
        <div className="swd-chart-actions">
          <button type="button" className="ghost swd-chart-button" onClick={onTogglePaused}>
            {isPaused ? "恢复" : "暂停"}
          </button>
          <button type="button" className="ghost swd-chart-button" onClick={onClear}>
            清空波形
          </button>
        </div>
      </div>

      <div className="swd-chart-canvas-wrap">
        <canvas ref={chartCanvasRef} />
      </div>
      {children}
    </section>
  );
}
