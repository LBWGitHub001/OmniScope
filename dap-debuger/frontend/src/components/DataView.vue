<script setup>
import { computed } from "vue";

const props = defineProps({
  row: { type: Object, default: null },
  field: { type: String, default: "u32" },
  mode: { type: String, default: "value" },
  rows: { type: Number, default: 1 },
  cols: { type: Number, default: 1 },
  cell: { type: String, default: "f32" },
});
const emit = defineEmits(["field", "mode", "shape"]);

const bytes = computed(() => {
  const out = [];
  for (const hex of props.row?.words || []) {
    const value = Number.parseInt(hex, 16) >>> 0;
    out.push(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
  }
  return out;
});

const words = computed(() =>
  (props.row?.words || []).map((hex) => {
    const u32 = Number.parseInt(hex, 16) >>> 0;
    const buf = new ArrayBuffer(4);
    const view = new DataView(buf);
    view.setUint32(0, u32, true);
    return { hex, u32, f32: view.getFloat32(0, true) };
  }),
);

const matrix = computed(() => {
  const width = { u8: 1, u16: 2, u32: 4, f32: 4 }[props.cell] || 4;
  const need = Math.max(1, props.rows) * Math.max(1, props.cols) * width;
  const raw = bytes.value;
  const note = need > raw.length ? `只显示放得下的 ${Math.floor(raw.length / width)} 个元素` : "";
  const values = [];
  for (let offset = 0; offset + width <= raw.length && values.length < Math.max(1, props.rows) * Math.max(1, props.cols); offset += width) {
    if (props.cell === "u8") values.push(String(raw[offset]));
    else if (props.cell === "u16") values.push(String(raw[offset] | (raw[offset + 1] << 8)));
    else if (props.cell === "u32") {
      const n = raw[offset] | (raw[offset + 1] << 8) | (raw[offset + 2] << 16) | (raw[offset + 3] << 24);
      values.push(String(n >>> 0));
    } else {
      const buf = new ArrayBuffer(4);
      const view = new DataView(buf);
      view.setUint8(0, raw[offset]);
      view.setUint8(1, raw[offset + 1]);
      view.setUint8(2, raw[offset + 2]);
      view.setUint8(3, raw[offset + 3]);
      const n = view.getFloat32(0, true);
      values.push(Number.isFinite(n) ? n.toPrecision(5) : "—");
    }
  }
  const grid = [];
  for (let r = 0; r < Math.max(1, props.rows); r += 1) {
    grid.push(values.slice(r * props.cols, (r + 1) * props.cols));
  }
  return { note, grid };
});

const headline = computed(() => {
  if (!props.row) return "—";
  if (props.field === "f32" && typeof props.row.f32 === "number") return props.row.f32.toPrecision(6);
  return props.row.u32 ?? "—";
});
</script>

<template>
  <div class="data-view">
    <div class="chart-head" v-if="row">
      <h2>{{ row.label || row.name }}</h2>
      <div v-if="row.kind !== 'expr'" class="rail-actions">
        <button type="button" :class="{ on: mode === 'value' }" @click="emit('mode', 'value')">数值</button>
        <button type="button" :class="{ on: mode === 'matrix' }" @click="emit('mode', 'matrix')">矩阵</button>
      </div>
    </div>
    <p v-if="row?.kind === 'expr'" class="headline">{{ headline }}</p>
    <p v-else-if="!row" class="empty-line">选中 Watch 里的一行。</p>
    <template v-else-if="row && mode === 'value'">
      <p class="headline">{{ headline }}</p>
      <div class="rail-actions">
        <button type="button" :class="{ on: field === 'u32' }" @click="emit('field', 'u32')">u32</button>
        <button type="button" :class="{ on: field === 'f32' }" @click="emit('field', 'f32')">f32</button>
      </div>
      <ul class="word-list">
        <li v-for="(item, index) in words" :key="index">
          <span>{{ item.hex }}</span>
          <span>{{ item.u32 }}</span>
          <span>{{ Number.isFinite(item.f32) ? item.f32.toPrecision(5) : "—" }}</span>
        </li>
      </ul>
    </template>
    <template v-else-if="row">
      <div class="rail-actions">
        <label>行 <input :value="rows" inputmode="numeric" @change="emit('shape', { rows: Number($event.target.value) || 1, cols, cell })" /></label>
        <label>列 <input :value="cols" inputmode="numeric" @change="emit('shape', { rows, cols: Number($event.target.value) || 1, cell })" /></label>
        <select :value="cell" @change="emit('shape', { rows, cols, cell: $event.target.value })">
          <option value="u8">u8</option>
          <option value="u16">u16</option>
          <option value="u32">u32</option>
          <option value="f32">f32</option>
        </select>
      </div>
      <p v-if="matrix.note" class="error">{{ matrix.note }}</p>
      <div class="matrix-wrap">
        <table>
          <tr v-for="(line, index) in matrix.grid" :key="index">
            <td v-for="(value, column) in line" :key="column">{{ value }}</td>
          </tr>
        </table>
      </div>
    </template>
  </div>
</template>
