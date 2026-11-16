import { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "../../shared/api";
import { useInstance } from "../../shared/instance";
import { useSSE } from "../../shared/useSSE";
import "./serial.css";

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
    <div className="feature-page serial-page">
      <div className="serial-toolbar">
        <div className="serial-connection-controls">
          <label className="serial-field">
            <span className="serial-field-label">串口</span>
            <select
              className="serial-select serial-port-select"
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
          </label>
          <button
            type="button"
            className="serial-button serial-icon-button"
            onClick={fetchPorts}
            disabled={isOpen}
            title="刷新系统串口设备"
            aria-label="刷新系统串口设备"
          >
            ↻
          </button>

          <label className="serial-field">
            <span className="serial-field-label">波特率</span>
            <select
              className="serial-select serial-baud-select"
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
          </label>

          <button
            type="button"
            className={`serial-button ${isOpen ? "is-danger" : "is-primary"}`}
            onClick={toggleConnection}
            disabled={loading}
          >
            {isOpen ? "关闭串口" : "打开串口"}
          </button>
          <span className={`serial-connection-status ${isOpen ? "is-open" : ""}`}>
            {isOpen ? `已连接 · ${baud} bps` : "已断开"}
          </span>
        </div>

        <div className="serial-terminal-controls">
          <div className="serial-segmented" aria-label="终端显示格式">
            <button
              type="button"
              className={`serial-segment ${viewMode === "text" ? "is-active" : ""}`}
              onClick={() => setViewMode("text")}
              aria-pressed={viewMode === "text"}
            >
              文本
            </button>
            <button
              type="button"
              className={`serial-segment ${viewMode === "hex" ? "is-active" : ""}`}
              onClick={() => setViewMode("hex")}
              aria-pressed={viewMode === "hex"}
            >
              HEX
            </button>
          </div>

          <div className="mono serial-counters">
            <span className="is-rx">RX {rxBytes} B</span>
            <span className="is-tx">TX {txBytes} B</span>
          </div>

          <label className="serial-check">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
            滚屏
          </label>
          <label className="serial-check">
            <input type="checkbox" checked={showTime} onChange={(e) => setShowTime(e.target.checked)} />
            时间
          </label>
          <button type="button" className="serial-button" onClick={clearLogs}>清屏</button>
          <button type="button" className="serial-button" onClick={exportLogs}>导出</button>
        </div>
      </div>

      <div className="serial-terminal" ref={logContainerRef}>
        {logs.length === 0 && (
          <div className="serial-empty">
            <div className="serial-empty-title">暂无串口数据</div>
            <p className="serial-empty-detail">打开串口后，接收与发送记录将显示在这里</p>
          </div>
        )}

        {logs.map((item) => (
          <div className={`serial-log-line is-${item.dir}`} key={item.id}>
            {showTime && <span className="serial-log-time">{item.time}</span>}
            <span className="serial-log-direction">{item.dir.toUpperCase()}</span>
            <span className="serial-log-message">
              {viewMode === "hex" ? item.hex || item.text : item.text || item.hex}
            </span>
          </div>
        ))}
      </div>

      <form
        className="serial-send-bar"
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
      >
        <select
          className="serial-select serial-send-mode"
          value={sendMode}
          onChange={(e) => setSendMode(e.target.value as any)}
          aria-label="发送格式"
        >
          <option value="text">文本</option>
          <option value="hex">HEX</option>
        </select>

        <input
          className="serial-send-input"
          placeholder={sendMode === "hex" ? "例如: AA 55 01 02 FF（十六进制空格分隔）" : "输入发送内容，按 Enter 发送"}
          value={sendInput}
          onChange={(e) => setSendInput(e.target.value)}
          spellCheck={false}
          disabled={!isOpen}
        />

        <label className="serial-check serial-newline-check">
          <input
            type="checkbox"
            checked={appendNewline}
            onChange={(e) => setAppendNewline(e.target.checked)}
            disabled={sendMode === "hex"}
          />
          +CRLF (\r\n)
        </label>

        <button
          type="submit"
          className="serial-button is-primary serial-send-button"
          disabled={!isOpen || !sendInput.trim()}
        >
          发送
        </button>
      </form>
    </div>
  );
}
