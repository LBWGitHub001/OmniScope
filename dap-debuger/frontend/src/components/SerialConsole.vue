<script setup>
defineProps({
  lines: { type: Array, default: () => [] },
  view: { type: String, default: "text" },
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["update:view", "send"]);
const draft = defineModel("draft", { default: "" });
const mode = defineModel("mode", { default: "text" });
const newline = defineModel("newline", { default: true });
</script>

<template>
  <section class="serial-panel">
    <div class="chart-head">
      <h2>串口助手</h2>
      <div class="serial-tools">
        <button type="button" :class="{ on: view === 'text' }" @click="emit('update:view', 'text')">文本</button>
        <button type="button" :class="{ on: view === 'hex' }" @click="emit('update:view', 'hex')">HEX</button>
        <span>{{ open ? "已打开" : "未打开" }}</span>
      </div>
    </div>
    <pre class="serial-log">{{ lines.map((line) => (view === "hex" ? line.hex : line.text)).filter(Boolean).join("") }}</pre>
    <form class="serial-send" @submit.prevent="emit('send')">
      <select v-model="mode">
        <option value="text">文本</option>
        <option value="hex">HEX</option>
      </select>
      <input v-model="draft" :placeholder="mode === 'hex' ? 'AA 55 01' : '发送内容'" spellcheck="false" />
      <label class="inline"><input v-model="newline" type="checkbox" />换行</label>
      <button type="submit" :disabled="!open">发送</button>
    </form>
  </section>
</template>
