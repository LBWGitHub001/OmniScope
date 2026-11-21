import { useMemo, useState, useRef, useEffect } from "react";
import type { useWorkbenchData } from "./useWorkbenchData";
import type { MarkerObjectMeta } from "./Scene3DView";
import type { PanelKind, ViewMode } from "./types";
import { knownFrames, tfTreeRows } from "./tf";

type WorkbenchData = ReturnType<typeof useWorkbenchData>;

type WorkbenchSidebarProps = {
  open: boolean;
  onToggle: () => void;
  activeKind: PanelKind;
  data: WorkbenchData;
};

const TITLE: Record<PanelKind, string> = {
  plot: "曲线设置",
  "3d": "3D 设置",
  image: "图像设置",
  log: "日志设置",
  xy: "XY 设置",
};

type MarkerGroup = { ns: string; objects: MarkerObjectMeta[] };

function groupMarkers(objects: MarkerObjectMeta[]): MarkerGroup[] {
  const map = new Map<string, MarkerObjectMeta[]>();
  for (const object of objects) {
    const list = map.get(object.ns) || [];
    list.push(object);
    map.set(object.ns, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ns, items]) => ({ ns, objects: items }));
}

function MarkerGroupList({ data }: { data: WorkbenchData }) {
  const [openNs, setOpenNs] = useState<string | null>(null);
  const groups = useMemo(
    () => groupMarkers(data.scene3DStats.objects || []),
    [data.scene3DStats.objects],
  );

  const setGroupVisible = (ns: string, objects: MarkerObjectMeta[], visible: boolean) => {
    data.setVisibleNs((previous) => ({ ...previous, [ns]: visible }));
    data.setVisibleObjects((previous) => {
      const next = { ...previous };
      for (const object of objects) next[object.key] = visible;
      return next;
    });
  };

  return (
    <>
      <div className="button-row">
        <button
          type="button"
          className="ghost"
          onClick={() => {
            const nsNext: Record<string, boolean> = {};
            const objNext = { ...data.visibleObjects };
            for (const group of groups) {
              nsNext[group.ns] = true;
              for (const object of group.objects) objNext[object.key] = true;
            }
            data.setVisibleNs((previous) => ({ ...previous, ...nsNext }));
            data.setVisibleObjects(objNext);
          }}
        >全显</button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            const nsNext: Record<string, boolean> = {};
            const objNext = { ...data.visibleObjects };
            for (const group of groups) {
              nsNext[group.ns] = false;
              for (const object of group.objects) objNext[object.key] = false;
            }
            data.setVisibleNs((previous) => ({ ...previous, ...nsNext }));
            data.setVisibleObjects(objNext);
          }}
        >全隐</button>
      </div>
      {groups.length === 0 ? (
        <span className="muted">等待 3D 数据…</span>
      ) : (
        <div className="marker-groups">
          {groups.map((group) => {
            const groupOn = data.visibleNs[group.ns] !== false;
            const childStates = group.objects.map((object) => data.visibleObjects[object.key] !== false);
            const allOn = groupOn && childStates.every(Boolean);
            const noneOn = !groupOn || childStates.every((on) => !on);
            const partial = !allOn && !noneOn;
            const open = openNs === group.ns;
            return (
              <div key={group.ns} className="marker-group">
                <div className="marker-group-row">
                  <GroupCheck
                    checked={allOn}
                    indeterminate={partial}
                    onChange={(visible) => setGroupVisible(group.ns, group.objects, visible)}
                  />
                  <span className="mono ellipsis marker-group-name" title={group.ns}>{group.ns}</span>
                  <span className="muted marker-group-count">{group.objects.length}</span>
                  <button
                    type="button"
                    className={open ? "ghost marker-group-caret open" : "ghost marker-group-caret"}
                    title="组内图元"
                    onClick={() => setOpenNs(open ? null : group.ns)}
                  >▾</button>
                </div>
                {open && (
                  <div className="marker-group-menu">
                    {group.objects.map((object) => {
                      const checked = groupOn && data.visibleObjects[object.key] !== false;
                      return (
                        <label key={object.key} className={checked ? "object-row" : "object-row is-hidden"}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              const nextOn = !checked;
                              data.setVisibleObjects((previous) => ({
                                ...previous,
                                [object.key]: nextOn,
                              }));
                              if (nextOn && !groupOn) {
                                data.setVisibleNs((previous) => ({ ...previous, [group.ns]: true }));
                              }
                            }}
                          />
                          <span className="swatch" style={{ background: object.colorHex }} />
                          <span className="mono object-id">#{object.id}</span>
                          <span className="mono ellipsis" title={object.text ? `${object.typeName}: ${object.text}` : object.typeName}>
                            {object.typeName}{object.text ? ` (${object.text})` : ""}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function GroupCheck({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate: boolean;
  onChange: (visible: boolean) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={() => onChange(!(checked || indeterminate))}
    />
  );
}

export function WorkbenchSidebar({ open, onToggle, activeKind, data }: WorkbenchSidebarProps) {
  return (
    <aside className={open ? "dbg-side" : "dbg-side collapsed"}>
      <button type="button" className="side-toggle" onClick={onToggle} title={open ? "收起设置" : "展开设置"}>
        {open ? "◀" : "▶"}
      </button>
      {open && (
        <div className="side-body">
          <div className="side-title">{TITLE[activeKind]}</div>

          {activeKind === "plot" && (
            <>
              <div className="side-sec">
                <div className="side-h">显示模式</div>
                {(["sliding", "centered", "paused"] as ViewMode[]).map((mode) => (
                  <label key={mode}>
                    <input
                      type="radio"
                      name={data.replayRef.current ? "view-mode-replay" : "view-mode-watch"}
                      checked={data.mode === mode}
                      onChange={() => data.setMode(mode)}
                    />
                    {mode === "sliding" ? "滑动" : mode === "centered" ? "居中" : "暂停"}
                  </label>
                ))}
              </div>
              <div className="side-sec">
                <div className="side-h">窗口（秒）</div>
                <input
                  type="number"
                  min={1}
                  max={120}
                  value={data.win}
                  onChange={(event) => data.setWin(Number(event.target.value) || 10)}
                />
              </div>
              <div className="side-sec">
                <div className="side-h">历史</div>
                <select value={data.history} onChange={(event) => data.setHistory(Number(event.target.value))}>
                  <option value={30}>30 秒</option>
                  <option value={60}>1 分钟</option>
                  <option value={120}>2 分钟</option>
                  <option value={300}>5 分钟</option>
                </select>
              </div>
              <div className="side-sec">
                <div className="side-h">数据字段</div>
                {Object.keys(data.fields).length === 0 && <span className="muted">等待数据…</span>}
                {Object.entries(data.fields).map(([name, meta]) => (
                  <label key={name} className="field-row">
                    <input
                      type="checkbox"
                      checked={meta.on}
                      onChange={(event) => data.setFields((previous) => ({
                        ...previous,
                        [name]: { ...previous[name], on: event.target.checked },
                      }))}
                    />
                    <span className="swatch" style={{ background: meta.color }} />
                    <span className="ellipsis" title={name}>{name}</span>
                  </label>
                ))}
              </div>
              <div className="side-sec">
                <div className="side-h">虚拟公式通道</div>
                <div className="stack">
                  <input
                    placeholder="如 sin(x)、2x、x*57.3"
                    value={data.formulaDraft}
                    onChange={(event) => data.setFormulaDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") data.addFormula();
                    }}
                  />
                  <div className="formula-source">
                    <select value={data.formulaSource} onChange={(event) => data.setFormulaSource(event.target.value)}>
                      <option value="">选择 x 来源</option>
                      {Object.keys(data.fields).map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                    <button type="button" onClick={data.addFormula} disabled={!data.formulaDraft.trim()}>添加</button>
                  </div>
                  {data.formulas.map((formula) => (
                    <div key={formula.id} className="formula-row">
                      <label>
                        <input
                          type="checkbox"
                          checked={formula.enabled}
                          onChange={() => {
                            data.setFormulas((previous) => previous.map((item) =>
                              item.id === formula.id ? { ...item, enabled: !item.enabled } : item
                            ));
                            data.invalidateChart();
                          }}
                        />
                        <span className="swatch" style={{ background: formula.color }} />
                        <span className="mono ellipsis" title={`${formula.expr} [x=${formula.source}]`}>{formula.expr}</span>
                      </label>
                      <button
                        type="button"
                        className="ghost"
                        title="删除公式"
                        onClick={() => {
                          data.setFormulas((previous) => previous.filter((item) => item.id !== formula.id));
                          data.invalidateChart();
                        }}
                      >×</button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {activeKind === "3d" && (
            <>
              <div className="side-sec">
                <div className="side-h">场景</div>
                <label>
                  <input type="checkbox" checked={data.show3DGrid} onChange={(event) => data.setShow3DGrid(event.target.checked)} />
                  显示网格
                </label>
                <select value={data.gridSize3D} onChange={(event) => data.setGridSize3D(Number(event.target.value))}>
                  <option value={10}>10 米网格</option>
                  <option value={20}>20 米网格</option>
                  <option value={50}>50 米网格</option>
                </select>
                <label>
                  <input type="checkbox" checked={data.showTfAxes} onChange={(event) => data.setShowTfAxes(event.target.checked)} />
                  显示 TF 坐标轴
                </label>
                <div className="side-h" style={{ marginTop: 8 }}>当前坐标系</div>
                <select value={data.fixedFrame} onChange={(event) => data.setFixedFrame(event.target.value)}>
                  {knownFrames(data.tfByChild, [data.fixedFrame, ...(data.scene3DStats.frames || [])].filter(Boolean)).map((frame) => (
                    <option key={frame} value={frame}>{frame}</option>
                  ))}
                </select>
                {tfTreeRows(data.tfByChild).length > 0 && (
                  <div className="tf-tree">
                    {tfTreeRows(data.tfByChild).map((row) => (
                      <div key={`${row.parent}:${row.child}`} className="tf-tree-row mono">
                        {row.parent} → {row.child}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="side-sec">
                <div className="side-h">图元（{data.scene3DStats.count}）</div>
                <MarkerGroupList data={data} />
              </div>
              <div className="side-sec">
                <div className="side-h">相机视角</div>
                <div className="camera-grid">
                  {([["reset", "透视"], ["top", "顶视"], ["front", "前视"], ["side", "侧视"]] as const).map(([type, label]) => (
                    <button
                      key={type}
                      type="button"
                      className="ghost"
                      onClick={() => data.setCameraPreset({ id: Date.now(), type })}
                    >{label}</button>
                  ))}
                </div>
                <button type="button" className="ghost danger wide" onClick={data.clearMarkers} disabled={!data.scene3DStats.count}>
                  清空空间标记
                </button>
              </div>
            </>
          )}

          {activeKind === "xy" && (
            <div className="side-sec">
              <div className="side-h">纵轴显示</div>
              <label>
                <input type="checkbox" checked={data.xyDb} onChange={(event) => data.setXyDb(event.target.checked)} />
                对数幅度（dB）
              </label>
              <label>
                <input type="checkbox" checked={data.xyShowPeak} onChange={(event) => data.setXyShowPeak(event.target.checked)} />
                标注最高峰
              </label>
            </div>
          )}

          {activeKind === "image" && (
            <div className="side-sec">
              <div className="side-h">图像操作</div>
              <p className="muted">在图像面板选择视频流。滚轮缩放，拖动平移，双击复位。</p>
            </div>
          )}

          {activeKind === "log" && (
            <div className="side-sec">
              <div className="side-h">日志操作</div>
              <p className="muted">级别、搜索、时间、缓冲区和导出控制位于日志工具栏。</p>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
