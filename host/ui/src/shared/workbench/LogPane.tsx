import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { fmtTs, normLevel, type LogLevels, type LogLine } from "./types";

type LogPaneProps = {
  lines: LogLine[];
  cursorT?: number | null;
  onSeek?: (time: number) => void;
  levels: LogLevels;
  onLevelsChange: Dispatch<SetStateAction<LogLevels>>;
  filterText: string;
  onFilterTextChange: (text: string) => void;
  autoScroll: boolean;
  onAutoScrollChange: (value: boolean) => void;
  showTs: boolean;
  onShowTsChange: (value: boolean) => void;
  maxLogBuffer: number;
  onMaxLogBufferChange: (value: number) => void;
  onClear: () => void;
  onExport: () => void;
};

export function LogPane({
  lines,
  cursorT = null,
  onSeek,
  levels,
  onLevelsChange,
  filterText,
  onFilterTextChange,
  autoScroll,
  onAutoScrollChange,
  showTs,
  onShowTsChange,
  maxLogBuffer,
  onMaxLogBufferChange,
  onClear,
  onExport,
}: LogPaneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [mark, setMark] = useState<{ y: number; kind: "line" | "gap" } | null>(null);

  const visible = useMemo(() => {
    let regex: RegExp | null = null;
    const query = filterText.trim();
    if (query) {
      try {
        regex = new RegExp(query, "i");
      } catch {
        regex = null;
      }
    }
    const lower = query.toLowerCase();
    return lines.filter((line) => {
      const level = normLevel(line.level) as keyof LogLevels;
      if (levels[level] === false) return false;
      if (!query) return true;
      if (regex) return regex.test(line.msg) || regex.test(level);
      return line.msg.toLowerCase().includes(lower) || level.toLowerCase().includes(lower);
    });
  }, [lines, levels, filterText]);

  let current = -1;
  if (cursorT != null) {
    for (let i = 0; i < visible.length; i++) {
      const time = visible[i].t;
      if (time == null) continue;
      if (time <= cursorT) current = i;
      else break;
    }
  }

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (cursorT == null) {
      if (autoScroll && stick.current) element.scrollTop = element.scrollHeight;
      return;
    }
    const row = element.querySelector(".log-current") as HTMLElement | null;
    if (row) {
      const top = row.offsetTop;
      const bottom = top + row.offsetHeight;
      if (top < element.scrollTop || bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = Math.max(0, top - element.clientHeight / 3);
      }
      const next = visible[current + 1];
      const currentLine = visible[current];
      if (currentLine && next && currentLine.t != null && next.t != null && next.t > currentLine.t) {
        const fraction = (cursorT - currentLine.t) / (next.t - currentLine.t);
        if (fraction > 0.08 && fraction < 0.92) {
          const nextElement = row.nextElementSibling as HTMLElement | null;
          const nextTop = nextElement ? nextElement.offsetTop : bottom;
          setMark({ y: top + (nextTop - top) * fraction - element.scrollTop, kind: "gap" });
          return;
        }
      }
      setMark({ y: top + row.offsetHeight / 2 - element.scrollTop, kind: "line" });
    } else {
      setMark(null);
    }
  }, [visible.length, lines.length, cursorT, current, autoScroll]);

  return (
    <div className="log-pane">
      <div className="log-toolbar">
        <div className="log-levels">
          {(["DEBUG", "INFO", "WARN", "ERROR"] as const).map((level) => (
            <label key={level}>
              <input
                type="checkbox"
                checked={levels[level]}
                onChange={() => onLevelsChange((previous) => ({ ...previous, [level]: !previous[level] }))}
              />
              <span className="mono">{level}</span>
            </label>
          ))}
        </div>
        <input
          className="log-search"
          placeholder="搜索或正则"
          value={filterText}
          onChange={(event) => onFilterTextChange(event.target.value)}
        />
        <label title="接收新日志时自动贴底">
          <input type="checkbox" checked={autoScroll} onChange={(event) => onAutoScrollChange(event.target.checked)} />
          滚动
        </label>
        <label title="显示时间戳">
          <input type="checkbox" checked={showTs} onChange={(event) => onShowTsChange(event.target.checked)} />
          时间
        </label>
        <select
          className="log-buffer"
          title="日志缓冲区容量"
          value={maxLogBuffer}
          onChange={(event) => onMaxLogBufferChange(Number(event.target.value))}
        >
          <option value={500}>500 行</option>
          <option value={1000}>1000 行</option>
          <option value={2000}>2000 行</option>
          <option value={5000}>5000 行</option>
        </select>
        <span className="log-count mono">{visible.length} / {lines.length}</span>
        <button type="button" className="ghost" onClick={onExport} disabled={!lines.length}>导出</button>
        <button type="button" className="ghost danger" onClick={onClear} disabled={!lines.length}>清空</button>
      </div>
      <div className="log-stream-wrap">
        {mark?.kind === "gap" && <div className="log-tri" style={{ top: mark.y }} />}
        <div
          className="log-stream"
          ref={ref}
          onScroll={() => {
            const element = ref.current;
            if (!element) return;
            stick.current = element.scrollTop + element.clientHeight >= element.scrollHeight - 24;
          }}
        >
          {visible.length === 0 && (
            <div className="log-line L-DEBUG">
              <span className="log-msg muted">{lines.length === 0 ? "等待日志数据…" : "无符合过滤条件的日志"}</span>
            </div>
          )}
          {visible.map((line, index) => (
            <div
              key={index}
              className={`log-line L-${normLevel(line.level)}${index === current ? " log-current" : ""}${onSeek ? " log-click" : ""}`}
              onClick={() => {
                if (line.t != null) onSeek?.(line.t);
              }}
            >
              {showTs && (
                line.t != null ? <span className="log-ts">{line.t.toFixed(3)}s</span> :
                  line.ts ? <span className="log-ts">{fmtTs(line.ts)}</span> : null
              )}
              <span className="log-lv">{normLevel(line.level)}</span>
              <span className="log-msg">{line.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
