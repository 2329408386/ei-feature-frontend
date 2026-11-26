<script setup>
// 只读代码高亮
import { computed } from 'vue'
import hljs from 'highlight.js/lib/core'
import python from 'highlight.js/lib/languages/python'
import json from 'highlight.js/lib/languages/json'

hljs.registerLanguage('python', python)
hljs.registerLanguage('json', json)

const props = defineProps({ code: { type: String, default: '' }, lang: { type: String, default: 'python' }, maxHeight: String })
const html = computed(() => hljs.highlight(props.code || '', { language: props.lang }).value)
</script>

<template>
  <pre class="code" :style="maxHeight ? { maxHeight } : null"><code class="hljs" v-html="html" /></pre>
</template>

<style scoped>
pre.code code.hljs { padding: 0; background: transparent; }
</style>
