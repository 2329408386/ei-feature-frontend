<script setup>
// 结果：按 recipe、机台、腔室、特征 → 算子、7 / 30 天查特征值；折线图三种点（正常值、重算后的值、空值），点击看来源
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue'
import * as echarts from 'echarts'
import { batches, features, operators, schedules, values } from '../api'
import { BATCH_MODE, daysAgo, fmtNum, fmtTime, labelOf, today } from '../util'
import StatusTag from '../components/StatusTag.vue'

const f = reactive({ recipe: '', tool: '', chamber: '', feature_id: '', operator: '', days: 7 })
const featureList = ref([]) // 特征（每个 feature_id 一条，取最新版本，用于显示单位）
const opList = ref([]) // 所选特征下的全部算子版本
const subs = ref([]) // 调度页的 recipe 行：{recipe, chambers: [{tool, chamber}]}
const rows = ref([])
const overwriteIds = ref(new Set())
const loading = ref(false)
const truncated = ref(false)

const recipeOptions = computed(() => subs.value.map((s) => s.recipe))
// 机台 / 腔室候选：选了 recipe 时只列跑过它的
const chambers = computed(() => {
  const m = new Map()
  for (const s of subs.value) {
    if (f.recipe && s.recipe !== f.recipe) continue
    for (const c of s.chambers || []) m.set(`${c.tool}|${c.chamber}`, c)
  }
  return [...m.values()]
})
const tools = computed(() => [...new Set(chambers.value.map((c) => c.tool))].sort())
const chamberOptions = computed(() => [...new Set(chambers.value.filter((c) => !f.tool || c.tool === f.tool).map((c) => c.chamber))].sort())
const unit = computed(() => featureList.value.find((x) => x.feature_id === f.feature_id)?.unit || '')

onMounted(async () => {
  const [fs, ss] = await Promise.all([features.list({ page_size: 200 }), schedules.list()])
  const seen = new Map()
  for (const x of fs.items) if (!seen.has(x.feature_id)) seen.set(x.feature_id, x)
  featureList.value = [...seen.values()]
  subs.value = ss
  // 默认选第一个已发布的特征（草稿还没有算子和值）
  const first = featureList.value.find((x) => x.status === 'published') || featureList.value[0]
  if (first) {
    f.feature_id = first.feature_id
    await onFeature()
  }
})

async function onFeature() {
  f.operator = ''
  opList.value = []
  rows.value = []
  if (!f.feature_id) return
  const r = await operators.list({ feature_id: f.feature_id, page_size: 200 })
  opList.value = r.items.filter((o) => o.status === 'published' || o.status === 'retired')
  const first = opList.value.find((o) => o.status === 'published') || opList.value[0]
  if (first) {
    f.operator = first.ref
    await load()
  }
}

async function load() {
  if (!f.operator) return
  loading.value = true
  selected.value = null
  try {
    const params = { operator: f.operator, recipe: f.recipe, tool: f.tool, chamber: f.chamber, from: daysAgo(f.days), to: today(), page_size: 1000 }
    const all = []
    let page = 1
    // 最多取 5 页（5000 个点），再多就提示缩小范围
    for (; page <= 5; page++) {
      const r = await values.list({ ...params, page })
      all.push(...r.items)
      if (all.length >= r.total) break
    }
    truncated.value = page > 5
    rows.value = all
    const ow = await batches.list({ mode: 'overwrite', recipe: f.recipe || undefined, page_size: 200 })
    overwriteIds.value = new Set(ow.items.map((b) => b.batch_id))
  } finally {
    loading.value = false
  }
}
watch(() => [f.recipe, f.tool, f.chamber, f.days], load)
watch(() => [f.recipe, f.tool], () => {
  if (f.tool && !tools.value.includes(f.tool)) f.tool = ''
  if (f.chamber && !chamberOptions.value.includes(f.chamber)) f.chamber = ''
})

// ---- 统计
const okRows = computed(() => rows.value.filter((r) => r.value !== null))
const nullRows = computed(() => rows.value.filter((r) => r.value === null))
const reasonStats = computed(() => {
  const m = {}
  for (const r of nullRows.value) m[r.reason || 'UNKNOWN'] = (m[r.reason || 'UNKNOWN'] || 0) + 1
  return Object.entries(m)
    .map(([reason, n]) => ({ reason, n, pct: Math.round((n / nullRows.value.length) * 100) }))
    .sort((a, b) => b.n - a.n)
})
const stats = computed(() => {
  const v = okRows.value.map((r) => r.value)
  if (!v.length) return null
  const mean = v.reduce((a, b) => a + b, 0) / v.length
  const std = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length)
  return { mean, std, min: Math.min(...v), max: Math.max(...v) }
})

// ---- 图
const chartEl = ref(null)
const chart = shallowRef(null)
const selected = ref(null)
const batchInfo = ref(null)
const opInfo = ref(null)

function option() {
  const ok = okRows.value
  const normal = [], rerun = [], nulls = []
  const vmin = stats.value ? stats.value.min : 0
  const vmax = stats.value ? stats.value.max : 1
  const floor = vmin - (vmax - vmin || 1) * 0.08 // 空值画在最低值下方一条线上
  rows.value.forEach((r, i) => {
    const t = new Date(r.run_end_at).getTime()
    if (r.value === null) nulls.push({ value: [t, floor], idx: i })
    else if (overwriteIds.value.has(r.batch_id)) rerun.push({ value: [t, r.value], idx: i })
    else normal.push({ value: [t, r.value], idx: i })
  })
  const line = ok.map((r) => [new Date(r.run_end_at).getTime(), r.value])
  return {
    animation: false,
    grid: { left: 60, right: 24, top: 36, bottom: 60 },
    legend: { data: ['正常值', '重算后的值', '空值'], top: 4 },
    tooltip: {
      trigger: 'item',
      formatter: (p) => {
        const r = rows.value[p.data.idx]
        if (!r) return ''
        const v = r.value === null ? `<b style="color:#e6a23c">空值 ${r.reason}</b>` : `<b>${fmtNum(r.value, 4)}</b> ${unit.value}`
        return `${v}<br/>${r.run_id}<br/>${r.tool} / ${r.chamber} · ${r.recipe}<br/>${fmtTime(r.run_end_at)}`
      },
    },
    xAxis: { type: 'time' },
    yAxis: { type: 'value', scale: true, name: unit.value, min: (v) => Math.min(v.min, floor) },
    dataZoom: [{ type: 'inside' }, { type: 'slider', height: 18, bottom: 10 }],
    series: [
      { name: '_line', type: 'line', data: line, showSymbol: false, lineStyle: { width: 1, color: '#a0cfff' }, silent: true, tooltip: { show: false } },
      { name: '正常值', type: 'scatter', data: normal, symbolSize: 7, itemStyle: { color: '#409eff' } },
      { name: '重算后的值', type: 'scatter', data: rerun, symbolSize: 9, symbol: 'diamond', itemStyle: { color: '#9254de' } },
      { name: '空值', type: 'scatter', data: nulls, symbolSize: 9, symbol: 'triangle', itemStyle: { color: '#e6a23c' } },
    ],
  }
}
function render() {
  if (!chartEl.value) return
  if (!chart.value) {
    chart.value = echarts.init(chartEl.value)
    chart.value.on('click', (p) => {
      if (p.data && p.data.idx !== undefined) pick(rows.value[p.data.idx])
    })
  }
  chart.value.setOption(option(), true)
}
watch([rows, overwriteIds], () => nextTick(render))
const onResize = () => chart.value?.resize()
onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  chart.value?.dispose()
})

const opCache = new Map()
async function pick(r) {
  selected.value = r
  batchInfo.value = null
  opInfo.value = null
  const k = `${r.feature_id}/${r.operator}/${r.version}`
  const [b, o] = await Promise.all([
    batches.get(r.batch_id),
    opCache.get(k) || operators.detail(r.feature_id, r.operator, r.version).then((x) => (opCache.set(k, x), x)),
  ])
  if (selected.value === r) {
    batchInfo.value = b
    opInfo.value = o
  }
}
function showNullsOf(reason) {
  const r = nullRows.value.find((x) => (x.reason || 'UNKNOWN') === reason)
  if (r) pick(r)
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <el-select v-model="f.recipe" placeholder="recipe" clearable filterable allow-create style="width: 140px">
        <el-option v-for="r in recipeOptions" :key="r" :label="r" :value="r" />
      </el-select>
      <el-select v-model="f.tool" placeholder="机台" clearable style="width: 120px">
        <el-option v-for="t in tools" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="f.chamber" placeholder="腔室" clearable filterable allow-create style="width: 120px">
        <el-option v-for="c in chamberOptions" :key="c" :label="c" :value="c" />
      </el-select>
      <el-select v-model="f.feature_id" placeholder="特征" filterable style="width: 200px" @change="onFeature">
        <el-option v-for="x in featureList" :key="x.feature_id" :label="labelOf(x.feature_id, x.display_name)" :value="x.feature_id">
          <span>{{ labelOf(x.feature_id, x.display_name) }}</span> <span class="muted" style="font-size: 12px">{{ x.description }}</span>
        </el-option>
      </el-select>
      <span class="muted">→</span>
      <el-select v-model="f.operator" placeholder="算子" style="width: 260px" @change="load">
        <el-option v-for="o in opList" :key="o.ref" :label="o.ref" :value="o.ref">
          <span class="mono">{{ o.name }}@{{ o.version }}</span>
          <span v-if="o.display_name" style="margin-left: 6px">{{ o.display_name }}</span>
          <StatusTag :status="o.status" style="margin-left: 8px" />
        </el-option>
      </el-select>
      <el-radio-group v-model="f.days">
        <el-radio-button :value="7">7 天</el-radio-button>
        <el-radio-button :value="30">30 天</el-radio-button>
      </el-radio-group>
      <span class="spacer" />
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="grid">
      <div class="card" style="min-width: 0">
        <div style="display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; font-size: 13px">
          <b>{{ f.operator || '请选择算子' }}</b>
          <span>共 {{ rows.length }} 个执行</span>
          <span>值 {{ okRows.length }}</span>
          <span style="color: #e6a23c">空值 {{ nullRows.length }}</span>
          <template v-if="stats">
            <span class="muted">均值 {{ fmtNum(stats.mean) }} · 标准差 {{ fmtNum(stats.std) }} · 范围 {{ fmtNum(stats.min) }} ~ {{ fmtNum(stats.max) }} {{ unit }}</span>
          </template>
          <span v-if="truncated" style="color: #f56c6c">点数过多，只显示前 5000 个，请缩小范围</span>
        </div>
        <div v-loading="loading" style="position: relative">
          <div ref="chartEl" style="height: 400px; margin-top: 6px" />
          <div v-if="!loading && !rows.length" class="empty muted">该范围内没有特征值</div>
        </div>
        <div class="muted" style="font-size: 12px">点击图上的任意一个点，查看这个值的来源；滚轮缩放时间轴。</div>
      </div>

      <div style="display: flex; flex-direction: column; gap: 12px; min-width: 0">
        <div class="card">
          <div class="section-title">来源</div>
          <div v-if="!selected" class="muted" style="font-size: 13px">点击图上的点</div>
          <template v-else>
            <el-descriptions :column="1" border size="small">
              <el-descriptions-item label="值">
                <b v-if="selected.value !== null">{{ fmtNum(selected.value, 6) }} {{ unit }}</b>
                <template v-else>
                  <el-tag type="warning" size="small">空值 {{ selected.reason }}</el-tag>
                  <div v-if="selected.reason_detail" class="mono muted" style="font-size: 12px; margin-top: 4px; word-break: break-all">{{ selected.reason_detail }}</div>
                </template>
              </el-descriptions-item>
              <el-descriptions-item label="run_id"><span class="mono">{{ selected.run_id }}</span></el-descriptions-item>
              <el-descriptions-item label="机台 / 腔室">{{ selected.tool }} / {{ selected.chamber }}</el-descriptions-item>
              <el-descriptions-item label="recipe">{{ selected.recipe }}</el-descriptions-item>
              <el-descriptions-item label="lot / 晶圆">{{ selected.lot || '—' }} / {{ selected.wafer || '—' }}</el-descriptions-item>
              <el-descriptions-item label="执行结束">{{ fmtTime(selected.run_end_at, true) }}</el-descriptions-item>
              <el-descriptions-item label="计算时间">{{ fmtTime(selected.computed_at, true) }}</el-descriptions-item>
              <el-descriptions-item label="算子">
                <span class="mono">{{ selected.feature_id }}/{{ selected.operator }}@{{ selected.version }}</span>
                <el-tag v-if="selected.retired" size="small" type="danger" style="margin-left: 4px">已下线</el-tag>
                <div v-if="opInfo" class="mono muted" style="font-size: 11px">{{ opInfo.code_file }} · {{ opInfo.code_hash.slice(0, 16) }}…</div>
              </el-descriptions-item>
              <el-descriptions-item label="批次">
                #{{ selected.batch_id }}
                <template v-if="batchInfo">
                  · {{ BATCH_MODE[batchInfo.mode] }} · <StatusTag kind="batch" :status="batchInfo.status" />
                  <div class="muted" style="font-size: 12px">{{ batchInfo.created_by }} · {{ fmtTime(batchInfo.created_at) }}<span v-if="batchInfo.reason"> · {{ batchInfo.reason }}</span></div>
                </template>
              </el-descriptions-item>
            </el-descriptions>
          </template>
        </div>

        <div class="card">
          <div class="section-title">空值原因</div>
          <div v-if="!reasonStats.length" class="muted" style="font-size: 13px">没有空值</div>
          <div v-for="s in reasonStats" :key="s.reason" class="reason" @click="showNullsOf(s.reason)">
            <div style="display: flex; justify-content: space-between; font-size: 13px">
              <span class="mono">{{ s.reason }}</span><span>{{ s.n }}（{{ s.pct }}%）</span>
            </div>
            <el-progress :percentage="s.pct" :show-text="false" :stroke-width="6" color="#e6a23c" />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; align-items: start; }
.empty { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.reason { padding: 4px 0; cursor: pointer; }
.reason:hover { background: #fafafa; }
</style>
