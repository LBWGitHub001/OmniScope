import type { SerialLog, SerialPort } from "./types";

type SerialPanelProps = {
  ports: SerialPort[];
  device: string;
  baud: number;
  open: boolean;
  logs: SerialLog[];
  input: string;
  hex: boolean;
  onDeviceChange: (value: string) => void;
  onBaudChange: (value: number) => void;
  onToggle: () => void;
  onClear: () => void;
  onInputChange: (value: string) => void;
  onHexChange: (value: boolean) => void;
  onSend: () => void;
};

export function SerialPanel({
  ports,
  device,
  baud,
  open,
  logs,
  input,
  hex,
  onDeviceChange,
  onBaudChange,
  onToggle,
  onClear,
  onInputChange,
  onHexChange,
  onSend,
}: SerialPanelProps) {
  return (
    <section className="swd-serial-panel" aria-label="硬件串口终端">
      <div className="swd-serial-toolbar">
        <span className="swd-serial-title">硬件串口终端:</span>
        <select className="swd-serial-select" value={device} onChange={(e) => onDeviceChange(e.target.value)}>
          <option value="">选择串口设备</option>
          {ports.map((port) => (
            <option key={port.device} value={port.device}>
              {port.device} ({port.description})
            </option>
          ))}
        </select>
        <select
          className="swd-serial-select swd-serial-baud"
          value={baud}
          onChange={(e) => onBaudChange(Number(e.target.value))}
        >
          <option value={9600}>9600</option>
          <option value={115200}>115200</option>
          <option value={921600}>921600</option>
          <option value={2000000}>2000000</option>
        </select>
        <button type="button" className="swd-serial-connect" onClick={onToggle}>
          {open ? "断开" : "连接串口"}
        </button>
        <div className="swd-serial-spacer" />
        <button type="button" className="ghost swd-serial-clear" onClick={onClear}>
          清屏
        </button>
      </div>

      <div className="mono swd-serial-logs">
        {logs.map((item, index) => (
          <div
            key={index}
            className={`swd-serial-line ${item.dir === "tx" ? "swd-serial-line--tx" : item.dir === "error" ? "swd-serial-line--error" : ""}`}
          >
            <span className="swd-serial-direction">{item.dir === "tx" ? "[TX →]" : "[RX ←]"}</span>
            {item.text}
          </div>
        ))}
      </div>

      <div className="swd-serial-compose">
        <input
          className="swd-serial-input"
          placeholder={hex ? "16进制发送 (如: 01 02 A3)..." : "发送控制文本..."}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onSend();
          }}
        />
        <label className="swd-serial-hex">
          <input type="checkbox" checked={hex} onChange={(e) => onHexChange(e.target.checked)} />
          HEX
        </label>
        <button type="button" className="primary swd-serial-send" onClick={onSend}>
          发送
        </button>
      </div>
    </section>
  );
}
