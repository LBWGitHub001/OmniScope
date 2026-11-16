import { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "../../shared/api";
import { useInstance } from "../../shared/instance";
import { useSSE } from "../../shared/useSSE";
import "./calibrate.css";

type CalibSample = { x: number; y: number; size: number };

type CalibStatus = {
  calib?: boolean;
  n?: number;
  min_n?: number;
  x?: number;
  y?: number;
  size?: number;
  skew?: number;
  board?: boolean;
  goodenough?: boolean;
  has_cam?: boolean;
  reproj?: number;
  calibrated_at?: string;
  saved?: boolean;
  result_path?: string;
  camera_matrix?: number[];
  distort_coeffs?: number[];
  samples?: CalibSample[];
  hint?: string;
  calib_done?: boolean;
  exposure_us?: number;
};

export function CalibratePage() {
  const { base } = useInstance();
  const [senders, setSenders] = useState<string[]>([]);
  const [activeSender, setActiveSender] = useState("");
  const [status, setStatus] = useState<CalibStatus>({});
  const [imgUrl, setImgUrl] = useState<string>("");
  const [exposure, setExposure] = useState<number>(5000);
  const [exposureSynced, setExposureSynced] = useState<boolean>(false);
  const [pktsPerSec, setPktsPerSec] = useState<number>(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pktCounter = useRef<number>(0);
  const expTimer = useRef<number | null>(null);

  // Initial load
  useEffect(() => {
    getJson<{ senders?: string[]; active_sender?: string }>(`${base}/state`).then((st) => {
      if (st.senders) setSenders(st.senders);
      if (st.active_sender) setActiveSender(st.active_sender);
    }).catch(() => {});
  }, [base]);

  // Handle SSE events
  useSSE(`${base}/events`, (ev) => {
    pktCounter.current += 1;
    if (ev.type === "state") {
      const s = ev.senders as string[];
      if (s) setSenders(s);
      if (ev.active_sender) setActiveSender(String(ev.active_sender));
    } else if (ev.type === "image") {
      const b64 = ev.jpg_b64 as string;
      const meta = ev.meta as { name?: string };
      if (!meta?.name || meta.name === "calibrate") {
        setImgUrl(`data:image/jpeg;base64,${b64}`);
      }
    } else if (ev.type === "plot") {
      const data = ev.data as CalibStatus;
      if (data?.calib) {
        setStatus(data);
        if (data.exposure_us && !exposureSynced) {
          setExposure(data.exposure_us);
          setExposureSynced(true);
        }
      }
    }
  });

  // FPS / Packet rate interval
  useEffect(() => {
    let last = 0;
    const t = setInterval(() => {
      setPktsPerSec(pktCounter.current - last);
      last = pktCounter.current;
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // Draw 2D Coverage XY distribution canvas
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const w = c.width;
    const h = c.height;
    const computed = getComputedStyle(c);
    const themeColor = (name: string) => computed.getPropertyValue(name).trim();

    ctx.globalAlpha = 1;
    ctx.fillStyle = themeColor("--canvas");
    ctx.fillRect(0, 0, w, h);

    // Crosshairs
    ctx.strokeStyle = themeColor("--border");
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Quad labels
    ctx.fillStyle = themeColor("--faint");
    ctx.font = `9px ${themeColor("--mono") || "monospace"}`;
    ctx.fillText("Q2 (左上)", 6, 12);
    ctx.fillText("Q1 (右上)", w - 58, 12);
    ctx.fillText("Q3 (左下)", 6, h - 6);
    ctx.fillText("Q4 (右下)", w - 58, h - 6);

    // Sample points
    (status.samples || []).forEach((s) => {
      const px = 6 + Math.max(0, Math.min(1, s.x || 0)) * (w - 12);
      const py = 6 + Math.max(0, Math.min(1, s.y || 0)) * (h - 12);
      const r = Math.max(3, (s.size || 0.1) * 24);

      ctx.globalAlpha = 0.65;
      ctx.strokeStyle = themeColor("--accent");
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = themeColor("--accent");
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [status.samples]);

  // Send calibrate command
  const sendCmd = async (cmd: string) => {
    try {
      await postJson(`${base}/calib`, { cmd });
    } catch (e) {
      alert(`命令执行失败: ${e}`);
    }
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName || "";
      if (tag === "INPUT" || tag === "SELECT") return;
      if (e.code === "Space" || e.key === "a" || e.key === "A") {
        e.preventDefault();
        sendCmd("add");
      } else if (e.key === "d" || e.key === "D") {
        sendCmd("drop");
      } else if (e.key === "r" || e.key === "R") {
        sendCmd("reset");
      } else if (e.key === "c" || e.key === "C") {
        if ((status.n || 0) >= (status.min_n || 20)) {
          sendCmd("calibrate");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [status.n, status.min_n]);

  const onExposureChange = (val: number) => {
    setExposure(val);
    if (expTimer.current) clearTimeout(expTimer.current);
    expTimer.current = window.setTimeout(async () => {
      try {
        await postJson(`${base}/calib`, { cmd: "set_exposure", exposure_us: val });
      } catch {
        /* ignore */
      }
    }, 120);
  };

  const onSelectSender = async (name: string) => {
    setActiveSender(name);
    try {
      await getJson(`${base}/select?sender=${encodeURIComponent(name)}`);
    } catch {
      /* ignore */
    }
  };

  const sampleCount = status.n || 0;
  const minSamples = status.min_n || 20;
  const isReady = status.goodenough || sampleCount >= minSamples;

  return (
    <div className="feature-page calibrate-page">
      <div className="calibrate-toolbar">
        <label className="calibrate-field">
          <span className="calibrate-field-label">目标车辆</span>
          <select
            className="calibrate-select calibrate-sender-select"
            value={activeSender}
            onChange={(e) => onSelectSender(e.target.value)}
          >
            {senders.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
            {senders.length === 0 && <option value="">等待广播车辆...</option>}
          </select>
        </label>

        <span className={`calibrate-connection ${activeSender ? "is-active" : ""}`}>
          {activeSender ? `已连接 · ${pktsPerSec} pkt/s` : "等待信标"}
        </span>
        <span className={`calibrate-state ${status.board ? "is-ok" : ""}`}>
          {status.board ? "标定板已锁定" : "未检测到标定板"}
        </span>
        <span className={`calibrate-state ${isReady ? "is-ok" : "is-warn"}`}>
          {status.goodenough
            ? "覆盖度完备"
            : sampleCount >= minSamples
            ? "样本充足，可求解"
            : `样本 ${sampleCount}/${minSamples}`}
        </span>

        <div className="calibrate-toolbar-spacer" />

        <label className="calibrate-field calibrate-exposure-field">
          <span className="calibrate-field-label">曝光</span>
          <input
            className="calibrate-exposure-range"
            type="range"
            min={500}
            max={30000}
            step={500}
            value={exposure}
            onChange={(e) => onExposureChange(Number(e.target.value))}
          />
          <span className="mono calibrate-exposure-value">{exposure} µs</span>
        </label>
      </div>

      <div className="calibrate-workbench">
        <section className="calibrate-image-stage" aria-label="标定图像">
          {imgUrl ? (
            <img className="calibrate-image" src={imgUrl} alt="标定相机图像" />
          ) : (
            <div className="calibrate-empty">
              <div className="calibrate-empty-title">等待标定图像</div>
              <div className="calibrate-empty-detail">图像流：calibrate</div>
            </div>
          )}

          {status.hint && <div className="calibrate-hint" role="status">{status.hint}</div>}
        </section>

        <aside className="calibrate-sidebar">
          <section className="calibrate-panel">
            <div className="calibrate-panel-heading">
              <h2>采样与求解</h2>
              <span className="mono">{sampleCount}/{minSamples}</span>
            </div>
            <div className="calibrate-action-grid">
              <button
                type="button"
                className="calibrate-button is-primary"
                onClick={() => sendCmd("add")}
                disabled={!status.board}
                title="快捷键: 空格 或 A"
              >
                + 采样位姿
              </button>
              <button
                type="button"
                className="calibrate-button"
                onClick={() => sendCmd("drop")}
                disabled={sampleCount === 0}
                title="快捷键: D"
              >
                撤销上一帧
              </button>
              <button
                type="button"
                className="calibrate-button is-danger"
                onClick={() => sendCmd("reset")}
                disabled={sampleCount === 0}
                title="快捷键: R"
              >
                清空样本
              </button>
              <button
                type="button"
                className={`calibrate-button ${isReady ? "is-ready" : "is-primary"}`}
                onClick={() => sendCmd("calibrate")}
                disabled={sampleCount < minSamples}
                title="快捷键: C"
              >
                标定求解
              </button>
            </div>
          </section>

          <section className="calibrate-panel">
            <div className="calibrate-panel-heading">
              <h2>平面覆盖分布</h2>
              <span className="mono calibrate-sample-count">{sampleCount} 样本</span>
            </div>
            <canvas
              className="calibrate-coverage"
              ref={canvasRef}
              width={286}
              height={190}
              role="img"
              aria-label="标定样本平面覆盖分布"
            />
            <div className="calibrate-metrics">
              <MetricBar label="X 轴横向覆盖" value={status.x || 0} />
              <MetricBar label="Y 轴纵向覆盖" value={status.y || 0} />
              <MetricBar label="距离深度跨度" value={status.size || 0} />
              <MetricBar label="倾角斜度偏转" value={status.skew || 0} />
            </div>
          </section>

          {(status.has_cam || status.calibrated_at || status.calib_done) && (
            <section className="calibrate-panel calibrate-result" aria-live="polite">
              <div className="calibrate-panel-heading">
                <h2>标定结果</h2>
                <span className="mono calibrate-result-rms">
                  RMS {Number(status.reproj || 0).toFixed(4)} px
                </span>
              </div>

              {status.result_path && (
                <div className="mono calibrate-result-path">保存：{status.result_path}</div>
              )}

              {status.camera_matrix && (
                <div className="calibrate-matrix">
                  <div className="calibrate-matrix-label">相机内参矩阵 K</div>
                  <pre className="calibrate-matrix-value">{formatMatrix(status.camera_matrix, 3)}</pre>
                </div>
              )}

              {status.distort_coeffs && (
                <div className="calibrate-matrix">
                  <div className="calibrate-matrix-label">畸变向量 D</div>
                  <pre className="calibrate-matrix-value">
                    {status.distort_coeffs.map((v) => Number(v).toFixed(5)).join(", ")}
                  </pre>
                </div>
              )}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  const isFull = pct >= 1;
  return (
    <div className="calibrate-metric">
      <div className="calibrate-metric-heading">
        <span>{label}</span>
        <span className={`mono calibrate-metric-value ${isFull ? "is-full" : ""}`}>
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div className="calibrate-metric-track">
        <div
          className={`calibrate-metric-fill ${isFull ? "is-full" : ""}`}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}

function formatMatrix(vec: number[], cols: number): string {
  const lines: string[] = [];
  for (let i = 0; i < vec.length; i += cols) {
    lines.push(vec.slice(i, i + cols).map((x) => Number(x).toFixed(2).padStart(8, " ")).join(", "));
  }
  return lines.join("\n");
}
