<script setup>
defineProps({
  rows: { type: Array, default: () => [] },
  colors: { type: Object, default: () => ({}) },
  plotted: { type: Object, default: () => ({}) },
  fields: { type: Object, default: () => ({}) },
  selected: { type: String, default: "" },
});
const emit = defineEmits(["remove", "toggle", "select"]);

function current(row, fields) {
  if (row.error) return row.error;
  if ((fields[row.name] || "u32") === "f32" && typeof row.f32 === "number") return row.f32.toPrecision(6);
  return row.u32 ?? "—";
}
</script>

<template>
  <div class="watch-panel">
    <div class="chart-head">
      <h2>Watch</h2>
    </div>
    <div class="table-wrap">
      <table v-if="rows.length">
        <thead>
          <tr>
            <th>曲线</th>
            <th>符号</th>
            <th>地址</th>
            <th>当前值</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in rows"
            :key="row.name"
            :class="{ bad: row.error, picked: selected === row.name }"
            @click="emit('select', row.name)"
          >
            <td @click.stop>
              <input
                type="checkbox"
                :checked="row.kind === 'expr' ? row.enabled : plotted[row.name] !== false"
                @change="emit('toggle', row.name, $event.target.checked)"
              />
            </td>
            <td class="sym">
              <i class="pip" :style="{ background: colors[row.name] }" />
              {{ row.label || row.name }}
            </td>
            <td class="mono">{{ row.addr || "—" }}</td>
            <td class="mono">{{ current(row, fields) }}</td>
            <td @click.stop>
              <button class="ghost" type="button" @click="emit('remove', row.name)">移除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty-line">从左侧加入一个全局或静态变量。</p>
    </div>
  </div>
</template>
