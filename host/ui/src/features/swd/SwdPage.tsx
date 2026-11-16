import { useEffect, useRef, useState } from "react";
import { getJson, postJson } from "../../shared/api";
import { useInstance } from "../../shared/instance";
import { useSSE } from "../../shared/useSSE";
import { compileExpr } from "../../shared/workbench/expr";
import { SwdTopBar } from "./SwdTopBar";
import { FormulaDrawer, MailboxDrawer, ParamsDrawer, SettingsDrawer } from "./SwdDrawers";
import { SymbolPanel } from "./SymbolPanel";
import { ChartPanel } from "./ChartPanel";
import { SerialPanel } from "./SerialPanel";
import { COLORS, decodeArrayPayload } from "./swdUtils";
import type {
  ElfMatch,
  FieldMode,
  FormulaItem,
  HistoryPoint,
  SerialLog,
  SerialPort,
  SwdSnapshot,
  SymbolRow,
  WatchArrayPayload,
  WatchEntry,
  WriteStatus,
} from "./types";
import "./swd.css";

export function SwdPage() {
  const { base } = useInstance();
  const [snap, setSnap] = useState<SwdSnapshot | null>(null);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<ElfMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchErr, setSearchErr] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [showSerial, setShowSerial] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [showMailbox, setShowMailbox] = useState(false);

  // Online memory write / hot tuning state
  const [editingSymbol, setEditingSymbol] = useState<string | null>(null);
  const [editVal, setEditVal] = useState("");
  const [writeStatus, setWriteStatus] = useState<Record<string, WriteStatus>>({});

  // Virtual formula channels state
  const [formulas, setFormulas] = useState<FormulaItem[]>([]);
  const [formulaDraft, setFormulaDraft] = useState("");
  const [formulaSource, setFormulaSource] = useState("");

  // MCU Mailbox tuning state
  const [mailboxAddr, setMailboxAddr] = useState("0x20000000");
  const [mailboxParams, setMailboxParams] = useState<number[]>(new Array(16).fill(0));

  // OmniScope firmware watch table / params / swd plot state
  const [showParams, setShowParams] = useState(false);
  const [watchEntries, setWatchEntries] = useState<WatchEntry[]>([]);
  const [watchValues, setWatchValues] = useState<Record<string, { value: number; t: number }>>({});
  const [watchArrays, setWatchArrays] = useState<Record<string, WatchArrayPayload>>({});
  const [arrayExpanded, setArrayExpanded] = useState<Record<string, boolean>>({});
  const [paramDraft, setParamDraft] = useState<Record<string, number>>({});
  const [paramStatus, setParamStatus] = useState<Record<string, WriteStatus>>({});
  const [plotChNames, setPlotChNames] = useState<Record<number, string>>({});
  const [plotDropped, setPlotDropped] = useState(0);
  const [plotPlotted, setPlotPlotted] = useState<Record<string, boolean>>({});
  const plotHistoryRef = useRef<Record<string, HistoryPoint[]>>({});
  const [rateLimitInput, setRateLimitInput] = useState(8192);

  // Settings form state
  const [projectInput, setProjectInput] = useState("");
  const [hzInput, setHzInput] = useState(20);
  const [hostInput, setHostInput] = useState("127.0.0.1");
  const [portInput, setPortInput] = useState("");

  // Plot and view selection per symbol
  const [plotted, setPlotted] = useState<Record<string, boolean>>({});
  const [fieldMode, setFieldMode] = useState<Record<string, FieldMode>>({});

  // Serial state
  const [serialPorts, setSerialPorts] = useState<SerialPort[]>([]);
  const [serialDevice, setSerialDevice] = useState("");
  const [serialBaud, setSerialBaud] = useState(115200);
  const [serialOpen, setSerialOpen] = useState(false);
  const [serialLogs, setSerialLogs] = useState<SerialLog[]>([]);
  const [serialInput, setSerialInput] = useState("");
  const [serialHex, setSerialHex] = useState(false);

  // Time-series history for chart and sparklines
  const historyRef = useRef<Record<string, HistoryPoint[]>>({});
  const [sparklines, setSparklines] = useState<Record<string, number[]>>({});
  const [isPaused, setIsPaused] = useState(false);

  // Initial load snapshot
  useEffect(() => {
    getJson<SwdSnapshot>(`${base}/snapshot`).then((st) => {
      setSnap(st);
      setProjectInput(st.project || "");
      setHzInput(st.hz || 30);
      setHostInput(st.host || "127.0.0.1");
      setPortInput(st.telnet_port ? String(st.telnet_port) : "");
      if (st.rate_limit_bps) setRateLimitInput(st.rate_limit_bps);
      if (st.omniscope?.mailbox_addr) setMailboxAddr(st.omniscope.mailbox_addr);
      if (st.omniscope?.plot_channels) {
        const names: Record<number, string> = {};
        const toggles: Record<string, boolean> = {};
        st.omniscope.plot_channels.forEach((channel) => {
          names[channel.index] = channel.name;
          toggles[channel.name] = true;
        });
        setPlotChNames(names);
        setPlotPlotted((prev) => ({ ...toggles, ...prev }));
      }
      const initialPlotted: Record<string, boolean> = {};
      st.symbols?.forEach((symbol) => {
        initialPlotted[symbol.name] = true;
      });
      setPlotted(initialPlotted);
    }).catch(() => {});

    // Firmware watch table (in case it was probed before this page opened)
    getJson<{ entries?: WatchEntry[]; values?: Record<string, { value: number; t: number }> }>(
      `${base}/watch/table`
    ).then((res) => {
      if (res.entries) setWatchEntries(res.entries);
      if (res.values) setWatchValues(res.values);
    }).catch(() => {});
  }, [base]);

  // Search symbols debounce
  useEffect(() => {
    if (!search.trim()) {
      setMatches([]);
      setSearchErr("");
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setSearchErr("");
      try {
        const res = await getJson<{ elf?: string; symbols: ElfMatch[]; error?: string }>(
          `${base}/symbols?q=${encodeURIComponent(search.trim())}`
        );
        if (res.error) setSearchErr(res.error);
        else setMatches(res.symbols || []);
      } catch (error) {
        setSearchErr(String(error));
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [search, base]);

  // Load serial ports when opened
  useEffect(() => {
    if (showSerial) {
      getJson<{ ports: SerialPort[]; open: boolean; port: string; baud: number }>(
        `${base}/serial/ports`
      ).then((res) => {
        setSerialPorts(res.ports || []);
        setSerialOpen(res.open);
        if (res.port) setSerialDevice(res.port);
        if (res.baud) setSerialBaud(res.baud);
      }).catch(() => {});
    }
  }, [showSerial, base]);

  // Handle SSE events
  useSSE(`${base}/events`, (ev) => {
    const type = ev.type as string;
    if (type === "state") {
      const state = ev as unknown as SwdSnapshot;
      setSnap(state);
      if (state.omniscope?.mailbox_addr) {
        setMailboxAddr((current) => (current === "0x20000000" ? state.omniscope!.mailbox_addr! : current));
      }
      if (state.omniscope?.plot_channels) {
        const names: Record<number, string> = {};
        state.omniscope.plot_channels.forEach((channel) => {
          names[channel.index] = channel.name;
        });
        setPlotChNames((prev) => ({ ...prev, ...names }));
      }
      if (typeof state.omniscope?.plot_dropped === "number") setPlotDropped(state.omniscope.plot_dropped);
    } else if (type === "swd_plot") {
      const plot = ev as { channels: Record<string, string>; points: [number, number, number][]; dropped?: number };
      if (plot.channels) {
        setPlotChNames((prev) => {
          const next = { ...prev };
          Object.entries(plot.channels).forEach(([key, value]) => {
            next[Number(key)] = value;
          });
          return next;
        });
      }
      if (typeof plot.dropped === "number") setPlotDropped(plot.dropped);
      if (!isPaused && Array.isArray(plot.points)) {
        const now = Date.now() / 1000;
        plot.points.forEach(([channel, _timestamp, value]) => {
          const name = plot.channels?.[String(channel)] ?? `ch${channel}`;
          if (!Number.isFinite(value)) return;
          if (!plotHistoryRef.current[name]) plotHistoryRef.current[name] = [];
          const history = plotHistoryRef.current[name];
          history.push({ t: now, v: value });
          if (history.length > 600) history.shift();
        });
      }
    } else if (type === "watch_table") {
      const table = ev as { entries?: WatchEntry[] };
      setWatchEntries(table.entries || []);
    } else if (type === "watch_sample") {
      const sample = ev as { name: string; value: number; kind?: number; t?: number };
      const now = sample.t || Date.now() / 1000;
      setWatchValues((prev) => ({ ...prev, [sample.name]: { value: sample.value, t: now } }));
      if (Number.isFinite(sample.value)) {
        const key = `watch:${sample.name}`;
        if (!historyRef.current[key]) historyRef.current[key] = [];
        const history = historyRef.current[key];
        history.push({ t: now, v: sample.value });
        if (history.length > 300) history.shift();
      }
    } else if (type === "watch_array") {
      const array = ev as {
        name: string;
        rows: number;
        cols: number;
        elem_type: number;
        min: number;
        max: number;
        b64: string;
        t?: number;
      };
      try {
        const values = decodeArrayPayload(array.elem_type, array.b64);
        setWatchArrays((prev) => ({
          ...prev,
          [array.name]: {
            rows: array.rows,
            cols: array.cols,
            elemType: array.elem_type,
            min: array.min,
            max: array.max,
            values,
            t: array.t || Date.now() / 1000,
          },
        }));
      } catch {
        /* ignore malformed payload */
      }
    } else if (type === "sample") {
      const sample = ev as unknown as SymbolRow;
      setSnap((prev) => {
        if (!prev) return prev;
        const nextSymbols = prev.symbols.map((item) => (item.name === sample.name ? { ...item, ...sample } : item));
        return { ...prev, symbols: nextSymbols };
      });

      if (!isPaused && sample.t) {
        const name = sample.name;
        const mode = fieldMode[name] || (sample.f32 !== null && sample.f32 !== undefined ? "f32" : "u32");
        let value: number | null = null;
        if (mode === "f32" && typeof sample.f32 === "number") value = sample.f32;
        else if (mode === "i32" && typeof sample.i32 === "number") value = sample.i32;
        else if (typeof sample.u32 === "number") value = sample.u32;

        if (value !== null && Number.isFinite(value)) {
          if (!historyRef.current[name]) historyRef.current[name] = [];
          const history = historyRef.current[name];
          history.push({ t: sample.t, v: value });
          if (history.length > 300) history.shift();

          setSparklines((prev) => {
            const current = prev[name] || [];
            const next = [...current.slice(-24), value as number];
            return { ...prev, [name]: next };
          });
        }
      }
    } else if (type === "serial") {
      const serial = ev as { dir: string; text?: string; open?: boolean };
      if (serial.dir === "status" && typeof serial.open === "boolean") {
        setSerialOpen(serial.open);
      } else if (serial.text) {
        setSerialLogs((prev) => [...prev.slice(-100), { dir: serial.dir, text: serial.text || "" }]);
      }
    }
  });

  // Actions
  const writeSymbol = async (name: string, value: string, format: string) => {
    try {
      const res = await postJson<{ ok: boolean; error?: string }>(`${base}/symbols/write`, {
        name,
        value,
        fmt: format,
      });
      if (!res.ok) throw new Error(res.error || "写入失败");
      setWriteStatus((prev) => ({ ...prev, [name]: "ok" }));
      setEditingSymbol(null);
      setTimeout(() => {
        setWriteStatus((prev) => {
          const next = { ...prev };
          delete next[name];
          return next;
        });
      }, 2000);
    } catch (error) {
      alert(`写入变量 ${name} 失败: ${error}`);
      setWriteStatus((prev) => ({ ...prev, [name]: "err" }));
    }
  };

  const writeMailboxParam = async (slot: number, value: number) => {
    try {
      const res = await postJson<{ ok: boolean; error?: string }>(`${base}/mailbox/write`, {
        mailbox_addr: mailboxAddr,
        slot,
        value,
      });
      if (!res.ok) throw new Error(res.error || "Mailbox 写入失败");
      const next = [...mailboxParams];
      next[slot] = value;
      setMailboxParams(next);
    } catch (error) {
      alert(`Mailbox 写入槽位 #${slot} 失败: ${error}`);
    }
  };

  const addFormula = () => {
    const expr = formulaDraft.trim();
    if (!expr) return;
    const source = formulaSource || snap?.symbols?.[0]?.name || "";
    if (!source) {
      alert("请先选择自变量 x 对应的符号");
      return;
    }
    try {
      const fn = compileExpr(expr);
      setFormulas((prev) => [
        ...prev,
        {
          id: Date.now(),
          expr,
          source,
          enabled: true,
          fn,
          color: COLORS[(prev.length + 3) % COLORS.length],
        },
      ]);
      setFormulaDraft("");
    } catch (error) {
      alert(`公式语法错误: ${error}`);
    }
  };

  const removeFormula = (id: number) => {
    setFormulas((prev) => prev.filter((formula) => formula.id !== id));
  };

  const toggleFormula = (id: number) => {
    setFormulas((prev) => prev.map((formula) => (
      formula.id === id ? { ...formula, enabled: !formula.enabled } : formula
    )));
  };

  const addSymbol = async (name: string) => {
    try {
      const res = await postJson<SwdSnapshot>(`${base}/symbols/add`, { name });
      setSnap(res);
      setPlotted((prev) => ({ ...prev, [name]: true }));
      setSearch("");
      setMatches([]);
    } catch (error) {
      alert(`添加符号失败: ${error}`);
    }
  };

  const removeSymbol = async (name: string) => {
    try {
      const res = await postJson<SwdSnapshot>(`${base}/symbols/remove`, { name });
      setSnap(res);
      delete historyRef.current[name];
    } catch (error) {
      alert(`移除符号失败: ${error}`);
    }
  };

  const saveSettings = async () => {
    try {
      const res = await postJson<SwdSnapshot>(`${base}/settings`, {
        project: projectInput.trim(),
        hz: hzInput,
        host: hostInput.trim(),
        telnet_port: portInput.trim() ? Number(portInput.trim()) : null,
        rate_limit_bps: rateLimitInput,
      });
      setSnap(res);
      setShowSettings(false);
    } catch (error) {
      alert(`保存设置失败: ${error}`);
    }
  };

  const clearChart = () => {
    historyRef.current = {};
    plotHistoryRef.current = {};
    setSparklines({});
  };

  const writeParam = async (entry: WatchEntry, rawValue: number) => {
    try {
      const res = await postJson<{ ok: boolean; value?: number; error?: string }>(`${base}/watch/write`, {
        name: entry.name,
        value: rawValue,
      });
      if (!res.ok) throw new Error(res.error || "写入失败");
      setParamStatus((prev) => ({ ...prev, [entry.name]: "ok" }));
      if (typeof res.value === "number") {
        setParamDraft((prev) => ({ ...prev, [entry.name]: res.value as number }));
        setWatchValues((prev) => ({
          ...prev,
          [entry.name]: { value: res.value as number, t: Date.now() / 1000 },
        }));
      }
      setTimeout(() => {
        setParamStatus((prev) => {
          const next = { ...prev };
          delete next[entry.name];
          return next;
        });
      }, 2000);
    } catch (error) {
      alert(`参数 ${entry.name} 写入失败: ${error}`);
      setParamStatus((prev) => ({ ...prev, [entry.name]: "err" }));
    }
  };

  const toggleSerial = async () => {
    try {
      if (serialOpen) {
        await postJson(`${base}/serial/close`, {});
        setSerialOpen(false);
      } else {
        await postJson(`${base}/serial/open`, { port: serialDevice, baud: serialBaud });
        setSerialOpen(true);
      }
    } catch (error) {
      alert(`串口操作失败: ${error}`);
    }
  };

  const sendSerial = async () => {
    if (!serialInput) return;
    try {
      await postJson(`${base}/serial/send`, {
        mode: serialHex ? "hex" : "text",
        data: serialInput,
        newline: true,
      });
      setSerialInput("");
    } catch (error) {
      alert(`发送失败: ${error}`);
    }
  };

  const paramCount = watchEntries.filter((entry) => entry.kind === 1).length;

  return (
    <div className="feature-page swd-page">
      <SwdTopBar
        snap={snap}
        plotDropped={plotDropped}
        paramCount={paramCount}
        formulaCount={formulas.length}
        showParams={showParams}
        showFormulas={showFormulas}
        showMailbox={showMailbox}
        showSettings={showSettings}
        showSerial={showSerial}
        onToggleParams={() => setShowParams((value) => !value)}
        onToggleFormulas={() => setShowFormulas((value) => !value)}
        onToggleMailbox={() => setShowMailbox((value) => !value)}
        onToggleSettings={() => setShowSettings((value) => !value)}
        onToggleSerial={() => setShowSerial((value) => !value)}
      />

      <div className="swd-drawer-stack">
        {showSettings && (
          <SettingsDrawer
            projectInput={projectInput}
            hzInput={hzInput}
            hostInput={hostInput}
            portInput={portInput}
            rateLimitInput={rateLimitInput}
            onProjectChange={setProjectInput}
            onHzChange={setHzInput}
            onHostChange={setHostInput}
            onPortChange={setPortInput}
            onRateLimitChange={setRateLimitInput}
            onSave={saveSettings}
          />
        )}

        {showParams && (
          <ParamsDrawer
            entries={watchEntries}
            watchReady={snap?.omniscope?.watch_ok}
            values={watchValues}
            drafts={paramDraft}
            statuses={paramStatus}
            onDraftChange={(name, value) => setParamDraft((prev) => ({ ...prev, [name]: value }))}
            onWrite={writeParam}
          />
        )}

        {showFormulas && (
          <FormulaDrawer
            formulas={formulas}
            symbols={snap?.symbols || []}
            draft={formulaDraft}
            source={formulaSource}
            onDraftChange={setFormulaDraft}
            onSourceChange={setFormulaSource}
            onAdd={addFormula}
            onRemove={removeFormula}
            onToggle={toggleFormula}
          />
        )}

        {showMailbox && (
          <MailboxDrawer
            address={mailboxAddr}
            values={mailboxParams}
            onAddressChange={setMailboxAddr}
            onValueChange={(slot, value) => {
              const next = [...mailboxParams];
              next[slot] = value;
              setMailboxParams(next);
            }}
            onWrite={writeMailboxParam}
          />
        )}
      </div>

      <div className="swd-workspace">
        <SymbolPanel
          snap={snap}
          search={search}
          matches={matches}
          searching={searching}
          searchErr={searchErr}
          watchEntries={watchEntries}
          watchValues={watchValues}
          watchArrays={watchArrays}
          arrayExpanded={arrayExpanded}
          historyRef={historyRef}
          sparklines={sparklines}
          plotted={plotted}
          fieldMode={fieldMode}
          editingSymbol={editingSymbol}
          editVal={editVal}
          writeStatus={writeStatus}
          onSearchChange={setSearch}
          onAddSymbol={addSymbol}
          onRemoveSymbol={removeSymbol}
          onToggleArray={(name, expanded) => setArrayExpanded((prev) => ({ ...prev, [name]: expanded }))}
          onTogglePlot={(name, enabled) => setPlotted((prev) => ({ ...prev, [name]: enabled }))}
          onModeChange={(name, mode) => setFieldMode((prev) => ({ ...prev, [name]: mode }))}
          onStartEdit={(name, value) => {
            setEditingSymbol(name);
            setEditVal(value);
          }}
          onEditValueChange={setEditVal}
          onCancelEdit={() => setEditingSymbol(null)}
          onWriteSymbol={writeSymbol}
        />

        <ChartPanel
          symbols={snap?.symbols}
          plotted={plotted}
          formulas={formulas}
          plotChNames={plotChNames}
          plotPlotted={plotPlotted}
          historyRef={historyRef}
          plotHistoryRef={plotHistoryRef}
          isPaused={isPaused}
          onTogglePaused={() => setIsPaused((value) => !value)}
          onTogglePlotChannel={(name, enabled) => setPlotPlotted((prev) => ({ ...prev, [name]: enabled }))}
          onClear={clearChart}
        >
          {showSerial && (
            <SerialPanel
              ports={serialPorts}
              device={serialDevice}
              baud={serialBaud}
              open={serialOpen}
              logs={serialLogs}
              input={serialInput}
              hex={serialHex}
              onDeviceChange={setSerialDevice}
              onBaudChange={setSerialBaud}
              onToggle={toggleSerial}
              onClear={() => setSerialLogs([])}
              onInputChange={setSerialInput}
              onHexChange={setSerialHex}
              onSend={sendSerial}
            />
          )}
        </ChartPanel>
      </div>
    </div>
  );
}
