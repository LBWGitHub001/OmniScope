import { useCallback, useState } from "react";
import { ImagePane } from "./ImagePane";
import { LogPane } from "./LogPane";
import { Scene3DView } from "./Scene3DView";
import { TimeSeriesPane } from "./TimeSeriesPane";
import { useWorkbenchData } from "./useWorkbenchData";
import { WorkbenchSidebar } from "./WorkbenchSidebar";
import { XyPane } from "./XyPane";
import type { DataBus, PanelKind, PanelState } from "./types";

type LayoutMode = "grid" | "horizontal";
type PreviousView = { panels: PanelState[]; layout: LayoutMode };

function defaultPanels(): PanelState[] {
  return [
    { kind: "plot", imgSel: "" },
    { kind: "3d", imgSel: "" },
    { kind: "image", imgSel: "" },
    { kind: "log", imgSel: "" },
  ];
}

export function DebugWorkbench({
  busOut,
  imageSubscribe,
  replay = false,
  cursorT = null,
  onSeek,
}: {
  busOut: (bus: DataBus) => void;
  imageSubscribe?: (names: string[]) => void;
  replay?: boolean;
  cursorT?: number | null;
  onSeek?: (time: number) => void;
}) {
  const [panels, setPanels] = useState<PanelState[]>(defaultPanels);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("grid");
  const [previousView, setPreviousView] = useState<PreviousView | null>(null);
  const [sidebar, setSidebar] = useState(true);
  const [selectedPaneIdx, setSelectedPaneIdx] = useState(0);
  const plotIndex = panels.findIndex((panel) => panel.kind === "plot");
  const data = useWorkbenchData({ panels, setPanels, plotIndex, busOut, imageSubscribe, replay, cursorT, onSeek });

  const clampedSelectedIdx = Math.min(selectedPaneIdx, Math.max(0, panels.length - 1));
  const activeKind = panels[clampedSelectedIdx]?.kind || "plot";

  const applyGrid4 = useCallback(() => {
    setPanels(defaultPanels());
    setLayoutMode("grid");
    setPreviousView(null);
    setSelectedPaneIdx(0);
  }, []);

  const changeKind = (index: number, kind: PanelKind) => {
    setPanels((previous) => previous.map((panel, panelIndex) => {
      if (panelIndex !== index) return panel;
      return {
        ...panel,
        kind,
        imgSel: kind === "image" && !panel.imgSel ? data.names[0] || "" : panel.imgSel,
        xySel: kind === "xy" && !panel.xySel ? data.xyChannels[0] || "" : panel.xySel,
      };
    }));
  };

  const setImageSelection = (index: number, imgSel: string) => {
    setPanels((previous) => previous.map((panel, panelIndex) => panelIndex === index ? { ...panel, imgSel } : panel));
  };

  const setXySelection = (index: number, xySel: string) => {
    setPanels((previous) => previous.map((panel, panelIndex) => panelIndex === index ? { ...panel, xySel } : panel));
  };

  // xyVersion 驱动 XY ref 中最新曲线进入本次渲染，不重建 Chart。
  void data.xyVersion;

  return (
    <div className="workbench-root">
      <WorkbenchSidebar open={sidebar} onToggle={() => setSidebar((value) => !value)} activeKind={activeKind} data={data} />
      <div className="workbench-main">
        <div className={`tile-root ${layoutMode === "grid" && panels.length === 4 ? "tile-grid-2x2" : ""}`}>
          {panels.map((panel, index) => {
            const kind = panel.kind;
            const imgSel = panel.imgSel || data.names[0] || "";
            const xySel = panel.xySel || data.xyChannels[0] || "";
            const isSingle = panels.length === 1;
            return (
              <div
                className={`tile-pane ${clampedSelectedIdx === index ? "active-tile" : ""}`}
                key={index}
                onClick={() => setSelectedPaneIdx(index)}
              >
                <div className="tile-head">
                  <select value={kind} onChange={(event) => changeKind(index, event.target.value as PanelKind)} aria-label={`面板 ${index + 1} 类型`}>
                    <option value="plot">绘图</option>
                    <option value="3d">3D 视图</option>
                    <option value="xy">XY 曲线</option>
                    <option value="image">图像</option>
                    <option value="log">日志</option>
                  </select>
                  {kind === "xy" && (
                    <select value={xySel} onChange={(event) => setXySelection(index, event.target.value)} aria-label="XY 曲线通道">
                      {data.xyChannels.length === 0 && <option value="">等待 XY 数据</option>}
                      {data.xyChannels.map((name) => <option key={name} value={name}>{name}</option>)}
                    </select>
                  )}
                  <div className="tile-actions" onClick={(event) => event.stopPropagation()}>
                    <button
                      type="button"
                      className="ghost"
                      title={isSingle ? "还原多窗视口" : "最大化当前视口"}
                      onClick={() => {
                        if (isSingle) {
                          if (previousView) {
                            setPanels(previousView.panels);
                            setLayoutMode(previousView.layout);
                            setPreviousView(null);
                          } else {
                            applyGrid4();
                          }
                        } else {
                          setPreviousView({ panels, layout: layoutMode });
                          setPanels([panel]);
                          setLayoutMode("horizontal");
                          setSelectedPaneIdx(0);
                        }
                      }}
                    >{isSingle ? "还原" : "最大化"}</button>
                    <button
                      type="button"
                      className="ghost"
                      title="向右拆分"
                      disabled={panels.length >= 6}
                      onClick={() => {
                        setPanels((previous) => {
                          const next = [...previous];
                          next.splice(index + 1, 0, { kind: "plot", imgSel: "" });
                          return next.slice(0, 6);
                        });
                      }}
                    >拆分</button>
                    {panels.length > 1 && (
                      <button
                        type="button"
                        className="ghost"
                        title="关闭面板"
                        onClick={() => setPanels((previous) => previous.filter((_, panelIndex) => panelIndex !== index))}
                      >×</button>
                    )}
                  </div>
                </div>
                <div className="tile-content">
                  {kind === "plot" && (
                    <TimeSeriesPane
                      active={index === plotIndex}
                      hostRef={data.hostRef}
                      canvasRef={data.canvasRef}
                      chartRef={data.chartRef}
                      replayRef={data.replayRef}
                      cursorRef={data.cursorRef}
                      seekRef={data.seekRef}
                      dragCursor={data.dragCursor}
                    />
                  )}
                  {kind === "log" && (
                    <LogPane
                      lines={data.logs}
                      cursorT={replay ? cursorT : null}
                      onSeek={replay ? onSeek : undefined}
                      levels={data.logLevels}
                      onLevelsChange={data.setLogLevels}
                      filterText={data.logFilterText}
                      onFilterTextChange={data.setLogFilterText}
                      autoScroll={data.logAutoScroll}
                      onAutoScrollChange={data.setLogAutoScroll}
                      showTs={data.logShowTs}
                      onShowTsChange={data.setLogShowTs}
                      maxLogBuffer={data.maxLogBuffer}
                      onMaxLogBufferChange={data.setMaxLogBuffer}
                      onClear={() => data.setLogs([])}
                      onExport={data.exportLogs}
                    />
                  )}
                  {kind === "image" && (
                    <ImagePane
                      names={data.names}
                      sel={imgSel}
                      url={data.images[imgSel]}
                      onSel={(name) => setImageSelection(index, name)}
                    />
                  )}
                  {kind === "3d" && (
                    <Scene3DView
                      markers={data.markers}
                      onClear={data.clearMarkers}
                      showGrid={data.show3DGrid}
                      gridSize={data.gridSize3D}
                      showTfAxes={data.showTfAxes}
                      visibleNs={data.visibleNs}
                      visibleObjects={data.visibleObjects}
                      cameraPreset={data.cameraPreset}
                      tfByChild={data.tfByChild}
                      fixedFrame={data.fixedFrame}
                      onFixedFrameChange={data.setFixedFrame}
                      onStatsChange={data.setScene3DStats}
                    />
                  )}
                  {kind === "xy" && (
                    <XyPane
                      channel={xySel}
                      curve={xySel ? data.xyRef.current[xySel] : undefined}
                      db={data.xyDb}
                      showPeak={data.xyShowPeak}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
