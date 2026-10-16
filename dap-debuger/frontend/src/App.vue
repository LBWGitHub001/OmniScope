<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import SharedChart from "./components/SharedChart.vue";
import WatchTable from "./components/WatchTable.vue";
import SerialConsole from "./components/SerialConsole.vue";
import DataView from "./components/DataView.vue";
import FormulaBar from "./components/FormulaBar.vue";
import { compileExpr } from "./expr.js";

const COLORS = ["#d6f56a", "#7ec8ff", "#ef7d6a", "#e6c15a", "#c9a0ff", "#8fdf7a", "#ff9ec8", "#7ee0d0"];
const FORMULA_COLORS = ["#f2a2ff", "#9ad7ff", "#ffd27a", "#b8f2c8"];
const HISTORY_LIMIT = 200;

const PHASE = {
  waiting: "等待调试",
  connecting: "正在连接",
  streaming: "实时监视",
  idle: "已连接",
  reconnecting: "重新连接",
  error: "出错",
};

const phase = ref("waiting");
const message = ref("正在连接本地服务…");
const project = ref("");
const hz = ref(20);
const host = ref("127.0.0.1");
const telnetPort = ref("");
const elf = ref("");
const symbols = ref([]);
const stats = ref({ ok: 0, fail: 0, hz: 0, rtt_p50: 0, rtt_p95: 0 });
const query = ref("");
const matches = ref([]);
const searchError = ref("");
const history = ref({});
const plotted = ref({});
const fields = ref({});
const fieldLocked = {};
const serialPorts = ref([]);
const serialDevice = ref("");
const serialBaud = ref(115200);
const serialOpen = ref(false);
const serialView = ref("text");
const serialLines = ref([]);
const serialDraft = ref("");
const serialMode = ref("text");
const serialNewline = ref(true);
const serialError = ref("");
const formulas = ref([]);
const formulaDraft = ref("");
const formulaSource = ref("");
const selected = ref("");
const shapes = ref({});
const recording = ref(false);
const logName = ref("");
const logFiles = ref([]);
const replaying = ref(false);
let replayTimer = 0;
let formulaId = 1;
let source = null;
let searchTimer = 0;

const phaseLabel = computed(() => PHASE[phase.value] || phase.value);
const elfName = computed(() => (elf.value ? elf.value.split("/").pop() : "尚未发现 ELF"));
const colors = computed(() => {
  const map = {};
  symbols.value.forEach((row, index) => {
    map[row.name] = COLORS[index % COLORS.length];
  });
  return map;
});
const chartMode = ref("time");

function sampleX(point, name) {
  if (!point) return null;
  const field = fields.value[name] || "u32";
  const value = field === "f32" ? point.f32 : point.u32;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function linspace(start, end, count) {
  if (start === end) return [start];
  const values = [];
  for (let index = 0; index < count; index += 1) {
    values.push(start + ((end - start) * index) / (count - 1));
  }
  return values;
}

const chartMarker = computed(() => {
  if (chartMode.value !== "fn") return null;
  const name = formulaSource.value || preparedFormulas.value.find((item) => item.source)?.source;
  const historyPoints = history.value[name] || [];
  return sampleX(historyPoints[historyPoints.length - 1], name);
});

const chartSeries = computed(() => {
  if (chartMode.value === "fn") {
    const name = formulaSource.value || preparedFormulas.value.find((item) => item.source)?.source || symbols.value[0]?.name;
    const xs = (history.value[name] || []).map((point) => sampleX(point, name)).filter((value) => value != null);
    const start = xs.length ? Math.min(...xs) : 0;
    const end = xs.length ? Math.max(...xs) : 1;
    const grid = linspace(start, end, 200);
    const curves = preparedFormulas.value
      .filter((item) => item.fn)
      .map((item, index) => ({
        name: `expr:${item.id}`,
        label: item.expr,
        color: FORMULA_COLORS[index % FORMULA_COLORS.length],
        points: grid
          .map((x) => {
            const y = item.fn(x);
            return Number.isFinite(y) ? { x, y } : null;
          })
          .filter(Boolean),
      }));
    if (symbols.value.some((row) => plotted.value[row.name] !== false)) {
      curves.unshift({
        name: name || "x",
        label: "y = x",
        color: "#d6f56a",
        points: grid.map((x) => ({ x, y: x })),
      });
    }
    return curves;
  }
  const watchSeries = symbols.value
    .filter((row) => plotted.value[row.name] !== false)
    .map((row) => ({
      name: row.name,
      label: row.name,
      color: colors.value[row.name],
      points: (history.value[row.name] || [])
        .map((point) => {
          const y = sampleX(point, row.name);
          return y == null ? null : { x: point.t, y };
        })
        .filter(Boolean),
    }));
  const formulaSeries = preparedFormulas.value
    .filter((item) => item.fn)
    .map((item, index) => ({
      name: `expr:${item.id}`,
      label: item.expr,
      color: FORMULA_COLORS[index % FORMULA_COLORS.length],
      points: (history.value[item.source] || [])
        .map((point) => {
          const x = sampleX(point, item.source);
          if (x == null) return null;
          const y = item.fn(x);
          return Number.isFinite(y) ? { x: point.t, y } : null;
        })
        .filter(Boolean),
    }));
  return watchSeries.concat(formulaSeries);
});

const preparedFormulas = computed(() =>
  formulas.value.map((item) => {
    if (!item.source || !symbols.value.some((row) => row.name === item.source)) {
      return { ...item, fn: null, error: item.source ? "找不到这个 x" : "先选择 x" };
    }
    try {
      const fn = compileExpr(item.expr);
      const historyPoints = history.value[item.source] || [];
      const x = sampleX(historyPoints[historyPoints.length - 1], item.source);
      const current = x == null ? null : fn(x);
      return {
        ...item,
        fn: item.enabled ? fn : null,
        current: typeof current === "number" && Number.isFinite(current) ? current : null,
        error: "",
      };
    } catch (error) {
      return { ...item, fn: null, error: error.message };
    }
  }),
);

function ensureShape(name) {
  if (!name || shapes.value[name]) return;
  shapes.value[name] = { mode: "value", rows: 1, cols: 1, cell: "f32" };
}

const tableRows = computed(() => {
  const expressions = preparedFormulas.value.map((item) => ({
    name: `expr:${item.id}`,
    label: item.expr,
    kind: "expr",
    addr: item.source ? `x=${item.source}` : "",
    u32: item.current,
    f32: item.current,
    error: item.error,
    enabled: item.enabled,
  }));
  return symbols.value.map((row) => ({ ...row, label: row.name, kind: "mem" })).concat(expressions);
});
const selectedRow = computed(() => tableRows.value.find((row) => row.name === selected.value) || null);
const activeShape = computed(() => shapes.value[selected.value] || { mode: "value", rows: 1, cols: 1, cell: "f32" });

function ensurePrefs(row) {
  if (!row?.name) return;
  ensureShape(row.name);
  if (!selected.value) selected.value = row.name;
  if (!(row.name in plotted.value)) plotted.value[row.name] = true;
  if (fieldLocked[row.name]) return;
  fields.value[row.name] = typeof row.f32 === "number" ? "f32" : fields.value[row.name] || "u32";
}

function applySnapshot(data) {
  phase.value = data.phase || "waiting";
  message.value = data.message || "";
  if (data.project) project.value = data.project;
  if (typeof data.hz === "number") hz.value = data.hz;
  if (data.host) host.value = data.host;
  telnetPort.value = data.telnet_port || "";
  elf.value = data.elf || "";
  recording.value = Boolean(data.recording);
  logName.value = data.log || logName.value;
  if (!replaying.value) {
    symbols.value = data.symbols || [];
    symbols.value.forEach(ensurePrefs);
  }
  if (data.stats) stats.value = data.stats;
}

function pushSerial(event) {
  if (event.dir === "status") {
    serialOpen.value = Boolean(event.open);
    if (event.port) serialDevice.value = event.port;
    if (event.baud) serialBaud.value = event.baud;
    return;
  }
  if (event.dir === "error") {
    serialError.value = event.text || "串口错误";
    serialOpen.value = false;
    return;
  }
  const prefix = event.dir === "tx" ? ">> " : "<< ";
  serialLines.value = serialLines.value.concat({
    hex: `${prefix}${event.hex || ""}\n`,
    text: `${prefix}${event.text || ""}\n`,
  }).slice(-400);
}

function applySample(row) {
  if (replaying.value) return;
  ingestSample(row);
}

function ingestSample(row) {
  const next = symbols.value.slice();
  const index = next.findIndex((item) => item.name === row.name);
  if (index >= 0) next[index] = { ...next[index], ...row };
  else next.push(row);
  symbols.value = next;
  ensurePrefs(row);
  if (typeof row.u32 === "number") {
    const point = {
      t: typeof row.t === "number" ? row.t : Date.now() / 1000,
      u32: row.u32,
      f32: typeof row.f32 === "number" ? row.f32 : null,
    };
    const points = (history.value[row.name] || []).concat(point).slice(-HISTORY_LIMIT);
    history.value = { ...history.value, [row.name]: points };
  }
  if (typeof row.hz === "number") stats.value = { ...stats.value, hz: row.hz };
}

function togglePlot(name, checked) {
  plotted.value[name] = checked;
}

function onLegend(name) {
  if (String(name).startsWith("expr:")) toggleFormula(Number(name.slice(5)), false);
  else togglePlot(name, false);
}

function onRowToggle(name, checked) {
  if (String(name).startsWith("expr:")) toggleFormula(Number(name.slice(5)), checked);
  else togglePlot(name, checked);
}

function setShape(next) {
  if (!selected.value) return;
  shapes.value[selected.value] = { ...activeShape.value, ...next };
}

function setField(name, field) {
  fieldLocked[name] = true;
  fields.value[name] = field;
}

function addFormula() {
  const expr = formulaDraft.value.trim();
  if (!expr) return;
  formulas.value = formulas.value.concat({
    id: formulaId,
    expr,
    source: formulaSource.value || symbols.value[0]?.name || "",
    enabled: true,
  });
  formulaId += 1;
  formulaDraft.value = "";
  chartMode.value = "fn";
}

function toggleFormula(id, enabled) {
  formulas.value = formulas.value.map((item) => (item.id === id ? { ...item, enabled } : item));
}

function setFormulaSource(id, sourceName) {
  formulas.value = formulas.value.map((item) => (item.id === id ? { ...item, source: sourceName } : item));
}

function removeFormula(id) {
  formulas.value = formulas.value.filter((item) => item.id !== id);
}

async function refreshPorts() {
  const response = await fetch("/api/serial/ports");
  const data = await response.json();
  if (!response.ok) {
    serialError.value = data.error || "无法列出串口";
    return;
  }
  serialPorts.value = data.ports || [];
  serialOpen.value = Boolean(data.open);
  if (!serialDevice.value && serialPorts.value.length) {
    serialDevice.value = serialPorts.value[0].device;
  }
}

async function toggleSerial() {
  serialError.value = "";
  if (serialOpen.value) {
    const response = await fetch("/api/serial/close", { method: "POST", body: "{}" });
    const data = await response.json();
    serialOpen.value = Boolean(data.open);
    return;
  }
  const response = await fetch("/api/serial/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ port: serialDevice.value, baud: Number(serialBaud.value) }),
  });
  const data = await response.json();
  if (!response.ok) {
    serialError.value = data.error || "打开失败";
    return;
  }
  serialOpen.value = Boolean(data.open);
}

async function sendSerial() {
  const response = await fetch("/api/serial/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      data: serialDraft.value,
      mode: serialMode.value,
      newline: serialMode.value === "text" && serialNewline.value,
    }),
  });
  const data = await response.json();
  if (!response.ok) serialError.value = data.error || "发送失败";
  else serialDraft.value = "";
}

async function refreshLogs() {
  const response = await fetch("/api/logs");
  if (!response.ok) return;
  const data = await response.json();
  logFiles.value = data.logs || [];
  recording.value = Boolean(data.recording);
}

async function stopRecording() {
  await fetch("/api/logs/stop", { method: "POST", body: "{}" });
  await refresh();
  await refreshLogs();
}

async function resumeRecording() {
  replaying.value = false;
  clearTimeout(replayTimer);
  await fetch("/api/logs/resume", { method: "POST", body: "{}" });
  await refresh();
  await refreshLogs();
}

function pauseReplay() {
  replaying.value = false;
  clearTimeout(replayTimer);
}

async function replayLog(name) {
  if (!name) return;
  const response = await fetch(`/api/logs?name=${encodeURIComponent(name)}`);
  const data = await response.json();
  const events = (data.events || []).filter((item) => item.kind === "sample" && item.name);
  replaying.value = true;
  let index = 0;
  const step = () => {
    if (!replaying.value || index >= events.length) {
      replaying.value = false;
      return;
    }
    ingestSample(events[index]);
    const gap = index + 1 < events.length ? Math.min(1000, Math.max(0, (events[index + 1].t - events[index].t) * 1000)) : 0;
    index += 1;
    replayTimer = setTimeout(step, gap);
  };
  step();
}

async function refresh() {
  const response = await fetch("/api/snapshot");
  if (!response.ok) throw new Error(`snapshot ${response.status}`);
  applySnapshot(await response.json());
}

async function saveSettings() {
  const response = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      project: project.value,
      hz: Number(hz.value),
      host: host.value,
      telnet_port: telnetPort.value ? Number(telnetPort.value) : null,
    }),
  });
  const data = await response.json();
  if (!response.ok) {
    message.value = data.error || "设置失败";
    return;
  }
  applySnapshot(data);
  search();
}

async function search() {
  searchError.value = "";
  const response = await fetch(`/api/symbols?q=${encodeURIComponent(query.value)}`);
  const data = await response.json();
  if (!response.ok) {
    matches.value = [];
    searchError.value = data.error || "无法读取符号";
    return;
  }
  if (data.elf) elf.value = data.elf;
  matches.value = data.symbols || [];
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(search, 200);
}

async function addSymbol(name) {
  const target = (name || query.value).trim();
  if (!target) return;
  const response = await fetch("/api/symbols/add", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: target }),
  });
  const data = await response.json();
  if (!response.ok) {
    message.value = data.error || "无法添加符号";
    return;
  }
  applySnapshot(data);
  query.value = "";
  search();
}

async function removeSymbol(name) {
  const response = await fetch("/api/symbols/remove", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const data = await response.json();
  if (!response.ok) return;
  const next = { ...history.value };
  delete next[name];
  history.value = next;
  delete plotted.value[name];
  delete fields.value[name];
  delete fieldLocked[name];
  applySnapshot(data);
}

function onSearchKey(event) {
  if (event.key !== "Enter") return;
  const exact = matches.value.find((row) => row.name === query.value.trim());
  addSymbol(exact ? exact.name : matches.value[0]?.name || query.value);
}

function connectEvents() {
  source = new EventSource("/api/events");
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "sample") applySample(data);
    else if (data.type === "serial") pushSerial(data);
    else applySnapshot(data);
  };
  source.onerror = () => {
    message.value = "与本地服务的连接中断，正在重试…";
  };
}

onMounted(async () => {
  try {
    await refresh();
    await search();
    await refreshPorts();
    await refreshLogs();
  } catch (error) {
    message.value = "打不开本地服务。先运行 ./start.sh";
  }
  connectEvents();
});

onUnmounted(() => {
  source?.close();
  clearTimeout(searchTimer);
});
</script>

<template>
  <div class="app">
    <header class="top">
      <div>
        <p class="eyebrow">CMSIS-DAP · OpenOCD · SWD</p>
        <h1>实时监视</h1>
      </div>
      <div class="phase" :data-phase="phase">
        <span class="dot" />
        <div>
          <strong>{{ phaseLabel }}</strong>
          <p>{{ message }}</p>
        </div>
      </div>
      <div class="top-stats">
        <span>{{ recording ? "录制中" : "未录制" }} {{ logName }}</span>
        <button type="button" @click="recording ? stopRecording() : resumeRecording()">{{ recording ? "停止" : "继续录制" }}</button>
        <select @change="replayLog($event.target.value)">
          <option value="">回放日志</option>
          <option v-for="name in logFiles" :key="name" :value="name">{{ name }}</option>
        </select>
        <button v-if="replaying" type="button" @click="pauseReplay">暂停回放</button>
        <span>{{ stats.hz }} Hz</span>
        <span>p50 {{ stats.rtt_p50 }} ms</span>
        <span>失败 {{ stats.fail }}</span>
      </div>
    </header>

    <div class="layout">
      <aside class="side">
        <label>
          工程路径
          <input v-model="project" spellcheck="false" @change="saveSettings" />
        </label>
        <p class="hint">ELF {{ elfName }}</p>

        <label>
          采样率 {{ hz }} Hz
          <input v-model.number="hz" type="range" min="1" max="50" step="1" @change="saveSettings" />
        </label>

        <label>
          搜索已有符号
          <input
            v-model="query"
            spellcheck="false"
            @input="scheduleSearch"
            @keydown="onSearchKey"
          />
        </label>
        <p v-if="searchError" class="error">{{ searchError }}</p>
        <ul class="matches">
          <li v-for="row in matches" :key="row.name + (row.file || '')">
            <button type="button" @click="addSymbol(row.name)">
              <span>{{ row.name }}</span>
              <small>{{ row.file || "无源文件" }} · {{ row.size }}B</small>
            </button>
          </li>
        </ul>

        <div class="rail-block">
          <p class="rail-title">串口</p>
          <label>
            端口
            <select v-model="serialDevice">
              <option v-if="!serialPorts.length" value="">无串口</option>
              <option v-for="item in serialPorts" :key="item.device" :value="item.device">
                {{ item.device }} {{ item.description }}
              </option>
            </select>
          </label>
          <label>
            波特率
            <input v-model.number="serialBaud" inputmode="numeric" />
          </label>
          <div class="rail-actions">
            <button type="button" @click="refreshPorts">刷新</button>
            <button type="button" @click="toggleSerial">{{ serialOpen ? "关闭" : "打开" }}</button>
          </div>
          <p v-if="serialError" class="error">{{ serialError }}</p>
        </div>

        <details>
          <summary>OpenOCD</summary>
          <label>
            OpenOCD 主机
            <input v-model="host" spellcheck="false" @change="saveSettings" />
          </label>
          <label>
            Telnet 端口（空则自动）
            <input v-model="telnetPort" inputmode="numeric" @change="saveSettings" />
          </label>
        </details>
      </aside>

      <main class="stage">
        <section class="chart-card">
          <SharedChart :series="chartSeries" :mode="chartMode" :marker="chartMarker" @toggle="onLegend" @mode="chartMode = $event" />
          <FormulaBar
            :formulas="preparedFormulas"
            :symbols="symbols"
            v-model:draft="formulaDraft"
            v-model:source="formulaSource"
            @add="addFormula"
            @toggle="toggleFormula"
            @source="setFormulaSource"
            @remove="removeFormula"
          />
        </section>
        <section class="watch-split">
          <WatchTable
            :rows="tableRows"
            :colors="colors"
            :plotted="plotted"
            :fields="fields"
            :selected="selected"
            @select="selected = $event"
            @remove="removeSymbol"
            @toggle="onRowToggle"
          />
          <DataView
            :row="selectedRow"
            :field="fields[selected] || 'u32'"
            :mode="activeShape.mode"
            :rows="activeShape.rows"
            :cols="activeShape.cols"
            :cell="activeShape.cell"
            @field="setField(selected, $event)"
            @mode="setShape({ mode: $event })"
            @shape="setShape"
          />
        </section>
      </main>
    </div>

    <SerialConsole
      v-if="serialOpen"
      :lines="serialLines"
      :view="serialView"
      :open="serialOpen"
      v-model:draft="serialDraft"
      v-model:mode="serialMode"
      v-model:newline="serialNewline"
      @update:view="serialView = $event"
      @send="sendSerial"
    />
  </div>
</template>
