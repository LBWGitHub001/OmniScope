import type { MutableRefObject, RefObject } from "react";
import type { Chart } from "chart.js";

type TimeSeriesPaneProps = {
  active: boolean;
  hostRef: RefObject<HTMLDivElement>;
  canvasRef: RefObject<HTMLCanvasElement>;
  chartRef: MutableRefObject<Chart | null>;
  replayRef: MutableRefObject<boolean>;
  cursorRef: MutableRefObject<number | null>;
  seekRef: MutableRefObject<((time: number) => void) | undefined>;
  dragCursor: MutableRefObject<boolean>;
};

export function TimeSeriesPane({
  active,
  hostRef,
  canvasRef,
  chartRef,
  replayRef,
  cursorRef,
  seekRef,
  dragCursor,
}: TimeSeriesPaneProps) {
  if (!active) return <div className="pane-empty mono muted">绘图已在其他面板</div>;

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
