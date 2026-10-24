import { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "../../shared/api";
import { useInstance } from "../../shared/instance";
import { useSSE } from "../../shared/useSSE";

type SerialMsg = {
  id: number;
  dir: "rx" | "tx" | "status" | "error";
  time: string;
  text?: string;
  hex?: string;
};

const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000, 2000000];

export function SerialPage() {
  const { base } = useInstance();
  const [ports, setPorts] = useState<{ device: string; description: string }[]>([]);
  const [selectedPort, setSelectedPort] = useState("");
  const [baud, setBaud] = useState(115200);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Console log state
  const [logs, setLogs] = useState<SerialMsg[]>([]);
  const [viewMode, setViewMode] = useState<"text" | "hex">("text");
  const [autoScroll, setAutoScroll] = useState(true);
  const [showTime, setShowTime] = useState(true);

  // Send state
  const [sendMode, setSendMode] = useState<"text" | "hex">("text");
  const [sendInput, setSendInput] = useState("");
  const [appendNewline, setAppendNewline] = useState(true);
  const [rxBytes, setRxBytes] = useState(0);
  const [txBytes, setTxBytes] = useState(0);

  const logContainerRef = useRef<HTMLDivElement | null>(null);

  // Fetch available ports
  const fetchPorts = async () => {
    try {
      const res = await getJson<{
        ports: { device: string; description: string }[];
        open: boolean;
        port: string;
        baud: number;
      }>(`${base}/ports`);
      setPorts(res.ports || []);
      setIsOpen(res.open);
      if (res.port) setSelectedPort(res.port);
      else if (!selectedPort && res.ports?.length) setSelectedPort(res.ports[0].device);
      if (res.baud) setBaud(res.baud);
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    fetchPorts();
  }, [base]);

  // Handle SSE events
  useSSE(`${base}/events`, (ev) => {
    if (ev.type === "serial") {
      const now = new Date();
      const timeStr = now.toTimeString().slice(0, 8) + "." + String(now.getMilliseconds()).padStart(3, "0");
      const dir = (ev.dir as any) || "rx";

      if (dir === "status") {
        setIsOpen(Boolean(ev.open));
        if (ev.port) setSelectedPort(String(ev.port));
        if (ev.baud) setBaud(Number(ev.baud));
      } else if (dir === "rx") {
        const text = String(ev.text || "");
        const hex = String(ev.hex || "");
        setRxBytes((b) => b + (text ? text.length : 0));
        setLogs((prev) => [
          ...prev.slice(-2000), // maintain maximum 2000 lines buffer
          { id: Date.now() + Math.random(), dir: "rx", time: timeStr, text, hex },
        ]);
      } else if (dir === "tx") {
        const text = String(ev.text || "");
        const hex = String(ev.hex || "");
        setTxBytes((b) => b + (text ? text.length : 0));
        setLogs((prev) => [
          ...prev.slice(-2000),
          { id: Date.now() + Math.random(), dir: "tx", time: timeStr, text, hex },
        ]);
      } else if (dir === "error") {
        setLogs((prev) => [
          ...prev.slice(-2000),
          { id: Date.now() + Math.random(), dir: "error", time: timeStr, text: String(ev.text) },
        ]);
      }
    }
  });

  // Auto-scroll logic
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const toggleConnection = async () => {
    setLoading(true);
    try {
      if (isOpen) {
        await postJson(`${base}/close`, {});
        setIsOpen(false);
      } else {
        if (!selectedPort) {
          alert("请先选择或输入串口设备");
          return;
        }
        const res = await postJson<{ ok: boolean; error?: string }>(`${base}/open`, {
          port: selectedPort,
          baud,
        });
        if (!res.ok) throw new Error(res.error || "连接串口失败");
        setIsOpen(true);
      }
    } catch (e) {
      alert(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!sendInput.trim()) return;
    try {
      const res = await postJson<{ ok: boolean; error?: string }>(`${base}/send`, {
        mode: sendMode,
        data: sendInput,
        newline: appendNewline,
      });
      if (!res.ok) throw new Error(res.error || "发送失败");
      setSendInput("");
    } catch (e) {
      alert(`串口发送错误: ${e}`);
    }
  };

  const clearLogs = () => {
    setLogs([]);
    setRxBytes(0);
    setTxBytes(0);
  };

  const exportLogs = () => {
    const content = logs
      .map((l) => `[${l.time}] [${l.dir.toUpperCase()}] ${viewMode === "hex" ? l.hex : l.text}`)
      .join("\n");
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `serial_log_${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="feature-page" style={{ display: "flex", flexDirection: "column", height: "100%", background: "#06070a" }}>
      {/* Top Controls Toolbar */}
      <div
        className="feature-toolbar"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "12px",
          padding: "0 16px",
          height: "44px",
          background: "rgba(12, 15, 24, 0.95)",
          borderBottom: "1px solid var(--border)",
          backdropFilter: "blur(16px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>串口:</span>
          <select
            style={{ fontSize: "12px", minWidth: "160px", background: "var(--input)" }}
            value={selectedPort}
            onChange={(e) => setSelectedPort(e.target.value)}
            disabled={isOpen}
          >
            {ports.map((p) => (
              <option key={p.device} value={p.device}>
                {p.device} {p.description ? `(${p.description})` : ""}
              </option>
            ))}
            {ports.length === 0 && <option value="">无可用串口</option>}
          </select>
          <button
            type="button"
            className="ghost"
            style={{ padding: "0 6px", height: "26px", fontSize: "12px" }}
            onClick={fetchPorts}
            disabled={isOpen}
            title="刷新系统串口设备"
          >
            ↻
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <span style={{ fontSize: "12px", color: "var(--muted)" }}>波特率:</span>
          <select
            style={{ fontSize: "12px", width: "105px", background: "var(--input)" }}
            value={baud}
            onChange={(e) => setBaud(Number(e.target.value))}
            disabled={isOpen}
          >
            {BAUD_RATES.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={isOpen ? "ghost" : "primary"}
          style={{
            fontSize: "12px",
            padding: "4px 14px",
            color: isOpen ? "var(--err)" : undefined,
            borderColor: isOpen ? "var(--err)" : undefined,
          }}
          onClick={toggleConnection}
          disabled={loading}
        >
          {isOpen ? "关闭串口" : "打开串口"}
        </button>

        <div className="status-pill">
          <span className={isOpen ? "pulse-dot" : "pulse-dot off"}></span>
          <span>{isOpen ? `已连接 · ${baud}bps` : "已断开"}</span>
        </div>

        <div className="spacer" />

        {/* View Mode Toggle */}
        <div style={{ display: "flex", borderRadius: "4px", overflow: "hidden", border: "1px solid var(--border)" }}>
          <button
            type="button"
            style={{
              padding: "2px 10px",
              fontSize: "11px",
              background: viewMode === "text" ? "var(--cyan)" : "transparent",
              color: viewMode === "text" ? "#000" : "var(--muted)",
              border: "none",
              borderRadius: 0,
            }}
            onClick={() => setViewMode("text")}
          >
            文本
          </button>
          <button
            type="button"
            style={{
              padding: "2px 10px",
              fontSize: "11px",
              background: viewMode === "hex" ? "var(--cyan)" : "transparent",
              color: viewMode === "hex" ? "#000" : "var(--muted)",
              border: "none",
              borderRadius: 0,
            }}
            onClick={() => setViewMode("hex")}
          >
            HEX
          </button>
        </div>

        {/* Counters */}
        <div className="mono" style={{ fontSize: "11px", color: "var(--faint)", display: "flex", gap: "8px" }}>
          <span>RX: {rxBytes} B</span>
          <span>TX: {txBytes} B</span>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          滚屏
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "11px", color: "var(--muted)", cursor: "pointer" }}>
          <input type="checkbox" checked={showTime} onChange={(e) => setShowTime(e.target.checked)} />
          时间
        </label>

        <button type="button" className="ghost" style={{ fontSize: "12px", padding: "2px 8px" }} onClick={clearLogs}>
          清屏
        </button>
        <button type="button" className="ghost" style={{ fontSize: "12px", padding: "2px 8px" }} onClick={exportLogs}>
          导出
        </button>
      </div>

      {/* Main Terminal Output Console */}
      <div
        ref={logContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
          fontFamily: "var(--mono)",
          fontSize: "12px",
          lineHeight: "20px",
          background: "radial-gradient(ellipse at 50% 0%, rgba(0, 240, 255, 0.02) 0%, #050608 100%)",
        }}
      >
        {logs.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--faint)" }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>📟</div>
            <div>串口接收监视控制台已就绪</div>
            <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "4px" }}>
              选择设备与波特率后点击「打开串口」开始接收数据
            </div>
          </div>
        )}

        {logs.map((item) => (
          <div
            key={item.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              padding: "1px 0",
              color:
                item.dir === "tx"
                  ? "var(--amber)"
                  : item.dir === "error"
                  ? "var(--err)"
                  : "var(--text)",
            }}
          >
            {showTime && (
              <span style={{ color: "var(--faint)", flexShrink: 0, fontSize: "11px" }}>
                {item.time}
              </span>
            )}
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                padding: "0 4px",
                borderRadius: "2px",
                flexShrink: 0,
                background:
                  item.dir === "tx"
                    ? "rgba(245, 158, 11, 0.15)"
                    : item.dir === "error"
                    ? "rgba(239, 68, 68, 0.2)"
                    : "rgba(0, 240, 255, 0.12)",
                color:
                  item.dir === "tx"
                    ? "var(--amber)"
                    : item.dir === "error"
                    ? "var(--err)"
                    : "var(--cyan)",
              }}
            >
              {item.dir.toUpperCase()}
            </span>
            <span style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {viewMode === "hex" ? item.hex || item.text : item.text || item.hex}
            </span>
          </div>
        ))}
      </div>

      {/* Bottom Send Toolbar */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          padding: "10px 16px",
          background: "rgba(10, 12, 18, 0.95)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <select
          style={{ width: "85px", fontSize: "12px", background: "var(--input)" }}
          value={sendMode}
          onChange={(e) => setSendMode(e.target.value as any)}
        >
          <option value="text">文本</option>
          <option value="hex">HEX</option>
        </select>

        <input
          style={{ flex: 1, fontSize: "13px", fontFamily: "var(--mono)" }}
          placeholder={sendMode === "hex" ? "例如: AA 55 01 02 FF (十六进制空格分隔)" : "输入发送内容，按 Enter 快速发送..."}
          value={sendInput}
          onChange={(e) => setSendInput(e.target.value)}
          spellCheck={false}
          disabled={!isOpen}
        />

        <label style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12px", color: "var(--muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
          <input
            type="checkbox"
            checked={appendNewline}
            onChange={(e) => setAppendNewline(e.target.checked)}
            disabled={sendMode === "hex"}
          />
          +CRLF (\r\n)
        </label>

        <button type="submit" className="primary" style={{ padding: "0 18px", height: "32px", fontSize: "12px" }} disabled={!isOpen || !sendInput.trim()}>
          发送 →
        </button>
      </form>
    </div>
  );
}
