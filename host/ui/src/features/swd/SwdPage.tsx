import { useEffect, useMemo, useRef, useState } from "react";
import { Chart, LineController, LineElement, PointElement, LinearScale, Legend } from "chart.js";
import { getJson, postJson } from "../../shared/api";
import { useInstance } from "../../shared/instance";
import { useSSE } from "../../shared/useSSE";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend);

const COLORS = [
  "#d6f56a",
  "#7ec8ff",
  "#ef7d6a",
  "#e6c15a",
  "#c9a0ff",
  "#8fdf7a",
  "#ff9ec8",
  "#7ee0d0",
];

type SymbolRow = {
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

type SwdSnapshot = {
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
  recording?: boolean;
  log?: string;
};

type ElfMatch = {
  name: string;
  addr: number;
  size: number;
  file?: string;
};

export function SwdPage() {
  const { base } = useInstance();
  const [snap, setSnap] = useState<SwdSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<ElfMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showSerial, setShowSerial] = useState(false);

  // Settings form state
  const [projectInput, setProjectInput] = useState("");
  const [hzInput, setHzInput] = useState(20);
  const [hostInput, setHostInput] = useState("127.0.0.1");
  const [portInput, setPortInput] = useState("");

  // Plot and view selection per symbol
  const [plotted, setPlotted] = useState<Record<string, boolean>>({});
  const [fieldMode, setFieldMode] = useState<Record<string, "f32" | "i32" | "u32" | "hex">>({});

  // Serial state
  const [serialPorts, setSerialPorts] = useState<{ device: string; description: string }[]>([]);
  const [serialDevice, setSerialDevice] = useState("");
  const [serialBaud, setSerialBaud] = useState(115200);
  const [serialOpen, setSerialOpen] = useState(false);
  const [serialLogs, setSerialLogs] = useState<{ dir: string; text: string }[]>([]);
  const [serialInput, setSerialInput] = useState("");
  const [serialHex, setSerialHex] = useState(false);

  // Time-series history for chart
  const historyRef = useRef<Record<string, { t: number; v: number }[]>>({});
  const chartCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartInstanceRef = useRef<Chart | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  // Initial load snapshot
  useEffect(() => {
    getJson<SwdSnapshot>(`${base}/snapshot`).then((st) => {
      setSnap(st);
      setProjectInput(st.project || "");
      setHzInput(st.hz || 20);
      setHostInput(st.host || "127.0.0.1");
      setPortInput(st.telnet_port ? String(st.telnet_port) : "");
      // Default plot all active symbols
      const p: Record<string, boolean> = {};
      st.symbols?.forEach((s) => {
        p[s.name] = true;
      });
      setPlotted(p);
    }).catch(() => {});
  }, [base]);

  // Search symbols debounce
  useEffect(() => {
    if (!search.trim()) {
      setMatches([]);
      setSearchErr("");
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      setSearchErr("");
      try {
        const res = await getJson<{ elf?: string; symbols: ElfMatch[]; error?: string }>(
          `${base}/symbols?q=${encodeURIComponent(search.trim())}`
        );
        if (res.error) setSearchErr(res.error);
        else setMatches(res.symbols || []);
      } catch (e) {
        setSearchErr(String(e));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, base]);

  // Load serial ports when opened
  useEffect(() => {
    if (showSerial) {
      getJson<{ ports: { device: string; description: string }[]; open: boolean; port: string; baud: number }>(
        `${base}/serial/ports`
      ).then((res) => {
        setSerialPorts(res.ports || []);
        setSerialOpen(res.open);
        if (res.port) setSerialDevice(res.port);
        if (res.baud) setSerialBaud(res.baud);
      }).catch(() => {});
    }
  }, [showSerial, base]);

  // Handle SSE events
  useSSE(`${base}/events`, (ev) => {
    const typ = ev.type as string;
    if (typ === "state") {
      setSnap(ev as unknown as SwdSnapshot);
    } else if (typ === "sample") {
      const s = ev as unknown as SymbolRow;
      setSnap((prev) => {
        if (!prev) return prev;
        const nextSymbols = prev.symbols.map((item) => (item.name === s.name ? { ...item, ...s } : item));
        return { ...prev, symbols: nextSymbols };
      });

      if (!isPaused && s.t) {
        const name = s.name;
        const mode = fieldMode[name] || (s.f32 !== null && s.f32 !== undefined ? "f32" : "u32");
        let val: number | null = null;
        if (mode === "f32" && typeof s.f32 === "number") val = s.f32;
        else if (mode === "i32" && typeof s.i32 === "number") val = s.i32;
        else if (typeof s.u32 === "number") val = s.u32;

        if (val !== null && Number.isFinite(val)) {
          if (!historyRef.current[name]) historyRef.current[name] = [];
          const arr = historyRef.current[name];
          arr.push({ t: s.t, v: val });
          if (arr.length > 300) arr.shift();
        }
      }
    } else if (typ === "serial") {
      const s = ev as { dir: string; text?: string; open?: boolean };
      if (s.dir === "status" && typeof s.open === "boolean") {
        setSerialOpen(s.open);
      } else if (s.text) {
        setSerialLogs((prev) => [...prev.slice(-100), { dir: s.dir, text: s.text || "" }]);
      }
    }
  });

  // Chart setup and animation loop
  useEffect(() => {
    if (!chartCanvasRef.current) return;
    const ctx = chartCanvasRef.current.getContext("2d");
    if (!ctx) return;

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
              color: "rgba(204, 204, 220, 0.4)",
              font: { family: "IBM Plex Mono", size: 10 },
              callback: (val) => `${Number(val).toFixed(1)}s`,
            },
            grid: { color: "rgba(255, 255, 255, 0.05)" },
          },
          y: {
            display: true,
            ticks: {
              color: "rgba(204, 204, 220, 0.4)",
              font: { family: "IBM Plex Mono", size: 10 },
            },
            grid: { color: "rgba(255, 255, 255, 0.05)" },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: "#ccccdc",
              font: { family: "IBM Plex Mono", size: 11 },
              boxWidth: 12,
            },
          },
        },
      },
    });

    chartInstanceRef.current = chart;

    let animId = 0;
    const updateChart = () => {
      const symbols = snap?.symbols || [];
      const datasets = symbols
        .filter((s) => plotted[s.name] !== false)
        .map((s, idx) => {
          const hist = historyRef.current[s.name] || [];
          const t0 = hist[0]?.t || 0;
          return {
            label: s.name,
            borderColor: COLORS[idx % COLORS.length],
            backgroundColor: COLORS[idx % COLORS.length],
            borderWidth: 1.5,
            pointRadius: 0,
            data: hist.map((pt) => ({ x: pt.t - t0, y: pt.v })),
          };
        });

      chart.data.datasets = datasets;
      chart.update("none");
      animId = requestAnimationFrame(updateChart);
    };

    animId = requestAnimationFrame(updateChart);

    return () => {
      cancelAnimationFrame(animId);
      chart.destroy();
      chartInstanceRef.current = null;
    };
  }, [snap?.symbols, plotted]);

  // Actions
  const addSymbol = async (name: string) => {
    try {
      const res = await postJson<SwdSnapshot>(`${base}/symbols/add`, { name });
      setSnap(res);
      setPlotted((prev) => ({ ...prev, [name]: true }));
      setSearch("");
      setMatches([]);
    } catch (e) {
      alert(`添加符号失败: ${e}`);
    }
  };

  const removeSymbol = async (name: string) => {
    try {
      const res = await postJson<SwdSnapshot>(`${base}/symbols/remove`, { name });
      setSnap(res);
      delete historyRef.current[name];
    } catch (e) {
      alert(`移除符号失败: ${e}`);
    }
  };

  const saveSettings = async () => {
    try {
      const res = await postJson<SwdSnapshot>(`${base}/settings`, {
        project: projectInput.trim(),
        hz: hzInput,
        host: hostInput.trim(),
        telnet_port: portInput.trim() ? Number(portInput.trim()) : null,
      });
      setSnap(res);
      setShowSettings(false);
    } catch (e) {
      alert(`保存设置失败: ${e}`);
    }
  };

  const clearChart = () => {
    historyRef.current = {};
  };

  const toggleSerial = async () => {
    try {
      if (serialOpen) {
        await postJson(`${base}/serial/close`, {});
        setSerialOpen(false);
      } else {
        await postJson(`${base}/serial/open`, { port: serialDevice, baud: serialBaud });
        setSerialOpen(true);
      }
    } catch (e) {
      alert(`串口操作失败: ${e}`);
    }
  };

  const sendSerial = async () => {
    if (!serialInput) return;
    try {
      await postJson(`${base}/serial/send`, {
        mode: serialHex ? "hex" : "text",
        data: serialInput,
        newline: true,
      });
      setSerialInput("");
    } catch (e) {
      alert(`发送失败: ${e}`);
    }
  };

  const phaseTag = useMemo(() => {
    const ph = snap?.phase || "waiting";
    switch (ph) {
      case "streaming":
        return { text: "实时监视", cls: "s-connected" };
      case "connecting":
        return { text: "正在连接", cls: "s-warn" };
      case "idle":
        return { text: "已连接(空闲)", cls: "s-ok" };
      case "reconnecting":
        return { text: "重连中", cls: "s-warn" };
      case "error":
        return { text: "异常", cls: "s-err" };
      default:
        return { text: "等待 OpenOCD", cls: "s-idle" };
    }
  }, [snap?.phase]);

  return (
    <div className="feature-page" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Top status bar */}
      <div
        className="feature-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "6px 14px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface)",
        }}
      >
        <span className={`state-tag ${phaseTag.cls}`} style={{ fontWeight: 600 }}>
          {phaseTag.text}
        </span>
        <span className="mono" style={{ fontSize: "12px", color: "var(--muted)" }}>
          {snap?.message}
        </span>
        <div style={{ flex: 1 }} />
        {snap?.elf && (
          <span className="mono" style={{ fontSize: "11px", color: "var(--faint)" }} title={snap.elf}>
            ELF: {snap.elf.split("/").pop()}
          </span>
        )}
        <span className="mono" style={{ fontSize: "12px", color: "var(--ok)" }}>
          {snap?.stats?.hz || 0} Hz
        </span>
        <span className="mono" style={{ fontSize: "12px", color: "var(--muted)" }}>
          RTT {snap?.stats?.rtt_p50 || 0}ms
        </span>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: "12px", padding: "2px 8px" }}
          onClick={() => setShowSettings(!showSettings)}
        >
          ⚙ 设置
        </button>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: "12px", padding: "2px 8px" }}
          onClick={() => setShowSerial(!showSerial)}
        >
          📟 串口
        </button>
      </div>

      {/* Settings Dropdown/Drawer */}
      {showSettings && (
        <div
          style={{
            padding: "12px 16px",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
            gap: "10px",
            alignItems: "center",
          }}
        >
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block" }}>工程路径 (包含 ELF)</label>
            <input
              style={{ width: "100%", padding: "4px 8px", fontSize: "12px" }}
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              placeholder="/path/to/firmware"
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block" }}>目标采样率 (Hz)</label>
            <input
              type="number"
              min={1}
              max={50}
              style={{ width: "100%", padding: "4px 8px", fontSize: "12px" }}
              value={hzInput}
              onChange={(e) => setHzInput(Number(e.target.value))}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block" }}>OpenOCD Host</label>
            <input
              style={{ width: "100%", padding: "4px 8px", fontSize: "12px" }}
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block" }}>Telnet 端口 (留空自动)</label>
            <input
              style={{ width: "100%", padding: "4px 8px", fontSize: "12px" }}
              value={portInput}
              placeholder="4444"
              onChange={(e) => setPortInput(e.target.value)}
            />
          </div>
          <button
            type="button"
            style={{ alignSelf: "flex-end", padding: "5px 12px", fontSize: "12px" }}
            onClick={saveSettings}
          >
            保存并应用
          </button>
        </div>
      )}

      {/* Main Workspace Split: Left Symbols, Right Waveform */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left Side: Symbol Search & Watched Variables */}
        <div
          style={{
            width: "360px",
            borderRight: "1px solid var(--border)",
            background: "var(--canvas)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {/* Symbol Search Bar */}
          <div style={{ padding: "10px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ position: "relative" }}>
              <input
                style={{ width: "100%", padding: "6px 10px", fontSize: "12px" }}
                placeholder="搜索全局符号 (nm -S)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {searching && (
                <span
                  style={{
                    position: "absolute",
                    right: "10px",
                    top: "7px",
                    fontSize: "11px",
                    color: "var(--muted)",
                  }}
                >
                  搜索中…
                </span>
              )}
            </div>

            {searchErr && (
              <p style={{ margin: "6px 0 0", color: "var(--err)", fontSize: "11px" }}>{searchErr}</p>
            )}

            {/* Match suggestions */}
            {matches.length > 0 && (
              <div
                style={{
                  maxHeight: "160px",
                  overflowY: "auto",
                  marginTop: "6px",
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  borderRadius: "4px",
                }}
              >
                {matches.map((m) => (
                  <div
                    key={m.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 8px",
                      borderBottom: "1px solid var(--hairline)",
                      fontSize: "12px",
                    }}
                  >
                    <div>
                      <div className="mono" style={{ fontWeight: 600 }}>
                        {m.name}
                      </div>
                      <div className="mono" style={{ fontSize: "10px", color: "var(--muted)" }}>
                        0x{m.addr.toString(16).toUpperCase()} · {m.size}B {m.file ? `· ${m.file}` : ""}
                      </div>
                    </div>
                    <button
                      type="button"
                      style={{ padding: "2px 8px", fontSize: "11px" }}
                      onClick={() => addSymbol(m.name)}
                    >
                      + 监视
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Active Watched Symbols List */}
          <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
            <div
              style={{
                fontSize: "11px",
                color: "var(--muted)",
                padding: "2px 4px 6px",
                display: "flex",
                justifyContent: "space-between",
              }}
            >
              <span>监视列表 ({snap?.symbols?.length || 0}/8)</span>
              <span>数值类型</span>
            </div>

            {(!snap?.symbols || snap.symbols.length === 0) && (
              <p style={{ padding: "20px 8px", textAlign: "center", color: "var(--faint)", fontSize: "12px" }}>
                暂无监视符号。请在上方搜索并添加全局变量。
              </p>
            )}

            {snap?.symbols?.map((row, idx) => {
              const color = COLORS[idx % COLORS.length];
              const mode = fieldMode[row.name] || (row.f32 !== null && row.f32 !== undefined ? "f32" : "u32");
              let valDisplay = "---";
              if (row.error) {
                valDisplay = `[Err: ${row.error}]`;
              } else if (mode === "f32" && typeof row.f32 === "number") {
                valDisplay = row.f32.toFixed(4);
              } else if (mode === "i32" && typeof row.i32 === "number") {
                valDisplay = String(row.i32);
              } else if (mode === "hex" && row.words?.length) {
                valDisplay = `0x${row.words[0]}`;
              } else if (typeof row.u32 === "number") {
                valDisplay = String(row.u32);
              }

              return (
                <div
                  key={row.name}
                  style={{
                    background: "var(--surface)",
                    border: `1px solid ${plotted[row.name] !== false ? color : "var(--border)"}`,
                    borderRadius: "4px",
                    padding: "8px 10px",
                    marginBottom: "8px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <input
                        type="checkbox"
                        checked={plotted[row.name] !== false}
                        onChange={(e) => setPlotted({ ...plotted, [row.name]: e.target.checked })}
                        title="在右侧波形图绘制"
                      />
                      <span className="mono" style={{ fontWeight: 600, color }}>
                        {row.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      style={{ padding: "0 4px", fontSize: "12px", color: "var(--err)" }}
                      onClick={() => removeSymbol(row.name)}
                      title="移除监视"
                    >
                      ×
                    </button>
                  </div>

                  <div
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      justifyContent: "space-between",
                      marginTop: "6px",
                    }}
                  >
                    <span className="mono" style={{ fontSize: "18px", fontWeight: 700, color: "var(--text-strong)" }}>
                      {valDisplay}
                    </span>
                    <select
                      style={{ fontSize: "11px", padding: "1px 4px", background: "var(--input)" }}
                      value={mode}
                      onChange={(e) => setFieldMode({ ...fieldMode, [row.name]: e.target.value as any })}
                    >
                      <option value="f32">float32</option>
                      <option value="i32">int32</option>
                      <option value="u32">uint32</option>
                      <option value="hex">hex</option>
                    </select>
                  </div>

                  <div
                    className="mono"
                    style={{
                      display: "flex",
                      gap: "8px",
                      fontSize: "10px",
                      color: "var(--muted)",
                      marginTop: "4px",
                    }}
                  >
                    {row.addr && <span>{row.addr}</span>}
                    {row.size && <span>{row.size}B</span>}
                    {row.rtt_ms && <span>{row.rtt_ms}ms</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Real-time Waveform Chart */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
              background: "var(--surface)",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "12px" }}>实时变量波形 (SWD Live Waveform)</span>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="ghost"
                style={{ fontSize: "11px", padding: "2px 8px" }}
                onClick={() => setIsPaused(!isPaused)}
              >
                {isPaused ? "▶ 恢复" : "⏸ 暂停"}
              </button>
              <button
                type="button"
                className="ghost"
                style={{ fontSize: "11px", padding: "2px 8px" }}
                onClick={clearChart}
              >
                清空波形
              </button>
            </div>
          </div>
          <div style={{ flex: 1, position: "relative", padding: "10px", minHeight: 0 }}>
            <canvas ref={chartCanvasRef} />
          </div>

          {/* Optional Serial Console Drawer */}
          {showSerial && (
            <div
              style={{
                height: "220px",
                borderTop: "1px solid var(--border)",
                background: "var(--surface)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "4px 8px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: "12px",
                }}
              >
                <span>串口终端:</span>
                <select
                  style={{ fontSize: "11px", padding: "2px 6px" }}
                  value={serialDevice}
                  onChange={(e) => setSerialDevice(e.target.value)}
                >
                  <option value="">选择串口设备</option>
                  {serialPorts.map((p) => (
                    <option key={p.device} value={p.device}>
                      {p.device} ({p.description})
                    </option>
                  ))}
                </select>
                <select
                  style={{ fontSize: "11px", padding: "2px 6px" }}
                  value={serialBaud}
                  onChange={(e) => setSerialBaud(Number(e.target.value))}
                >
                  <option value={9600}>9600</option>
                  <option value={115200}>115200</option>
                  <option value={921600}>921600</option>
                  <option value={2000000}>2000000</option>
                </select>
                <button
                  type="button"
                  style={{ fontSize: "11px", padding: "2px 8px" }}
                  onClick={toggleSerial}
                >
                  {serialOpen ? "关闭串口" : "打开串口"}
                </button>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="ghost"
                  style={{ fontSize: "11px" }}
                  onClick={() => setSerialLogs([])}
                >
                  清屏
                </button>
              </div>

              <div
                className="mono"
                style={{
                  flex: 1,
                  overflowY: "auto",
                  padding: "6px 10px",
                  fontSize: "11px",
                  background: "var(--canvas)",
                }}
              >
                {serialLogs.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      color: item.dir === "tx" ? "var(--ok)" : item.dir === "error" ? "var(--err)" : "var(--text)",
                    }}
                  >
                    <span style={{ color: "var(--muted)", marginRight: "6px" }}>
                      {item.dir === "tx" ? "TX ->" : "RX <-"}
                    </span>
                    {item.text}
                  </div>
                ))}
              </div>

              <div style={{ display: "flex", gap: "6px", padding: "4px 8px", borderTop: "1px solid var(--border)" }}>
                <input
                  style={{ flex: 1, padding: "4px 8px", fontSize: "12px" }}
                  placeholder={serialHex ? "16进制发送 (如: 01 02 A3)" : "发送文本..."}
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendSerial()}
                />
                <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px" }}>
                  <input type="checkbox" checked={serialHex} onChange={(e) => setSerialHex(e.target.checked)} />
                  HEX
                </label>
                <button type="button" style={{ fontSize: "11px", padding: "2px 10px" }} onClick={sendSerial}>
                  发送
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
