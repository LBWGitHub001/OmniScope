<script setup>
import { computed } from "vue";

const props = defineProps({
  series: { type: Array, default: () => [] },
  mode: { type: String, default: "time" },
  marker: { type: Number, default: null },
});
const emit = defineEmits(["toggle", "mode"]);

const W = 640;
const H = 280;
const L = 64;
const R = 16;
const T = 36;
const B = 28;

function formatTick(value) {
  const abs = Math.abs(value);
  if (abs >= 10000 || (abs > 0 && abs < 0.01)) return value.toExponential(1);
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1000) / 1000);
}

const layout = computed(() => {
  const series = props.series.filter((item) => item.points.length > 0);
  const points = series.flatMap((item) => item.points);
  if (!points.length) return null;

  let x0 = Math.min(...points.map((point) => point.x));
  let x1 = Math.max(...points.map((point) => point.x));
  if (x1 <= x0) x1 = x0 + 1;

  let y0 = Math.min(...points.map((point) => point.y));
  let y1 = Math.max(...points.map((point) => point.y));
  if (y1 <= y0) {
    y0 -= 1;
    y1 += 1;
  }
  const pad = (y1 - y0) * 0.08;
  y0 -= pad;
  y1 += pad;

  const xOf = (x) => L + ((x - x0) / (x1 - x0)) * (W - L - R);
  const yOf = (y) => T + (1 - (y - y0) / (y1 - y0)) * (H - T - B);
  const paths = series.map((item) => ({
    name: item.name,
    color: item.color,
    d: item.points
      .map((point, index) => {
        const cmd = index === 0 ? "M" : "L";
        return `${cmd}${xOf(point.x).toFixed(1)},${yOf(point.y).toFixed(1)}`;
      })
      .join(" "),
  }));
  const yTicks = [1, 0.5, 0].map((fraction) => {
    const value = y0 + (y1 - y0) * fraction;
    return { y: yOf(value), label: formatTick(value) };
  });
  const markerX = typeof props.marker === "number" && Number.isFinite(props.marker) ? xOf(props.marker) : null;
  return {
    paths,
    yTicks,
    markerX,
    left: props.mode === "fn" ? formatTick(x0) : "0",
    right: props.mode === "fn" ? formatTick(x1) : "现在",
  };
});
</script>

<template>
  <div class="chart-panel">
    <div class="chart-head">
      <h2>曲线</h2>
      <div class="rail-actions">
        <button type="button" :class="{ on: mode === 'time' }" @click="emit('mode', 'time')">时间</button>
        <button type="button" :class="{ on: mode === 'fn' }" @click="emit('mode', 'fn')">函数</button>
      </div>
      <ul v-if="series.length" class="legend">
        <li v-for="item in series" :key="item.name">
          <button type="button" @click="emit('toggle', item.name, false)">
            <i :style="{ background: item.color }" />
            {{ item.label || item.name }}
          </button>
        </li>
      </ul>
      <p v-if="layout">{{ mode === "fn" ? "横轴 x" : "横轴时间" }}</p>
      <p v-else>勾选后画在这里</p>
    </div>
    <svg class="chart" :viewBox="`0 0 ${W} ${H}`" role="img">
      <template v-if="layout">
        <line
          v-for="tick in layout.yTicks"
          :key="tick.label"
          :x1="L"
          :x2="W - R"
          :y1="tick.y"
          :y2="tick.y"
          class="grid"
        />
        <text
          v-for="tick in layout.yTicks"
          :key="`l-${tick.label}`"
          :x="L - 8"
          :y="tick.y + 4"
          class="tick"
        >
          {{ tick.label }}
        </text>
        <path v-for="item in layout.paths" :key="item.name" :d="item.d" :stroke="item.color" class="line" />
        <line v-if="layout.markerX != null" :x1="layout.markerX" :x2="layout.markerX" :y1="T" :y2="H - B" class="marker" />
        <text :x="L" :y="H - 8" class="tick axis">{{ layout.left }}</text>
        <text :x="W - R" :y="H - 8" class="tick axis now">{{ layout.right }}</text>
      </template>
    </svg>
  </div>
</template>
