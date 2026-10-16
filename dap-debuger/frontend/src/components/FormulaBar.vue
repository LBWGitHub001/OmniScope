<script setup>
defineProps({
  formulas: { type: Array, default: () => [] },
  symbols: { type: Array, default: () => [] },
});
const emit = defineEmits(["add", "toggle", "source", "remove"]);
const draft = defineModel("draft", { default: "" });
const source = defineModel("source", { default: "" });
</script>

<template>
  <section class="formula-panel">
    <form class="formula-add" @submit.prevent="emit('add')">
      <input v-model="draft" placeholder="sin(x)   2x   x^2   x+2" spellcheck="false" />
      <select v-model="source">
        <option value="">x 来自…</option>
        <option v-for="row in symbols" :key="row.name" :value="row.name">{{ row.name }}</option>
      </select>
      <button type="submit">添加曲线</button>
    </form>
    <ul v-if="formulas.length" class="formulas">
      <li v-for="item in formulas" :key="item.id">
        <input type="checkbox" :checked="item.enabled" @change="emit('toggle', item.id, $event.target.checked)" />
        <code>{{ item.expr }}</code>
        <select :value="item.source" @change="emit('source', item.id, $event.target.value)">
          <option v-for="row in symbols" :key="row.name" :value="row.name">x = {{ row.name }}</option>
        </select>
        <span v-if="item.error" class="error">{{ item.error }}</span>
        <button class="ghost" type="button" @click="emit('remove', item.id)">删除</button>
      </li>
    </ul>
  </section>
</template>
