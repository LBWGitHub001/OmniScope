import { useEffect, useRef } from "react";
import { Chart } from "chart.js";

/// 通用 XY 曲线数据（plot 消息中的约定形状：{x:[], y:[], meta?}）
/// 典型用法为频域发布：x=频率(Hz), y=幅度, meta={xlabel:"Hz", kind:"spectrum", fs}
export type XyCurve = {
  x: number[];
  y: number[];
  meta?: Record<string, unknown>;
};

function toDb(v: number): number {
  return 20 * Math.log10(Math.max(Math.abs(v), 1e-9));
}

/// 通用 XY 曲线面板（频谱为其典型场景）
/// 样式与 plot 曲线面板一致：Chart.js line + ResizeObserver 自适应
export function XyPane({
  channel,
  curve,
  db = false,
  showPeak = false,
}: {
  channel: string;
  curve?: XyCurve;
  db?: boolean;
  showPeak?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const peakRef = useRef<{ x: number; y: number } | null>(null);
  const labelRef = useRef({ channel, xlabel: "" });

  const xlabel = curve?.meta?.xlabel != null ? String(curve.meta.xlabel) : "";
  labelRef.current = { channel, xlabel };

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const chart = new Chart(canvas, {
      type: "line",
      data: {
        datasets: [
          {
            label: channel,
            data: [],
            borderColor: "#4fc3f7",
            backgroundColor: "transparent",
            pointRadius: 0,
            borderWidth: 1.6,
          },
        ],
      },
      options: {
        animation: false,
        responsive: false,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
        },
        scales: {
          x: {
            type: "linear",
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
      plugins: [
        {
          id: "xyOverlay",
          afterDraw(ch) {
            const ctx = ch.ctx;
            const area = ch.chartArea;
            const lb = labelRef.current;
            ctx.save();
            // 轴单位标签（右上角）
            if (lb.xlabel) {
              ctx.fillStyle = "#8e8e9c";
              ctx.font = "11px ui-monospace, monospace";
              ctx.textAlign = "right";
              ctx.fillText(lb.xlabel, area.right - 4, area.top + 12);
            }
            // 最高峰标注
            const pk = peakRef.current;
            if (pk) {
              const px = ch.scales.x.getPixelForValue(pk.x);
              const py = ch.scales.y.getPixelForValue(pk.y);
              if (px >= area.left && px <= area.right && py >= area.top && py <= area.bottom) {
                ctx.fillStyle = "#e0b15a";
                ctx.beginPath();
                ctx.moveTo(px, py);
                ctx.lineTo(px - 5, py + 8);
                ctx.lineTo(px + 5, py + 8);
                ctx.closePath();
                ctx.fill();
                ctx.font = "11px ui-monospace, monospace";
                const nearRight = px > area.right - 90;
                ctx.textAlign = nearRight ? "right" : "left";
                const txt = `峰值 ${pk.x.toPrecision(4)}${lb.xlabel ? " " + lb.xlabel : ""}`;
                ctx.fillText(txt, nearRight ? px - 8 : px + 8, py + 4);
              }
            }
            ctx.restore();
          },
        },
      ],
    });
    chartRef.current = chart;
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
    let resizeFrame = 0;
    const ro = new ResizeObserver(() => {
      if (resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        fit();
      });
    });
    ro.observe(host);
    fit();
    return () => {
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      ro.disconnect();
      chart.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const xs = curve?.x || [];
    const ys = curve?.y || [];
    const data: { x: number; y: number }[] = [];
    let peak: { x: number; y: number } | null = null;
    let maxV = -Infinity;
    const n = Math.min(xs.length, ys.length);
    for (let i = 0; i < n; i++) {
      const xv = Number(xs[i]);
      let yv = Number(ys[i]);
      if (!Number.isFinite(xv) || !Number.isFinite(yv)) continue;
      if (db) yv = toDb(yv);
      data.push({ x: xv, y: yv });
      if (yv > maxV) {
        maxV = yv;
        peak = { x: xv, y: yv };
      }
    }
    peakRef.current = showPeak ? peak : null;
    chart.data.datasets[0].data = data;
    chart.data.datasets[0].label = channel;
    chart.update("none");
  }, [curve, db, showPeak, channel]);

  return (
    <div className="plot-host" ref={hostRef}>
      <canvas ref={canvasRef} />
      {!curve && (
        <div className="pane-empty mono muted">
          {channel ? `等待 XY 曲线数据：${channel}…` : "等待 XY 曲线通道…"}
        </div>
      )}
    </div>
  );
}
