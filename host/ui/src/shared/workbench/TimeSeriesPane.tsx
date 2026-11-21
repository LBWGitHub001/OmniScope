import { useEffect, useRef, type MutableRefObject } from "react";
import { Chart } from "chart.js";

type TimeSeriesPaneProps = {
  paneId: string;
  registerPlotChart: (id: string, chart: Chart) => void;
  unregisterPlotChart: (id: string) => void;
  replayRef: MutableRefObject<boolean>;
  cursorRef: MutableRefObject<number | null>;
  seekRef: MutableRefObject<((time: number) => void) | undefined>;
  dragCursor: MutableRefObject<boolean>;
  beginManualView: () => void;
};

export function TimeSeriesPane({
  paneId,
  registerPlotChart,
  unregisterPlotChart,
  replayRef,
  cursorRef,
  seekRef,
  dragCursor,
  beginManualView,
}: TimeSeriesPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const mouseX = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;

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
                beginManualView();
              },
            },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: () => (mouseX.current < 50 ? "y" : "x"),
              overScaleMode: "y" as const,
              onZoomStart: () => {
                if (dragCursor.current) return false;
                beginManualView();
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
    registerPlotChart(paneId, chart);

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

    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      canvas.removeEventListener("mousemove", onMove);
      observer.disconnect();
      unregisterPlotChart(paneId);
      chart.destroy();
      chartRef.current = null;
    };
  }, [paneId, registerPlotChart, unregisterPlotChart, replayRef, cursorRef, seekRef, dragCursor, beginManualView]);

  return (
    <div
      className="plot-host"
      ref={hostRef}
      onPointerDown={(event) => {
        if (!replayRef.current || !seekRef.current) return;
        const chart = chartRef.current;
        if (!chart || cursorRef.current == null) return;
        const rect = chart.canvas.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const cursorX = chart.scales.x.getPixelForValue(cursorRef.current);
        if (Math.abs(px - cursorX) > 12) return;
        dragCursor.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        if (!dragCursor.current || !seekRef.current) return;
        const chart = chartRef.current;
        if (!chart) return;
        const rect = chart.canvas.getBoundingClientRect();
        const time = chart.scales.x.getValueForPixel(event.clientX - rect.left);
        if (time != null && Number.isFinite(time)) seekRef.current(time);
      }}
      onPointerUp={() => {
        dragCursor.current = false;
      }}
      onPointerCancel={() => {
        dragCursor.current = false;
      }}
    >
      <canvas ref={canvasRef} />
    </div>
  );
}
