import type { FormulaItem, SymbolRow, WatchEntry, WriteStatus } from "./types";
import { fmtHex } from "./swdUtils";

type SettingsDrawerProps = {
  projectInput: string;
  hzInput: number;
  hostInput: string;
  portInput: string;
  rateLimitInput: number;
  onProjectChange: (value: string) => void;
  onHzChange: (value: number) => void;
  onHostChange: (value: string) => void;
  onPortChange: (value: string) => void;
  onRateLimitChange: (value: number) => void;
  onSave: () => void;
};

export function SettingsDrawer({
  projectInput,
  hzInput,
  hostInput,
  portInput,
  rateLimitInput,
  onProjectChange,
  onHzChange,
  onHostChange,
  onPortChange,
  onRateLimitChange,
  onSave,
}: SettingsDrawerProps) {
  return (
    <section className="swd-drawer swd-settings-drawer" aria-label="SWD 参数设置">
      <div className="swd-field swd-field--project">
        <label className="swd-field-label">固件工程目录 (含 ELF)</label>
        <input
          value={projectInput}
          onChange={(e) => onProjectChange(e.target.value)}
          placeholder="/path/to/firmware"
        />
      </div>
      <div className="swd-field">
        <label className="swd-field-label">采样速率 (Hz)</label>
        <input
          type="number"
          min={1}
          max={50}
          value={hzInput}
          onChange={(e) => onHzChange(Number(e.target.value))}
        />
      </div>
      <div className="swd-field">
        <label className="swd-field-label">OpenOCD Host</label>
        <input value={hostInput} onChange={(e) => onHostChange(e.target.value)} />
      </div>
      <div className="swd-field">
        <label className="swd-field-label">Telnet 端口</label>
        <input
          value={portInput}
          placeholder="4444 (留空自动探测)"
          onChange={(e) => onPortChange(e.target.value)}
        />
      </div>
      <div className="swd-field">
        <label className="swd-field-label">速率限制 (B/s)</label>
        <input
          type="number"
          min={512}
          max={1048576}
          value={rateLimitInput}
          onChange={(e) => onRateLimitChange(Number(e.target.value))}
        />
      </div>
      <button type="button" className="primary swd-settings-save" onClick={onSave}>
        应用变更
      </button>
    </section>
  );
}

type ParamsDrawerProps = {
  entries: WatchEntry[];
  watchReady?: boolean;
  values: Record<string, { value: number; t: number }>;
  drafts: Record<string, number>;
  statuses: Record<string, WriteStatus>;
  onDraftChange: (name: string, value: number) => void;
  onWrite: (entry: WatchEntry, value: number) => void;
};

export function ParamsDrawer({
  entries,
  watchReady,
  values,
  drafts,
  statuses,
  onDraftChange,
  onWrite,
}: ParamsDrawerProps) {
  const params = entries.filter((entry) => entry.kind === 1);

  return (
    <section className="swd-drawer swd-params-drawer" aria-label="固件参数实时调节">
      <div className="swd-drawer-heading">
        <span className="swd-drawer-title swd-text-ok">
          固件参数实时调节 (omniscope_watch · 滑杆直写 mww · 1Hz 回显)
        </span>
        <span className="mono swd-drawer-subtitle">
          {watchReady ? `已发现 ${params.length} 个参数` : "等待固件监视表…"}
        </span>
      </div>

      {params.length === 0 && (
        <div className="swd-empty-inline">
          固件未注册参数项。在代码中调用 omniscope_watch_register_param() 注册后自动出现。
        </div>
      )}

      <div className="swd-param-grid">
        {params.map((entry) => {
          const current = values[entry.name]?.value ?? 0;
          const draft = drafts[entry.name] ?? current;
          const hasRange = entry.max > entry.min;
          const status = statuses[entry.name];
          return (
            <div
              key={entry.name}
              className={`swd-param-card ${status ? `swd-param-card--${status}` : ""}`}
            >
              <div className="swd-param-heading">
                <span className="mono swd-param-name">{entry.name}</span>
                <span className="mono swd-param-meta">
                  {entry.elem_name} · {fmtHex(entry.ptr)} · 可写
                </span>
              </div>
              <div className="swd-param-controls">
                {hasRange && (
                  <input
                    type="range"
                    className="swd-param-range"
                    min={entry.min}
                    max={entry.max}
                    step={entry.step > 0 ? entry.step : (entry.max - entry.min) / 100}
                    value={draft}
                    onChange={(event) => onDraftChange(entry.name, Number(event.target.value))}
                    onPointerUp={() => onWrite(entry, drafts[entry.name] ?? current)}
                    onKeyUp={(event) => {
                      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                        onWrite(entry, drafts[entry.name] ?? current);
                      }
                    }}
                  />
                )}
                <input
                  type="number"
                  className="mono swd-param-input"
                  min={hasRange ? entry.min : undefined}
                  max={hasRange ? entry.max : undefined}
                  step={entry.step > 0 ? entry.step : undefined}
                  value={draft}
                  onChange={(event) => onDraftChange(entry.name, Number(event.target.value))}
                  onBlur={() => onWrite(entry, drafts[entry.name] ?? current)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onWrite(entry, drafts[entry.name] ?? current);
                  }}
                />
                <span className="mono swd-param-echo">回显 {current.toFixed(3)}</span>
              </div>
              {hasRange && (
                <div className="mono swd-param-limits">
                  <span>{entry.min}</span>
                  <span>step {entry.step > 0 ? entry.step : "free"}</span>
                  <span>{entry.max}</span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type FormulaDrawerProps = {
  formulas: FormulaItem[];
  symbols: SymbolRow[];
  draft: string;
  source: string;
  onDraftChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onToggle: (id: number) => void;
};

export function FormulaDrawer({
  formulas,
  symbols,
  draft,
  source,
  onDraftChange,
  onSourceChange,
  onAdd,
  onRemove,
  onToggle,
}: FormulaDrawerProps) {
  return (
    <section className="swd-drawer swd-formula-drawer" aria-label="虚拟公式通道">
      <div className="swd-formula-create">
        <label className="swd-formula-title">ƒ(x) 新建虚拟曲线:</label>
        <input
          className="swd-formula-expression"
          placeholder="输入数学表达式，例如: sin(x)   2*x   x^2   x*57.2958 (弧度转角度)   x*0.001"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
        />
        <select className="swd-formula-source" value={source} onChange={(e) => onSourceChange(e.target.value)}>
          <option value="">选择自变量 x 来源...</option>
          {symbols.map((symbol) => (
            <option key={symbol.name} value={symbol.name}>
              x = {symbol.name}
            </option>
          ))}
        </select>
        <button type="button" className="primary" onClick={onAdd}>
          + 添加通道
        </button>
      </div>

      {formulas.length > 0 && (
        <div className="swd-formula-list">
          {formulas.map((formula) => (
            <div
              key={formula.id}
              className="swd-formula-chip"
              style={{ borderColor: `${formula.color}66` }}
            >
              <input
                type="checkbox"
                checked={formula.enabled}
                onChange={() => onToggle(formula.id)}
                title="在图表中显示/隐藏"
              />
              <code className="swd-formula-code" style={{ color: formula.color }}>{formula.expr}</code>
              <span className="swd-formula-source-name">({formula.source})</span>
              <button
                type="button"
                className="ghost swd-icon-button"
                onClick={() => onRemove(formula.id)}
                title="移除公式"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type MailboxDrawerProps = {
  address: string;
  values: number[];
  onAddressChange: (value: string) => void;
  onValueChange: (slot: number, value: number) => void;
  onWrite: (slot: number, value: number) => void;
};

export function MailboxDrawer({ address, values, onAddressChange, onValueChange, onWrite }: MailboxDrawerProps) {
  return (
    <section className="swd-drawer swd-mailbox-drawer" aria-label="MCU Mailbox 实时调参">
      <div className="swd-mailbox-heading">
        <div className="swd-drawer-heading">
          <span className="swd-drawer-title swd-text-warn">MCU Mailbox 实时调参面板 (omniscope_mailbox_t)</span>
          <span className="mono swd-drawer-subtitle">零停机·SWD非侵入式热整定·支持16槽位</span>
        </div>
        <div className="swd-mailbox-address">
          <label className="swd-field-label">基地址:</label>
          <input
            className="mono"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="0x20000000"
          />
        </div>
      </div>

      <div className="swd-mailbox-grid">
        {values.map((value, index) => (
          <div key={index} className="swd-mailbox-slot">
            <div className="swd-mailbox-slot-heading">
              <span>P[{index}]</span>
              <span className="mono">{value.toFixed(3)}</span>
            </div>
            <input
              type="number"
              step="0.01"
              className="mono"
              value={value}
              onChange={(e) => onValueChange(index, parseFloat(e.target.value) || 0)}
              onBlur={() => onWrite(index, values[index])}
              onKeyDown={(e) => {
                if (e.key === "Enter") onWrite(index, values[index]);
              }}
            />
            <button type="button" className="swd-mailbox-write" onClick={() => onWrite(index, values[index])}>
              写入
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
