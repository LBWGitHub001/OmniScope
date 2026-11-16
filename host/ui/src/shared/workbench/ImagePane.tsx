import { useEffect, useRef, useState } from "react";

type ImagePaneProps = {
  names: string[];
  sel: string;
  url?: string;
  onSel: (name: string) => void;
};

export function ImagePane({ names, sel, url, onSel }: ImagePaneProps) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  useEffect(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, [sel]);

  return (
    <div className="img-pane">
      <div className="img-bar">
        <select value={sel} onChange={(event) => onSel(event.target.value)} aria-label="图像流通道">
          {names.length === 0 && <option value="">无图像</option>}
          {names.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <span className="muted">滚轮缩放 · 双击复位</span>
      </div>
      <div
        className="img-view"
        onWheel={(event) => {
          event.preventDefault();
          setScale((value) => Math.min(15, Math.max(0.1, Number((value * (event.deltaY > 0 ? 0.9 : 1.1)).toFixed(2)))));
        }}
        onDoubleClick={() => {
          setScale(1);
          setPan({ x: 0, y: 0 });
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) return;
          drag.current = { x: event.clientX, y: event.clientY, px: pan.x, py: pan.y };
        }}
        onMouseMove={(event) => {
          if (!drag.current) return;
          setPan({
            x: drag.current.px + event.clientX - drag.current.x,
            y: drag.current.py + event.clientY - drag.current.y,
          });
        }}
        onMouseUp={() => { drag.current = null; }}
        onMouseLeave={() => { drag.current = null; }}
      >
        {url ? (
          <img
            src={url}
            alt={sel || "图像流"}
            draggable={false}
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}
          />
        ) : (
          <span className="pane-empty mono muted">{sel ? `等待图像流：${sel}…` : "等待图像流通道…"}</span>
        )}
      </div>
    </div>
  );
}
