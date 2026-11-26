<script setup>
// 逐条显示 SPEC_INVALID / BINDING_INVALID / VALIDATION_ERROR 的 details.errors
defineProps({ errors: { type: Array, default: () => [] } })
function where(e) {
  if (e.path) return e.path
  if (e.file) return e.line ? `${e.file}:${e.line}` : e.file
  if (e.loc) return Array.isArray(e.loc) ? e.loc.join('.') : e.loc
  return ''
}
</script>

<template>
  <ul v-if="errors.length" class="err-list">
    <li v-for="(e, i) in errors" :key="i"><b v-if="where(e)">{{ where(e) }}：</b>{{ e.message || e.msg }}</li>
  </ul>
</template>
