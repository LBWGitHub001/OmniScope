import type { SwdSnapshot } from "./types";

type SwdTopBarProps = {
  snap: SwdSnapshot | null;
  plotDropped: number;
  paramCount: number;
  formulaCount: number;
  showParams: boolean;
  showFormulas: boolean;
  showMailbox: boolean;
  showSettings: boolean;
  showSerial: boolean;
  onToggleParams: () => void;
  onToggleFormulas: () => void;
  onToggleMailbox: () => void;
  onToggleSettings: () => void;
  onToggleSerial: () => void;
};

function phaseTag(phase?: string) {
  switch (phase || "waiting") {
    case "streaming": return { text: "实时监视中", cls: "swd-phase--connected" };
    case "connecting": return { text: "正在连接", cls: "swd-phase--warn" };
    case "idle": return { text: "已连接(空闲)", cls: "swd-phase--ok" };
    case "reconnecting": return { text: "重连中", cls: "swd-phase--warn" };
    case "error": return { text: "通信异常", cls: "swd-phase--err" };
    default: return { text: "等待 OpenOCD", cls: "swd-phase--idle" };
  }
}

export function SwdTopBar({
  snap,
  plotDropped,
  paramCount,
  formulaCount,
  showParams,
  showFormulas,
  showMailbox,
  showSettings,
  showSerial,
  onToggleParams,
  onToggleFormulas,
  onToggleMailbox,
  onToggleSettings,
  onToggleSerial,
}: SwdTopBarProps) {
  const phase = phaseTag(snap?.phase);
  const bandwidthWarn = (snap?.bps_used || 0) > (snap?.rate_limit_bps || 1) * 0.9;

  return (
    <header className="feature-toolbar swd-topbar">
      <div className="swd-connection">
        <span className={`swd-phase ${phase.cls}`}>{phase.text}</span>
        <span className="mono swd-connection-message">{snap?.message}</span>
      </div>

      <div className="swd-topbar-spacer" />

      {snap?.elf && (
        <div className="swd-elf-pill" title={snap.elf}>
          <span className="swd-elf-label">ELF:</span>
          <span className="mono swd-elf-name">{snap.elf.split("/").pop()}</span>
        </div>
      )}

      <div className="swd-metric">
        <span className="swd-meter-dot" />
        <span>{snap?.stats?.hz || 0} Hz · {snap?.stats?.rtt_p50 || 0}ms RTT</span>
      </div>

      <div
        className={`swd-metric ${bandwidthWarn ? "swd-metric--warn" : ""}`}
        title={`SWD 传输速率限制: ${snap?.rate_limit_bps || 0} B/s (参数1Hz > 监视${snap?.hz || 30}Hz > plot/数组空闲)`}
      >
        <span className="swd-meter-dot" />
        <span>
          {snap?.bps_used || 0}/{snap?.rate_limit_bps || 0} B/s
          {plotDropped > 0 && <span className="swd-dropped">丢点 {plotDropped}</span>}
        </span>
      </div>

      <div className="swd-toolbar-actions">
        <button
          type="button"
          className={`ghost swd-toolbar-button ${showParams ? "swd-active-ok" : ""}`}
          aria-pressed={showParams}
          onClick={onToggleParams}
        >
          参数调节 {paramCount > 0 && `(${paramCount})`}
        </button>
        <button
          type="button"
          className={`ghost swd-toolbar-button ${showFormulas ? "swd-active-accent" : ""}`}
          aria-pressed={showFormulas}
          onClick={onToggleFormulas}
        >
          ƒ(x) 虚拟公式 {formulaCount > 0 && `(${formulaCount})`}
        </button>
        <button
          type="button"
          className={`ghost swd-toolbar-button ${showMailbox ? "swd-active-warn" : ""}`}
          aria-pressed={showMailbox}
          onClick={onToggleMailbox}
        >
          Mailbox 调参
        </button>
        <button
          type="button"
          className={`ghost swd-toolbar-button ${showSettings ? "swd-active-accent" : ""}`}
          aria-pressed={showSettings}
          onClick={onToggleSettings}
        >
          参数设置
        </button>
        <button
          type="button"
          className={`ghost swd-toolbar-button ${showSerial ? "swd-active-accent" : ""}`}
          aria-pressed={showSerial}
          onClick={onToggleSerial}
        >
          串口监控
        </button>
      </div>
    </header>
  );
}
