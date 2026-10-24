import { useEffect, useMemo, useRef, useState } from "react";
import { Chart, LineController, LineElement, PointElement, LinearScale, Legend } from "chart.js";
import { getJson, postJson } from "../../shared/api";
import { useInstance } from "../../shared/instance";
import { useSSE } from "../../shared/useSSE";
import { compileExpr, type ExprFn } from "../../shared/expr";

Chart.register(LineController, LineElement, PointElement, LinearScale, Legend);

const COLORS = [
  "#00f0ff", // Cyber Cyan
  "#10b981", // Emerald Telemetry Green
  "#f59e0b", // Laser Amber
  "#8b5cf6", // Electric Violet
  "#ec4899", // Neon Pink
  "#06b6d4", // Electric Teal
  "#eab308", // Bright Yellow
  "#3b82f6", // Quantum Blue
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

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) {
    return <div style={{ width: 70, height: 20, borderBottom: "1px dashed rgba(255,255,255,0.1)" }} />;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 74;
  const height = 22;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((v - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = `M ${points.join(" L ")}`;

  return (
    <svg width={width} height={height} style={{ overflow: "visible", display: "block" }}>
      <path
        d={pathD}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${color}88)` }}
      />
    </svg>
  );
}

export function SwdPage() {
  const { base } = useInstance();
  const [snap, setSnap] = useState<SwdSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<ElfMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showSerial, setShowSerial] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [showMailbox, setShowMailbox] = useState(false);

  // Online memory write / hot tuning state
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [writeStatus, setWriteStatus] = useState<Record<string, "ok" | "err">>({});

  // Virtual formula channels state
  type FormulaItem = {
    id: number;
    expr: string;
    source: string;
    enabled: boolean;
    fn?: ExprFn | null;
    error?: string | null;
    color: string;
  };
  const [formulas, setFormulas] = useState<FormulaItem[]>([]);
  const [formulaDraft, setFormulaDraft] = useState("");
  const [formulaSource, setFormulaSource] = useState("");

  // MCU Mailbox tuning state
  const [mailboxAddr, setMailboxAddr] = useState("0x20000000");
  const [mailboxParams, setMailboxParams] = useState<number[]>(new Array(16).fill(0));


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

  // Time-series history for chart and sparklines
  const historyRef = useRef<Record<string, { t: number; v: number }[]>>({});
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
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

          // update mini sparklines
          setSparklines((prev) => {
            const cur = prev[name] || [];
            const next = [...cur.slice(-24), val as number];
            return { ...prev, [name]: next };
          });
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
              color: "rgba(200, 205, 216, 0.4)",
              font: { family: "JetBrains Mono, IBM Plex Mono", size: 10 },
              callback: (val) => `${Number(val).toFixed(1)}s`,
            },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
          },
          y: {
            display: true,
            ticks: {
              color: "rgba(200, 205, 216, 0.4)",
              font: { family: "JetBrains Mono, IBM Plex Mono", size: 10 },
            },
            grid: { color: "rgba(255, 255, 255, 0.04)" },
          },
        },
        plugins: {
          legend: {
            display: true,
            labels: {
              color: "#ffffff",
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

    chartInstanceRef.current = chart;

    let animId = 0;
    const updateChart = () => {
      const symbols = snap?.symbols || [];
      const datasets = symbols
        .filter((s) => plotted[s.name] !== false)
        .map((s, idx) => {
          const hist = historyRef.current[s.name] || [];
          const t0 = hist[0]?.t || 0;
          const color = COLORS[idx % COLORS.length];
          return {
            label: s.name,
            borderColor: color,
            backgroundColor: `${color}18`, // subtle gradient area
            borderWidth: 2,
            pointRadius: 0,
            fill: true,
            tension: 0.25,
            data: hist.map((pt) => ({ x: pt.t - t0, y: pt.v })),
          };
        });

      // Virtual formula curves
      formulas
        .filter((f) => f.enabled && f.fn && f.source)
        .forEach((f) => {
          const hist = historyRef.current[f.source] || [];
          const t0 = hist[0]?.t || 0;
          const pts = hist
            .map((pt) => {
              const y = f.fn!(pt.v);
              return Number.isFinite(y) ? { x: pt.t - t0, y } : null;
            })
            .filter(Boolean);
          datasets.push({
            label: `f(x): ${f.expr} [x=${f.source}]`,
            borderColor: f.color,
            backgroundColor: "transparent",
            borderWidth: 1.8,
            borderDash: [6, 4],
            pointRadius: 0,
            fill: false,
            tension: 0.2,
            data: pts as any,
          });
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
  }, [snap?.symbols, plotted, formulas]);

  // Actions
  const writeSymbol = async (name: string, val: string, fmt: string) => {
    try {
      const res = await postJson<{ ok: boolean; error?: string }>(`${base}/symbols/write`, {
        name,
        value: val,
        fmt,
      });
      if (!res.ok) throw new Error(res.error || "写入失败");
      setWriteStatus((prev) => ({ ...prev, [name]: "ok" }));
      setEditingSymbol(null);
      setTimeout(() => {
        setWriteStatus((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }, 2000);
    } catch (e) {
      alert(`写入变量 ${name} 失败: ${e}`);
      setWriteStatus((prev) => ({ ...prev, [name]: "err" }));
    }
  };

  const writeMailboxParam = async (slot: number, val: number) => {
    try {
      const res = await postJson<{ ok: boolean; error?: string }>(`${base}/mailbox/write`, {
        mailbox_addr: mailboxAddr,
        slot,
        value: val,
      });
      if (!res.ok) throw new Error(res.error || "Mailbox 写入失败");
      const next = [...mailboxParams];
      next[slot] = val;
      setMailboxParams(next);
    } catch (e) {
      alert(`Mailbox 写入槽位 #${slot} 失败: ${e}`);
    }
  };

  const addFormula = () => {
    const expr = formulaDraft.trim();
    if (!expr) return;
    const src = formulaSource || snap?.symbols?.[0]?.name || "";
    if (!src) {
      alert("请先选择自变量 x 对应的符号");
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
          color: COLORS[(prev.length + 3) % COLORS.length],
        },
      ]);
      setFormulaDraft("");
    } catch (e) {
      alert(`公式语法错误: ${e}`);
    }
  };

  const removeFormula = (id: number) => {
    setFormulas((prev) => prev.filter((f) => f.id !== id));
  };

  const toggleFormula = (id: number) => {
    setFormulas((prev) => prev.map((f) => (f.id === id ? { ...f, enabled: !f.enabled } : f)));
  };

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
    setSparklines({});
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
        return { text: "实时监视中", cls: "s-connected" };
      case "connecting":
        return { text: "正在连接", cls: "s-warn" };
      case "idle":
        return { text: "已连接(空闲)", cls: "s-ok" };
      case "reconnecting":
        return { text: "重连中", cls: "s-warn" };
      case "error":
        return { text: "通信异常", cls: "s-err" };
      default:
        return { text: "等待 OpenOCD", cls: "s-idle" };
    }
  }, [snap?.phase]);

  return (
    <div className="feature-page" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Top HUD Status Toolbar */}
      <div
        className="feature-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "0 16px",
          borderBottom: "1px solid var(--border)",
          background: "rgba(10, 12, 18, 0.85)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span className={`state-tag ${phaseTag.cls}`}>{phaseTag.text}</span>
          <span className="mono" style={{ fontSize: "12px", color: "var(--muted)" }}>
            {snap?.message}
          </span>
        </div>

        <div className="spacer" />

        {snap?.elf && (
          <div className="search-command-pill" title={snap.elf}>
            <span style={{ color: "var(--faint)" }}>ELF:</span>
            <span className="mono" style={{ color: "var(--text-strong)" }}>
              {snap.elf.split("/").pop()}
            </span>
          </div>
        )}

        {/* Live Metrics */}
        <div className="status-pill">
          <span className="pulse-dot"></span>
          <span>{snap?.stats?.hz || 0} Hz · {snap?.stats?.rtt_p50 || 0}ms RTT</span>
        </div>

        <button
          type="button"
          className="ghost"
          style={{ fontSize: "12px", padding: "4px 10px", color: showFormulas ? "var(--cyan)" : undefined }}
          onClick={() => setShowFormulas(!showFormulas)}
        >
          ƒ(x) 虚拟公式 {formulas.length > 0 && `(${formulas.length})`}
        </button>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: "12px", padding: "4px 10px", color: showMailbox ? "var(--amber)" : undefined }}
          onClick={() => setShowMailbox(!showMailbox)}
        >
          🎛 Mailbox 调参
        </button>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: "12px", padding: "4px 10px" }}
          onClick={() => setShowSettings(!showSettings)}
        >
          ⚙ 参数设置
        </button>
        <button
          type="button"
          className="ghost"
          style={{ fontSize: "12px", padding: "4px 10px" }}
          onClick={() => setShowSerial(!showSerial)}
        >
          📟 串口监控
        </button>
      </div>

      {/* Settings Drawer */}
      {showSettings && (
        <div
          style={{
            padding: "14px 20px",
            background: "var(--surface-2)",
            borderBottom: "1px solid var(--border)",
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
            gap: "12px",
            alignItems: "center",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: 3 }}>
              固件工程目录 (含 ELF)
            </label>
            <input
              style={{ width: "100%", fontSize: "12px" }}
              value={projectInput}
              onChange={(e) => setProjectInput(e.target.value)}
              placeholder="/path/to/firmware"
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: 3 }}>
              采样速率 (Hz)
            </label>
            <input
              type="number"
              min={1}
              max={50}
              style={{ width: "100%", fontSize: "12px" }}
              value={hzInput}
              onChange={(e) => setHzInput(Number(e.target.value))}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: 3 }}>
              OpenOCD Host
            </label>
            <input
              style={{ width: "100%", fontSize: "12px" }}
              value={hostInput}
              onChange={(e) => setHostInput(e.target.value)}
            />
          </div>
          <div>
            <label style={{ fontSize: "11px", color: "var(--muted)", display: "block", marginBottom: 3 }}>
              Telnet 端口
            </label>
            <input
              style={{ width: "100%", fontSize: "12px" }}
              value={portInput}
              placeholder="4444 (留空自动探测)"
              onChange={(e) => setPortInput(e.target.value)}
            />
          </div>
          <button type="button" className="primary" style={{ alignSelf: "flex-end", height: "32px" }} onClick={saveSettings}>
            应用变更
          </button>
        </div>
      )}

      {/* Formula Virtual Channels Drawer */}
      {showFormulas && (
        <div
          style={{
            padding: "12px 20px",
            background: "rgba(14, 18, 28, 0.95)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
          }}
        >
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--cyan)" }}>
              ƒ(x) 新建虚拟曲线:
            </span>
            <input
              style={{ flex: 1, fontSize: "12px" }}
              placeholder="输入数学表达式，例如: sin(x)   2*x   x^2   x*57.2958 (弧度转角度)   x*0.001"
              value={formulaDraft}
              onChange={(e) => setFormulaDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addFormula();
              }}
            />
            <select
              style={{ width: "160px", fontSize: "12px" }}
              value={formulaSource}
              onChange={(e) => setFormulaSource(e.target.value)}
            >
              <option value="">选择自变量 x 来源...</option>
              {snap?.symbols?.map((s) => (
                <option key={s.name} value={s.name}>
                  x = {s.name}
                </option>
              ))}
            </select>
            <button type="button" className="primary" onClick={addFormula}>
              + 添加通道
            </button>
          </div>

          {formulas.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "4px" }}>
              {formulas.map((f) => (
                <div
                  key={f.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "rgba(255,255,255,0.06)",
                    border: `1px solid ${f.color}66`,
                    padding: "3px 8px",
                    borderRadius: "4px",
                    fontSize: "12px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={f.enabled}
                    onChange={() => toggleFormula(f.id)}
                    title="在图表中显示/隐藏"
                  />
                  <code style={{ color: f.color, fontWeight: 600 }}>{f.expr}</code>
                  <span style={{ fontSize: "11px", color: "var(--muted)" }}>({f.source})</span>
                  <button
                    type="button"
                    className="ghost"
                    style={{ padding: "0 4px", fontSize: "12px", color: "var(--faint)" }}
                    onClick={() => removeFormula(f.id)}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* MCU Mailbox Parameter Tuning Drawer */}
      {showMailbox && (
        <div
          style={{
            padding: "14px 20px",
            background: "rgba(18, 22, 34, 0.98)",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--amber)" }}>
                🎛 MCU Mailbox 实时调参面板 (omniscope_mailbox_t)
              </span>
              <span className="mono" style={{ fontSize: "11px", color: "var(--muted)" }}>
                零停机·SWD非侵入式热整定·支持16槽位
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "11px", color: "var(--muted)" }}>基地址:</span>
              <input
                className="mono"
                style={{ width: "120px", fontSize: "12px", padding: "2px 6px" }}
                value={mailboxAddr}
                onChange={(e) => setMailboxAddr(e.target.value)}
                placeholder="0x20000000"
              />
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(8, 1fr)",
              gap: "8px",
            }}
          >
            {mailboxParams.map((val, idx) => (
              <div
                key={idx}
                style={{
                  background: "rgba(0,0,0,0.35)",
                  border: "1px solid var(--hairline)",
                  borderRadius: "4px",
                  padding: "6px 8px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "4px",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "var(--faint)" }}>
                  <span>P[{idx}]</span>
                  <span className="mono">{val.toFixed(3)}</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  className="mono"
                  style={{ width: "100%", fontSize: "12px", padding: "2px 4px" }}
                  value={val}
                  onChange={(e) => {
                    const next = [...mailboxParams];
                    next[idx] = parseFloat(e.target.value) || 0;
                    setMailboxParams(next);
                  }}
                  onBlur={() => writeMailboxParam(idx, mailboxParams[idx])}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") writeMailboxParam(idx, mailboxParams[idx]);
                  }}
                />
                <button
                  type="button"
                  style={{ fontSize: "10px", padding: "1px 0", height: "20px" }}
                  onClick={() => writeMailboxParam(idx, mailboxParams[idx])}
                >
                  写入
                </button>
              </div>
            ))}
          </div>
        </div>
      )}


      {/* Main Workspace Split: Left Symbol Watcher, Right Oscilloscope */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* Left Side: Symbol Watcher Card Table */}
        <div
          style={{
            width: "390px",
            borderRight: "1px solid var(--border)",
            background: "rgba(12, 14, 20, 0.7)",
            backdropFilter: "blur(16px)",
            display: "flex",
            flexDirection: "column",
            minHeight: 0,
          }}
        >
          {/* Symbol Search Bar */}
          <div style={{ padding: "12px", borderBottom: "1px solid var(--border)" }}>
            <div style={{ position: "relative" }}>
              <input
                style={{
                  width: "100%",
                  padding: "7px 12px",
                  fontSize: "12px",
                  background: "rgba(255,255,255,0.03)",
                  borderColor: "var(--border-light)",
                  borderRadius: "6px",
                }}
                placeholder="🔍 搜索全局符号 (nm -S)..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {searching && (
                <span style={{ position: "absolute", right: "12px", top: "8px", fontSize: "11px", color: "var(--cyan)" }}>
                  检索中…
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
                  maxHeight: "180px",
                  overflowY: "auto",
                  marginTop: "8px",
                  background: "var(--elevated)",
                  border: "1px solid var(--border-light)",
                  borderRadius: "6px",
                  boxShadow: "0 8px 24px rgba(0,0,0,0.6)",
                }}
              >
                {matches.map((m) => (
                  <div
                    key={m.name}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "8px 10px",
                      borderBottom: "1px solid var(--hairline)",
                    }}
                  >
                    <div>
                      <div className="mono" style={{ fontWeight: 600, color: "var(--text-strong)", fontSize: "12px" }}>
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
          <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
            <div
              style={{
                fontSize: "11px",
                fontWeight: 600,
                color: "var(--faint)",
                padding: "2px 4px 8px",
                display: "flex",
                justifyContent: "space-between",
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }}
            >
              <span>监视符号 ({snap?.symbols?.length || 0}/8)</span>
              <span>走势 · 解析</span>
            </div>

            {(!snap?.symbols || snap.symbols.length === 0) && (
              <div style={{ padding: "30px 10px", textAlign: "center", color: "var(--faint)" }}>
                <div style={{ fontSize: "20px", marginBottom: "8px" }}>📊</div>
                <div style={{ fontSize: "12px" }}>暂无监视变量</div>
                <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
                  在上方输入变量名进行模糊匹配添加
                </div>
              </div>
            )}

            {snap?.symbols?.map((row, idx) => {
              const color = COLORS[idx % COLORS.length];
              const mode = fieldMode[row.name] || (row.f32 !== null && row.f32 !== undefined ? "f32" : "u32");
              let valDisplay = "---";
              if (row.error) {
                valDisplay = `Err: ${row.error}`;
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
                    background: "rgba(18, 21, 30, 0.75)",
                    border: `1px solid ${plotted[row.name] !== false ? `${color}55` : "var(--border)"}`,
                    borderRadius: "6px",
                    padding: "10px 12px",
                    marginBottom: "8px",
                    transition: "all 0.15s ease",
                    boxShadow: plotted[row.name] !== false ? `0 2px 10px ${color}15` : "none",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <input
                        type="checkbox"
                        checked={plotted[row.name] !== false}
                        onChange={(e) => setPlotted({ ...plotted, [row.name]: e.target.checked })}
                        title="在右侧示波器绘制曲线"
                      />
                      <span className="mono" style={{ fontWeight: 600, color, fontSize: "13px" }}>
                        {row.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="ghost"
                      style={{ padding: "0 4px", fontSize: "14px", color: "var(--faint)" }}
                      onClick={() => removeSymbol(row.name)}
                      title="移除监视"
                    >
                      ✕
                    </button>
                  </div>

                  {/* Main Value and Sparkline Row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginTop: "8px",
                    }}
                  >
                    {editingSymbol === row.name ? (
                      <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                        <input
                          type="text"
                          className="mono"
                          style={{
                            width: "95px",
                            height: "24px",
                            fontSize: "13px",
                            padding: "0 4px",
                            background: "var(--input)",
                            color: "var(--cyan)",
                          }}
                          value={editVal}
                          autoFocus
                          onChange={(e) => setEditVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") writeSymbol(row.name, editVal, mode);
                            if (e.key === "Escape") setEditingSymbol(null);
                          }}
                        />
                        <button
                          type="button"
                          style={{ padding: "0 6px", height: "24px", fontSize: "11px" }}
                          onClick={() => writeSymbol(row.name, editVal, mode)}
                        >
                          写入
                        </button>
                        <button
                          type="button"
                          className="ghost"
                          style={{ padding: "0 4px", height: "24px", fontSize: "11px" }}
                          onClick={() => setEditingSymbol(null)}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div
                        style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
                        title="点击在线热改写变量值 (mww 无须暂停 CPU)"
                        onClick={() => {
                          setEditingSymbol(row.name);
                          setEditVal(valDisplay.startsWith("Err") ? "0" : valDisplay);
                        }}
                      >
                        <span
                          className="mono"
                          style={{
                            fontSize: "17px",
                            fontWeight: 700,
                            color:
                              writeStatus[row.name] === "ok"
                                ? "var(--green)"
                                : writeStatus[row.name] === "err"
                                ? "var(--err)"
                                : "var(--text-strong)",
                            letterSpacing: "-0.02em",
                            transition: "color 0.3s ease",
                          }}
                        >
                          {valDisplay}
                        </span>
                        <span style={{ fontSize: "11px", color: "var(--cyan)", opacity: 0.6 }} title="在线热改写">
                          ✎
                        </span>
                        {writeStatus[row.name] === "ok" && (
                          <span style={{ fontSize: "10px", color: "var(--green)" }}>✓已改写</span>
                        )}
                      </div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      {/* Mini Sparkline */}
                      <MiniSparkline data={sparklines[row.name] || []} color={color} />

                      {/* Mode selector */}
                      <select
                        style={{ fontSize: "11px", height: "24px", padding: "0 4px", background: "var(--input)" }}
                        value={mode}
                        onChange={(e) => setFieldMode({ ...fieldMode, [row.name]: e.target.value as any })}
                      >
                        <option value="f32">f32</option>
                        <option value="i32">i32</option>
                        <option value="u32">u32</option>
                        <option value="hex">hex</option>
                      </select>
                    </div>
                  </div>

                  {/* Metadata address and latency */}
                  <div
                    className="mono"
                    style={{
                      display: "flex",
                      gap: "10px",
                      fontSize: "10px",
                      color: "var(--muted)",
                      marginTop: "6px",
                    }}
                  >
                    {row.addr && <span>{row.addr}</span>}
                    {row.size && <span>{row.size}B</span>}
                    {row.rtt_ms && <span style={{ color: "var(--cyan)" }}>{row.rtt_ms}ms</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Oscilloscope Waveform Display */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "8px 16px",
              borderBottom: "1px solid var(--border)",
              background: "rgba(10, 12, 18, 0.8)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--text-strong)" }}>
                实时发光示波器 (Oscilloscope)
              </span>
              <span className="mono" style={{ fontSize: "11px", color: "var(--faint)" }}>
                · 滚屏波形实时渲染
              </span>
            </div>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                type="button"
                className="ghost"
                style={{ fontSize: "11px", padding: "3px 10px" }}
                onClick={() => setIsPaused(!isPaused)}
              >
                {isPaused ? "▶ 恢复" : "⏸ 暂停"}
              </button>
              <button
                type="button"
                className="ghost"
                style={{ fontSize: "11px", padding: "3px 10px" }}
                onClick={clearChart}
              >
                清空波形
              </button>
            </div>
          </div>

          <div
            style={{
              flex: 1,
              position: "relative",
              padding: "14px",
              minHeight: 0,
              background: "radial-gradient(ellipse at center, rgba(0,240,255,0.02) 0%, #06070a 100%)",
            }}
          >
            <canvas ref={chartCanvasRef} />
          </div>

          {/* Retractable Serial Console */}
          {showSerial && (
            <div
              style={{
                height: "230px",
                borderTop: "1px solid var(--border)",
                background: "rgba(8, 10, 16, 0.95)",
                backdropFilter: "blur(16px)",
                display: "flex",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "6px 12px",
                  borderBottom: "1px solid var(--border)",
                  fontSize: "12px",
                }}
              >
                <span style={{ fontWeight: 600, color: "var(--cyan)" }}>📟 硬件串口终端:</span>
                <select
                  style={{ fontSize: "11px", height: "26px" }}
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
                  style={{ fontSize: "11px", height: "26px" }}
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
                  style={{ fontSize: "11px", height: "26px", padding: "0 10px" }}
                  onClick={toggleSerial}
                >
                  {serialOpen ? "断开" : "连接串口"}
                </button>
                <div style={{ flex: 1 }} />
                <button
                  type="button"
                  className="ghost"
                  style={{ fontSize: "11px", height: "26px" }}
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
                  padding: "8px 12px",
                  fontSize: "11px",
                  background: "#050609",
                }}
              >
                {serialLogs.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      lineHeight: "1.6",
                      color: item.dir === "tx" ? "var(--green)" : item.dir === "error" ? "var(--err)" : "var(--text)",
                    }}
                  >
                    <span style={{ color: "var(--faint)", marginRight: "8px" }}>
                      {item.dir === "tx" ? "[TX →]" : "[RX ←]"}
                    </span>
                    {item.text}
                  </div>
                ))}
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  padding: "6px 12px",
                  borderTop: "1px solid var(--border)",
                  background: "var(--surface)",
                }}
              >
                <input
                  style={{ flex: 1, fontSize: "12px", height: "28px" }}
                  placeholder={serialHex ? "16进制发送 (如: 01 02 A3)..." : "发送控制文本..."}
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendSerial()}
                />
                <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--muted)" }}>
                  <input type="checkbox" checked={serialHex} onChange={(e) => setSerialHex(e.target.checked)} />
                  HEX
                </label>
                <button type="button" className="primary" style={{ height: "28px", padding: "0 12px" }} onClick={sendSerial}>
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
