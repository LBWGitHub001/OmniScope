import { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "../../shared/api";
import { useInstance } from "../../shared/instance";
import { useSSE } from "../../shared/useSSE";

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

    // Dark grid background
    ctx.fillStyle = "#090b10";
    ctx.fillRect(0, 0, w, h);

    // Crosshairs
    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();

    // Quad labels
    ctx.fillStyle = "rgba(0, 240, 255, 0.4)";
    ctx.font = "9px JetBrains Mono, monospace";
    ctx.fillText("Q2 (左上)", 6, 12);
    ctx.fillText("Q1 (右上)", w - 46, 12);
    ctx.fillText("Q3 (左下)", 6, h - 6);
    ctx.fillText("Q4 (右下)", w - 46, h - 6);

    // Sample points
    (status.samples || []).forEach((s) => {
      const px = 6 + Math.max(0, Math.min(1, s.x || 0)) * (w - 12);
      const py = 6 + Math.max(0, Math.min(1, s.y || 0)) * (h - 12);
      const r = Math.max(3, (s.size || 0.1) * 24);

      ctx.strokeStyle = "rgba(0, 240, 255, 0.6)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = "#00f0ff";
      ctx.beginPath();
      ctx.arc(px, py, 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
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
    <div className="feature-page" style={{ display: "flex", flexDirection: "column", height: "100%", background: "#06070a" }}>
      {/* Top HUD Toolbar */}
      <div
        className="feature-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "0 16px",
          height: "44px",
          background: "rgba(12, 15, 24, 0.95)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>目标车辆:</span>
          <select
            style={{ fontSize: "12px", minWidth: "140px", background: "var(--input)" }}
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
        </div>

        <div className="status-pill">
          <span className={activeSender ? "pulse-dot" : "pulse-dot off"}></span>
          <span>{activeSender ? `已连接 · ${pktsPerSec} pkt/s` : "等待信标"}</span>
        </div>

        {/* Board Detection State */}
        <span
          className={`state-tag ${status.board ? "s-connected" : "s-idle"}`}
          style={{ fontSize: "11px", padding: "2px 8px" }}
        >
          {status.board ? "棋盘格已锁定 (BOARD OK)" : "未检测到标定板"}
        </span>

        {/* Coverage Status */}
        <span
          className={`state-tag ${isReady ? "s-ok" : "s-warn"}`}
          style={{ fontSize: "11px", padding: "2px 8px" }}
        >
          {status.goodenough
            ? "覆盖度完备 (READY)"
            : sampleCount >= minSamples
            ? "样本充足，可求解"
            : `需更多位姿 (${sampleCount}/${minSamples})`}
        </span>

        <div className="spacer" />

        {/* Exposure Control */}
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>曝光:</span>
          <input
            type="range"
            min={500}
            max={30000}
            step={500}
            value={exposure}
            onChange={(e) => onExposureChange(Number(e.target.value))}
            style={{ width: "90px" }}
          />
          <span className="mono" style={{ fontSize: "11px", color: "var(--cyan)", width: "56px" }}>
            {exposure}µs
          </span>
        </div>
      </div>

      {/* Main Split Workbench */}
      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* Left Video HUD Stage */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "#040507",
            position: "relative",
            overflow: "hidden",
            padding: "16px",
          }}
        >
          {imgUrl ? (
            <div style={{ position: "relative", maxWidth: "100%", maxHeight: "100%", display: "flex" }}>
              <img
                src={imgUrl}
                alt="Camera Stream"
                style={{
                  maxWidth: "100%",
                  maxHeight: "calc(100vh - 140px)",
                  objectFit: "contain",
                  borderRadius: "6px",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.8)",
                  border: "1px solid rgba(0, 240, 255, 0.2)",
                }}
              />
              {/* Tactical Crosshair Corners */}
              <div className="hud-crosshair">
                <span className="hud-corner hud-corner-tl" />
                <span className="hud-corner hud-corner-tr" />
                <span className="hud-corner hud-corner-bl" />
                <span className="hud-corner hud-corner-br" />
              </div>
            </div>
          ) : (
            <div style={{ textAlign: "center", color: "var(--faint)" }}>
              <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text)" }}>等待标定图像流回传</div>
              <div style={{ fontSize: "12px", color: "var(--muted)", marginTop: "6px" }}>
                请确认车载客户端已启动标定程序 (app: calibrate)
              </div>
            </div>
          )}

          {/* Hint Overlay */}
          {status.hint && (
            <div
              style={{
                position: "absolute",
                bottom: "20px",
                background: "rgba(10, 14, 24, 0.85)",
                backdropFilter: "blur(12px)",
                border: "1px solid rgba(0, 240, 255, 0.3)",
                borderRadius: "6px",
                padding: "6px 16px",
                fontSize: "12px",
                color: "var(--cyan)",
                fontFamily: "var(--mono)",
              }}
            >
              {status.hint}
            </div>
          )}
        </div>

        {/* Right Side Control & Coverage Panel */}
        <div
          style={{
            width: "320px",
            background: "rgba(12, 15, 24, 0.95)",
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            padding: "16px",
            gap: "14px",
            overflowY: "auto",
          }}
        >
          {/* Action Button Matrix */}
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, color: "var(--faint)", textTransform: "uppercase", marginBottom: "8px" }}>
              标定动作控制 (Actions)
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
              <button
                type="button"
                className="primary"
                style={{ padding: "8px 0", fontSize: "12px" }}
                onClick={() => sendCmd("add")}
                disabled={!status.board}
                title="快捷键: 空格 或 A"
              >
                + 采样位姿 [Space]
              </button>
              <button
                type="button"
                className="ghost"
                style={{ padding: "8px 0", fontSize: "12px" }}
                onClick={() => sendCmd("drop")}
                disabled={sampleCount === 0}
                title="快捷键: D"
              >
                撤销上一帧 [D]
              </button>
              <button
                type="button"
                className="ghost"
                style={{ padding: "8px 0", fontSize: "12px", color: "var(--err)" }}
                onClick={() => sendCmd("reset")}
                disabled={sampleCount === 0}
                title="快捷键: R"
              >
                清空样本 [R]
              </button>
              <button
                type="button"
                className="primary"
                style={{
                  padding: "8px 0",
                  fontSize: "12px",
                  background: isReady ? "linear-gradient(135deg, #10b981, #059669)" : undefined,
                  borderColor: isReady ? "#10b981" : undefined,
                }}
                onClick={() => sendCmd("calibrate")}
                disabled={sampleCount < minSamples}
                title="快捷键: C"
              >
                一键标定求解 [C]
              </button>
            </div>
          </div>

          {/* 2D Coverage Distribution Map */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--faint)", textTransform: "uppercase" }}>
                平面空间覆盖分布
              </span>
              <span className="mono" style={{ fontSize: "11px", color: "var(--cyan)" }}>
                {sampleCount} 样本
              </span>
            </div>
            <canvas
              ref={canvasRef}
              width={286}
              height={190}
              style={{
                width: "100%",
                height: "190px",
                borderRadius: "6px",
                border: "1px solid var(--border)",
                display: "block",
              }}
            />
          </div>

          {/* Spatial Metric Bars */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <MetricBar label="X 轴横向覆盖" value={status.x || 0} />
            <MetricBar label="Y 轴纵向覆盖" value={status.y || 0} />
            <MetricBar label="距离深度跨度" value={status.size || 0} />
            <MetricBar label="倾角斜度偏转" value={status.skew || 0} />
          </div>

          {/* Calibration Result Card */}
          {(status.has_cam || status.calibrated_at || status.calib_done) && (
            <div
              style={{
                background: "rgba(16, 185, 129, 0.08)",
                border: "1px solid rgba(16, 185, 129, 0.3)",
                borderRadius: "6px",
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--green)" }}>
                  标定解算成功 [OK]
                </span>
                <span className="mono" style={{ fontSize: "11px", color: "var(--green)" }}>
                  RMS: {Number(status.reproj || 0).toFixed(4)} px
                </span>
              </div>

              {status.result_path && (
                <div className="mono" style={{ fontSize: "10px", color: "var(--muted)", wordBreak: "break-all" }}>
                  保存: {status.result_path}
                </div>
              )}

              {status.camera_matrix && (
                <div>
                  <div style={{ fontSize: "10px", color: "var(--faint)", marginBottom: "2px" }}>相机内参矩阵 K:</div>
                  <pre
                    className="mono"
                    style={{
                      margin: 0,
                      padding: "6px",
                      background: "rgba(0,0,0,0.4)",
                      borderRadius: "4px",
                      fontSize: "10px",
                      lineHeight: "14px",
                      color: "var(--text)",
                    }}
                  >
                    {formatMatrix(status.camera_matrix, 3)}
                  </pre>
                </div>
              )}

              {status.distort_coeffs && (
                <div>
                  <div style={{ fontSize: "10px", color: "var(--faint)", marginBottom: "2px" }}>畸变向量 D:</div>
                  <pre
                    className="mono"
                    style={{
                      margin: 0,
                      padding: "6px",
                      background: "rgba(0,0,0,0.4)",
                      borderRadius: "4px",
                      fontSize: "10px",
                      lineHeight: "14px",
                      color: "var(--text)",
                    }}
                  >
                    {status.distort_coeffs.map((v) => Number(v).toFixed(5)).join(", ")}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(1, value || 0));
  const isFull = pct >= 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--muted)" }}>
        <span>{label}</span>
        <span className="mono" style={{ color: isFull ? "var(--green)" : "var(--text-strong)" }}>
          {Math.round(pct * 100)}%
        </span>
      </div>
      <div style={{ height: "4px", background: "rgba(255,255,255,0.08)", borderRadius: "2px", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.round(pct * 100)}%`,
            background: isFull ? "var(--green)" : "var(--cyan)",
            transition: "width 0.2s ease",
          }}
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
