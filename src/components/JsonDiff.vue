<script setup>
// 两段 JSON 的逐行对比（LCS），用于绑定修订对比
import { computed } from 'vue'

const props = defineProps({ left: [Object, null], right: [Object, null], leftTitle: String, rightTitle: String })

const rows = computed(() => {
  const a = props.left ? JSON.stringify(props.left, null, 2).split('\n') : []
  const b = props.right ? JSON.stringify(props.right, null, 2).split('\n') : []
  const n = a.length, m = b.length
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  const out = []
  let i = 0, j = 0
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push({ t: ' ', s: a[i] }); i++; j++ }
    else if (j < m && (i >= n || dp[i][j + 1] >= dp[i + 1][j])) { out.push({ t: '+', s: b[j] }); j++ }
    else { out.push({ t: '-', s: a[i] }); i++ }
  }
  return out
})
</script>

<template>
  <div>
    <div class="muted" style="font-size: 12px; margin-bottom: 4px">
      <span class="del">− {{ leftTitle || '旧' }}</span>　<span class="add">+ {{ rightTitle || '新' }}</span>
    </div>
    <pre class="code diff"><div v-for="(r, k) in rows" :key="k" :class="{ add: r.t === '+', del: r.t === '-' }">{{ r.t }} {{ r.s }}</div></pre>
  </div>
</template>

<style scoped>
.diff div { white-space: pre; }
.add { background: #f0f9eb; color: #529b2e; }
.del { background: #fef0f0; color: #c45656; }
</style>
