<script setup>
// 试跑：传 run_id，执行一次 fetch + compute；不写特征值
import { ref } from 'vue'
import { operators } from '../api'
import { fmtNum, fmtTime } from '../util'

const props = defineProps({ op: { type: Object, required: true } })
const emit = defineEmits(['ran'])
const runId = ref('')
const running = ref(false)
const results = ref([]) // 最近的试跑结果，新的在前
const error = ref('')

async function run() {
  const id = runId.value.trim()
  if (!id) return
  running.value = true
  error.value = ''
  try {
    const r = await operators.trial(props.op.feature_id, props.op.name, props.op.version, id, { silent: true })
    results.value.unshift(r)
    emit('ran', id, r)
  } catch (e) {
    error.value = `${e.code}：${e.message}`
  } finally {
    running.value = false
  }
}
const summaryRows = (r) => Object.entries(r.data_summary || {}).map(([k, v]) => ({ key: k, ...v }))
</script>

<template>
  <div>
    <div style="display: flex; gap: 8px">
      <el-input v-model="runId" placeholder="run_id，如 RUN-CH-A01-202611250815 或 RUN-0338" clearable class="mono" @keyup.enter="run" />
      <el-button type="primary" :loading="running" :disabled="!runId.trim()" @click="run">试跑</el-button>
    </div>
    <div v-if="error" class="err-list" style="padding: 0; list-style: none">{{ error }}</div>
    <div v-for="(r, i) in results" :key="i" class="card" style="margin-top: 8px">
      <div style="display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap">
        <b class="mono">{{ r.run.run_id }}</b>
        <span class="muted" style="font-size: 12px">{{ r.run.tool }} / {{ r.run.chamber }} · {{ r.run.recipe }} · 晶圆 {{ r.run.wafer || '—' }} · 结束 {{ fmtTime(r.run.end_at) }}</span>
        <span class="spacer" style="flex: 1" />
        <span class="muted" style="font-size: 12px">fetch {{ r.fetch_ms }} ms · compute {{ r.compute_ms }} ms</span>
      </div>
      <div style="margin: 6px 0">
        <template v-if="r.value !== null && r.value !== undefined">
          结果 <el-tag type="success" size="small">{{ fmtNum(r.value, 6) }}</el-tag>
        </template>
        <template v-else>
          空值 <el-tag type="warning" size="small">{{ r.reason }}</el-tag>
          <span v-if="r.reason_detail" class="muted mono" style="font-size: 12px; margin-left: 6px">{{ r.reason_detail }}</span>
        </template>
      </div>
      <el-table v-if="summaryRows(r).length" :data="summaryRows(r)" size="small" border>
        <el-table-column prop="key" label="数据" />
        <el-table-column prop="points" label="点数" width="80" />
        <el-table-column label="t_min" width="90"><template #default="{ row }">{{ fmtNum(row.t_min, 2) }}</template></el-table-column>
        <el-table-column label="t_max" width="90"><template #default="{ row }">{{ fmtNum(row.t_max, 2) }}</template></el-table-column>
      </el-table>
    </div>
  </div>
</template>
