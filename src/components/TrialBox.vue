<script setup>
// 试跑：执行一次 fetch + compute；不写特征值。
// run_id 可以直接输入，也可以按 时间范围 + fleet → 腔室 → recipe → 执行 逐级选出（经 /api/gde 从 GDE 查询）
import { computed, reactive, ref } from 'vue'
import { gde, operators } from '../api'
import { daysAgo, fmtNum, fmtTime, today } from '../util'

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

// ---- 逐级选 run_id
const pick = reactive({
  open: false,
  range: [daysAgo(7), today()],
  fleets: [],
  fleet: '',
  chambers: [], // [{tool, chamber}]
  chamber: '',
  recipes: [],
  recipe: '',
  runs: [],
  loading: '', // 正在加载哪一级
  error: '',
})
const start = () => pick.range?.[0]
const end = () => pick.range?.[1]

async function step(name, fn) {
  pick.loading = name
  pick.error = ''
  try {
    await fn()
  } catch (e) {
    pick.error = `${e.code}：${e.message}`
  } finally {
    pick.loading = ''
  }
}
async function togglePicker() {
  pick.open = !pick.open
  if (pick.open && !pick.fleets.length) await step('fleet', async () => (pick.fleets = await gde.fleets()))
}
function onRange() {
  if (pick.fleet) onFleet()
}
async function onFleet() {
  Object.assign(pick, { chambers: [], chamber: '', recipes: [], recipe: '', runs: [] })
  if (!pick.fleet) return
  await step('chamber', async () => (pick.chambers = await gde.fleetChambers(pick.fleet, start(), end())))
}
async function onChamber() {
  Object.assign(pick, { recipes: [], recipe: '', runs: [] })
  if (!pick.chamber) return
  await step('recipe', async () => (pick.recipes = await gde.chamberRecipes(pick.chamber, start(), end())))
}
async function onRecipe() {
  pick.runs = []
  if (!pick.recipe) return
  await step('run', async () => (pick.runs = await gde.runs({ recipe: pick.recipe, chamber: pick.chamber, start: start(), end: end(), limit: 200 })))
}
const chamberGroups = computed(() => {
  const g = {}
  for (const c of pick.chambers) (g[c.tool] ||= []).push(c.chamber)
  return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
})
function useRun(r) {
  runId.value = r.run_id
}
</script>

<template>
  <div>
    <div style="display: flex; gap: 8px">
      <el-input v-model="runId" placeholder="run_id，可直接输入，或点右侧“选择执行”" clearable class="mono" @keyup.enter="run" />
      <el-button @click="togglePicker">{{ pick.open ? '收起' : '选择执行' }}</el-button>
      <el-button type="primary" :loading="running" :disabled="!runId.trim()" @click="run">试跑</el-button>
    </div>

    <div v-if="pick.open" class="picker">
      <div class="pick-row">
        <el-date-picker v-model="pick.range" type="daterange" value-format="YYYY-MM-DD" :clearable="false" size="small" style="width: 240px" @change="onRange" />
        <el-select v-model="pick.fleet" placeholder="① fleet" size="small" style="width: 150px" :loading="pick.loading === 'fleet'" @change="onFleet">
          <el-option v-for="x in pick.fleets" :key="x" :label="x" :value="x" />
        </el-select>
        <el-select v-model="pick.chamber" placeholder="② 腔室" size="small" filterable style="width: 160px" :disabled="!pick.fleet" :loading="pick.loading === 'chamber'" @change="onChamber">
          <el-option-group v-for="[tool, list] in chamberGroups" :key="tool" :label="tool">
            <el-option v-for="c in list" :key="c" :label="c" :value="c" />
          </el-option-group>
        </el-select>
        <el-select v-model="pick.recipe" placeholder="③ recipe" size="small" filterable style="width: 150px" :disabled="!pick.chamber" :loading="pick.loading === 'recipe'" @change="onRecipe">
          <el-option v-for="x in pick.recipes" :key="x" :label="x" :value="x" />
        </el-select>
      </div>
      <div v-if="pick.error" class="err-list" style="list-style: none; padding: 0">{{ pick.error }}</div>
      <template v-if="pick.recipe">
        <div class="muted" style="font-size: 12px; margin: 6px 0 4px">④ 点击一行选中 run_id（按结束时间倒序，最多 200 条）</div>
        <el-table v-loading="pick.loading === 'run'" :data="pick.runs" size="small" border max-height="240" highlight-current-row empty-text="该范围内没有执行"
          style="cursor: pointer" @row-click="useRun">
          <el-table-column label="run_id" min-width="200"><template #default="{ row }"><span class="mono">{{ row.run_id }}</span></template></el-table-column>
          <el-table-column label="结束时间" width="140"><template #default="{ row }">{{ fmtTime(row.end_at) }}</template></el-table-column>
          <el-table-column label="lot" prop="lot" width="80" />
          <el-table-column label="晶圆" prop="wafer" width="80" />
        </el-table>
      </template>
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

<style scoped>
.picker { border: 1px solid #ebeef5; border-radius: 4px; padding: 8px 10px; margin-top: 8px; background: #fafafa; }
.pick-row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
</style>
