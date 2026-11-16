import { useEffect, useRef, type MutableRefObject } from "react";
import type {
  ElfMatch,
  FieldMode,
  HistoryPoint,
  SwdSnapshot,
  WatchArrayPayload,
  WatchEntry,
  WriteStatus,
} from "./types";
import { COLORS, fmtHex } from "./swdUtils";

function ArrayView({ payload }: { payload: WatchArrayPayload }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { rows, cols, values } = payload;
    const n = rows * cols;
    let lo = payload.min;
    let hi = payload.max;
    if (!(hi > lo)) {
      lo = Infinity;
      hi = -Infinity;
      for (let i = 0; i < n; i++) {
        const value = values[i] ?? 0;
        if (value < lo) lo = value;
        if (value > hi) hi = value;
      }
      if (!(hi > lo)) {
        lo = 0;
        hi = 1;
      }
    }

    if (rows > 1) {
      const cell = Math.max(2, Math.min(24, Math.floor(340 / cols)));
      const width = cell * cols;
      const height = cell * rows;
      canvas.width = width;
      canvas.height = height;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const value = values[y * cols + x] ?? 0;
          const ratio = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
          ctx.fillStyle = `hsl(${Math.round((1 - ratio) * 240)}, 90%, ${28 + ratio * 32}%)`;
          ctx.fillRect(x * cell, y * cell, cell - 1, cell - 1);
        }
      }
    } else {
      const count = cols;
      const width = 340;
      const height = 90;
      canvas.width = width;
      canvas.height = height;
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--canvas").trim() || "#050609";
      ctx.fillRect(0, 0, width, height);
      const barWidth = Math.max(1, width / count - 1);
      for (let i = 0; i < count; i++) {
        const value = values[i] ?? 0;
        const ratio = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
        const barHeight = Math.max(1, ratio * (height - 6));
        ctx.fillStyle = `hsl(${Math.round((1 - ratio) * 240)}, 85%, 55%)`;
        ctx.fillRect(i * (width / count), height - barHeight, barWidth, barHeight);
      }
    }
  }, [payload]);

  return (
    <div className="swd-array-view">
      <canvas ref={ref} className="swd-array-canvas" />
      <div className="mono swd-array-caption">
        色标 [{payload.min !== 0 || payload.max !== 0 ? `${payload.min} ~ ${payload.max}` : "自适应"}] · 版本门控·空闲刷新
      </div>
    </div>
  );
}

function MiniSparkline({ data, color }: { data: number[]; color: string }) {
  if (!data || data.length < 2) return <div className="swd-sparkline-empty" />;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 74;
  const height = 22;
  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * width;
    const y = height - ((value - min) / range) * (height - 6) - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M ${points.join(" L ")}`;

  return (
    <svg className="swd-sparkline" width={width} height={height}>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type SymbolPanelProps = {
  snap: SwdSnapshot | null;
  search: string;
  matches: ElfMatch[];
  searching: boolean;
  searchErr: string;
  watchEntries: WatchEntry[];
  watchValues: Record<string, { value: number; t: number }>;
  watchArrays: Record<string, WatchArrayPayload>;
  arrayExpanded: Record<string, boolean>;
  historyRef: MutableRefObject<Record<string, HistoryPoint[]>>;
  sparklines: Record<string, number[]>;
  plotted: Record<string, boolean>;
  fieldMode: Record<string, FieldMode>;
  editingSymbol: string | null;
  editVal: string;
  writeStatus: Record<string, WriteStatus>;
  onSearchChange: (value: string) => void;
  onAddSymbol: (name: string) => void;
  onRemoveSymbol: (name: string) => void;
  onToggleArray: (name: string, expanded: boolean) => void;
  onTogglePlot: (name: string, plotted: boolean) => void;
  onModeChange: (name: string, mode: FieldMode) => void;
  onStartEdit: (name: string, value: string) => void;
  onEditValueChange: (value: string) => void;
  onCancelEdit: () => void;
  onWriteSymbol: (name: string, value: string, mode: FieldMode) => void;
};

export function SymbolPanel({
  snap,
  search,
  matches,
  searching,
  searchErr,
  watchEntries,
  watchValues,
  watchArrays,
  arrayExpanded,
  historyRef,
  sparklines,
  plotted,
  fieldMode,
  editingSymbol,
  editVal,
  writeStatus,
  onSearchChange,
  onAddSymbol,
  onRemoveSymbol,
  onToggleArray,
  onTogglePlot,
  onModeChange,
  onStartEdit,
  onEditValueChange,
  onCancelEdit,
  onWriteSymbol,
}: SymbolPanelProps) {
  return (
    <aside className="swd-symbol-panel">
      <div className="swd-symbol-search">
        <div className="swd-search-input-wrap">
          <input
            className="swd-search-input"
            aria-label="搜索全局符号"
            placeholder="搜索全局符号 (nm -S)..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searching && <span className="swd-searching">检索中…</span>}
        </div>

        {searchErr && <p className="swd-search-error">{searchErr}</p>}

        {matches.length > 0 && (
          <div className="swd-match-list">
            {matches.map((match) => (
              <div key={match.name} className="swd-match-row">
                <div className="swd-match-copy">
                  <div className="mono swd-match-name">{match.name}</div>
                  <div className="mono swd-match-meta">
                    0x{match.addr.toString(16).toUpperCase()} · {match.size}B {match.file ? `· ${match.file}` : ""}
                  </div>
                </div>
                <button type="button" className="swd-match-add" onClick={() => onAddSymbol(match.name)}>
                  + 监视
                </button>
              </div>
            ))}
          </div>
        )}
        {search.trim() && !searching && !searchErr && matches.length === 0 && (
          <div className="swd-no-matches">未找到匹配符号</div>
        )}
      </div>

      {watchEntries.length > 0 && (
        <div className="swd-firmware-watch">
          <div className="swd-section-heading">
            <span>固件监视表 ({watchEntries.length})</span>
            <span className={snap?.omniscope?.watch_ok ? "swd-text-ok" : "swd-text-warn"}>
              {snap?.omniscope?.watch_ok ? "已连接" : "探测中"}
            </span>
          </div>

          {watchEntries.map((entry) => {
            if (entry.kind === 1) return null;
            const isArray = entry.is_array;
            const value = watchValues[entry.name]?.value;
            const arrayPayload = watchArrays[entry.name];
            const expanded = arrayExpanded[entry.name] ?? isArray;
            return (
              <div key={entry.name} className="swd-watch-card">
                <div className="swd-card-heading">
                  <span className="mono swd-watch-name">{entry.name}</span>
                  <span className="swd-readonly-tag">只读</span>
                </div>
                <div className="swd-watch-value-row">
                  {isArray ? (
                    <>
                      <span className="mono swd-array-meta">
                        {entry.elem_name}[{entry.rows}×{entry.cols}] · {entry.nbytes}B
                        {arrayPayload && <span className="swd-array-updated">已更新</span>}
                      </span>
                      <button
                        type="button"
                        className="ghost swd-array-toggle"
                        onClick={() => onToggleArray(entry.name, !expanded)}
                      >
                        {expanded ? "收起" : "热图"}
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="mono swd-watch-value">
                        {value !== undefined ? (Number.isInteger(value) ? value : Number(value).toFixed(4)) : "---"}
                      </span>
                      <MiniSparkline
                        data={(historyRef.current[`watch:${entry.name}`] || []).slice(-25).map((point) => point.v)}
                        color="var(--accent)"
                      />
                    </>
                  )}
                </div>
                <div className="mono swd-watch-address">
                  {entry.elem_name} · {fmtHex(entry.ptr)}
                  {isArray && " · 版本门控·空闲刷新"}
                </div>
                {isArray && expanded && arrayPayload && <ArrayView payload={arrayPayload} />}
                {isArray && expanded && !arrayPayload && (
                  <div className="swd-array-waiting">等待空闲带宽拉取…</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="swd-symbol-list">
        <div className="swd-section-heading">
          <span>监视符号 ({snap?.symbols?.length || 0}/8)</span>
          <span>走势 · 解析</span>
        </div>

        {(!snap?.symbols || snap.symbols.length === 0) && (
          <div className="swd-symbol-empty">
            <div className="swd-symbol-empty-title">暂无监视变量</div>
            <div className="swd-symbol-empty-copy">在上方输入变量名进行模糊匹配添加</div>
          </div>
        )}

        {snap?.symbols?.map((row, index) => {
          const color = COLORS[index % COLORS.length];
          const mode = fieldMode[row.name] || (row.f32 !== null && row.f32 !== undefined ? "f32" : "u32");
          const status = writeStatus[row.name];
          let valueDisplay = "---";
          if (row.error) {
            valueDisplay = `Err: ${row.error}`;
          } else if (mode === "f32" && typeof row.f32 === "number") {
            valueDisplay = row.f32.toFixed(4);
          } else if (mode === "i32" && typeof row.i32 === "number") {
            valueDisplay = String(row.i32);
          } else if (mode === "hex" && row.words?.length) {
            valueDisplay = `0x${row.words[0]}`;
          } else if (typeof row.u32 === "number") {
            valueDisplay = String(row.u32);
          }

          return (
            <div
              key={row.name}
              className="swd-symbol-card"
              style={{ borderColor: plotted[row.name] !== false ? `${color}55` : "var(--border)" }}
            >
              <div className="swd-card-heading">
                <div className="swd-symbol-heading">
                  <input
                    type="checkbox"
                    checked={plotted[row.name] !== false}
                    onChange={(e) => onTogglePlot(row.name, e.target.checked)}
                    title="在右侧示波器绘制曲线"
                  />
                  <span className="mono swd-symbol-name" style={{ color }}>{row.name}</span>
                </div>
                <button
                  type="button"
                  className="ghost swd-icon-button swd-remove-symbol"
                  onClick={() => onRemoveSymbol(row.name)}
                  title="移除监视"
                >
                  ×
                </button>
              </div>

              <div className="swd-symbol-value-row">
                {editingSymbol === row.name ? (
                  <div className="swd-symbol-editor">
                    <input
                      type="text"
                      className="mono swd-symbol-edit-input"
                      value={editVal}
                      autoFocus
                      onChange={(e) => onEditValueChange(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onWriteSymbol(row.name, editVal, mode);
                        if (e.key === "Escape") onCancelEdit();
                      }}
                    />
                    <button
                      type="button"
                      className="swd-symbol-write"
                      onClick={() => onWriteSymbol(row.name, editVal, mode)}
                    >
                      写入
                    </button>
                    <button type="button" className="ghost swd-symbol-cancel" onClick={onCancelEdit}>
                      ×
                    </button>
                  </div>
                ) : (
                  <div
                    className="swd-symbol-current"
                    title="点击在线热改写变量值 (mww 无须暂停 CPU)"
                    onClick={() => onStartEdit(row.name, valueDisplay.startsWith("Err") ? "0" : valueDisplay)}
                  >
                    <span className={`mono swd-symbol-value ${status ? `swd-symbol-value--${status}` : ""}`}>
                      {valueDisplay}
                    </span>
                    <span className="swd-symbol-edit-hint" title="在线热改写">[改写]</span>
                    {status === "ok" && <span className="swd-symbol-written">[已改写]</span>}
                  </div>
                )}

                <div className="swd-symbol-tools">
                  <MiniSparkline data={sparklines[row.name] || []} color={color} />
                  <select
                    className="swd-field-mode"
                    value={mode}
                    onChange={(e) => onModeChange(row.name, e.target.value as FieldMode)}
                  >
                    <option value="f32">f32</option>
                    <option value="i32">i32</option>
                    <option value="u32">u32</option>
                    <option value="hex">hex</option>
                  </select>
                </div>
              </div>

              <div className="mono swd-symbol-metadata">
                {row.addr && <span>{row.addr}</span>}
                {row.size && <span>{row.size}B</span>}
                {row.rtt_ms && <span className="swd-symbol-rtt">{row.rtt_ms}ms</span>}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
