<script setup>
// 调度：树形展示 特征 → 算子 → recipe → 机台 / 腔室。
// 订阅按 recipe（GDE 推送它在所有机台 / 腔室上的执行，含新腔室），暂停 / 恢复、补算 / 重算都在 recipe 这一层；
// 计算批次表；补算 / 重算按 recipe 勾选算子（覆盖该 recipe 下全部腔室）
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { batches, features, schedules } from '../api'
import { BATCH_MODE, daysAgo, fmtTime, labelOf, today } from '../util'
import StatusTag from '../components/StatusTag.vue'
import ErrorList from '../components/ErrorList.vue'

// ======================================================== 特征 → 算子 → recipe → 机台 / 腔室
const sf = reactive({ feature_id: '', recipe: '', tool: '', chamber: '' })
const tree = ref([])
const featureList = ref([])
const subLoading = ref(false)
async function loadSubs() {
  subLoading.value = true
  try {
    tree.value = await schedules.tree({ ...sf })
  } finally {
    subLoading.value = false
  }
}
const uniq = (a) => [...new Set(a)]
/** 转成 el-table 树形数据，每层带 kind */
const treeRows = computed(() =>
  tree.value.map((f) => {
    const recipes = uniq(f.operators.flatMap((o) => o.recipes.map((r) => r.recipe)))
    const tools = uniq(f.operators.flatMap((o) => o.recipes.flatMap((r) => (r.chambers || []).map((c) => c.tool))))
    return {
      key: `f:${f.feature_id}`, kind: 'feature', feature_id: f.feature_id, name: f.name, recipes, tools, opCount: f.operators.length,
      children: f.operators.map((o) => ({
        key: `o:${o.ref}`, kind: 'operator', ...o, feature_id: f.feature_id,
        children: o.recipes.map((r) => ({
          key: `r:${o.ref}|${r.recipe}`, kind: 'recipe', ...r, ref: o.ref,
          children: (r.chambers || []).map((c) => ({ key: `c:${o.ref}|${r.recipe}|${c.tool}|${c.chamber}`, kind: 'chamber', ...c, recipe: r.recipe })),
        })),
      })),
    }
  }),
)
// recipe -> 绑定了它的算子引用（补算 / 重算的候选）
const opsByRecipe = computed(() => {
  const m = {}
  for (const f of tree.value) for (const o of f.operators) for (const r of o.recipes) (m[r.recipe] ||= []).push(o.ref)
  return m
})
const allKeys = (rows, depth) => rows.flatMap((r) => (depth > 0 && r.children ? [r.key, ...allKeys(r.children, depth - 1)] : []))
const expanded = ref([])
function expandTo(depth) {
  expanded.value = allKeys(treeRows.value, depth)
}
async function pause(s) {
  const ops = opsByRecipe.value[s.recipe] || []
  await ElMessageBox.confirm(`暂停 recipe ${s.recipe} 的计算？会经 SDK 暂停 GDE 订阅：该 recipe 下全部腔室、绑定它的 ${ops.length} 个算子都会暂停，恢复后继续推送。`, '暂停', { type: 'warning' })
  await schedules.pause(s.recipe)
  ElMessage.success('已暂停')
  loadSubs()
}
async function resume(s) {
  await schedules.resume(s.recipe)
  ElMessage.success('已恢复')
  loadSubs()
}

// ======================================================== 批次
const bf = reactive({ recipe: '', mode: '', status: '' })
const pager = reactive({ page: 1, page_size: 15, total: 0 })
const rows = ref([])
const batchLoading = ref(false)
async function loadBatches(quiet = false) {
  if (!quiet) batchLoading.value = true
  try {
    const r = await batches.list({ ...bf, page: pager.page, page_size: pager.page_size })
    rows.value = r.items
    pager.total = r.total
  } finally {
    batchLoading.value = false
  }
}
function searchBatches() {
  pager.page = 1
  loadBatches()
}
async function cancel(b) {
  await ElMessageBox.confirm(`取消批次 #${b.batch_id}？已写入的值保留。`, '取消批次', { type: 'warning' })
  await batches.cancel(b.batch_id)
  ElMessage.success('已取消')
  loadBatches()
}
const recipes = computed(() => Object.keys(opsByRecipe.value).sort())

// 有排队或进行中的批次时每 5 秒刷新
let timer = null
onMounted(async () => {
  loadSubs()
  const fs = await features.list({ page_size: 200 })
  const seen = new Map()
  for (const f of fs.items) if (!seen.has(f.feature_id)) seen.set(f.feature_id, f)
  featureList.value = [...seen.values()].sort((a, b) => a.feature_id.localeCompare(b.feature_id))
  loadBatches()
  timer = setInterval(() => {
    if (rows.value.some((b) => b.status === 'queued' || b.status === 'running')) loadBatches(true)
  }, 5000)
})
onBeforeUnmount(() => clearInterval(timer))

// 批次详情
const detail = reactive({ open: false, b: null })
function showBatch(b) {
  Object.assign(detail, { open: true, b })
}

// ======================================================== 补算 / 重算
const dlg = reactive({ open: false, recipe: '', chambers: null, mode: 'fill', ops: [], checked: [], range: [daysAgo(7), today()], reason: '', errors: [], busy: false })
function openBatch(s, mode) {
  const ops = opsByRecipe.value[s.recipe] || []
  Object.assign(dlg, {
    open: true, recipe: s.recipe, chambers: s.chambers, mode, ops, checked: [s.ref], // 默认只勾所在算子
    range: [daysAgo(7), today()], reason: '', errors: [],
  })
}
const disabledDate = (d) => d > new Date()
async function createBatch() {
  dlg.errors = []
  if (!dlg.reason.trim()) {
    dlg.errors = [{ message: '请填写原因' }]
    return
  }
  dlg.busy = true
  try {
    const b = await batches.create(
      { recipe: dlg.recipe, mode: dlg.mode, operators: dlg.checked, from: dlg.range[0], to: dlg.range[1], reason: dlg.reason.trim() },
      { silent: true },
    )
    ElMessage.success(`已创建批次 #${b.batch_id}，排队中`)
    dlg.open = false
    loadBatches()
  } catch (e) {
    dlg.errors = e.errors.length ? e.errors : [{ message: `${e.code}：${e.message}` }]
  } finally {
    dlg.busy = false
  }
}
const pct = (b) => (b.run_total ? Math.round(((b.value_ok + b.value_null) / b.run_total) * 100) : 0)
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <b class="block-title">计算调度</b>
      <span class="muted" style="font-size: 12px">特征 → 算子 → recipe → 机台 / 腔室；订阅按 recipe，GDE 推送它在所有机台 / 腔室上的执行（含新腔室）</span>
      <span class="spacer" />
      <el-select v-model="sf.feature_id" placeholder="特征" clearable filterable style="width: 180px" @change="loadSubs">
        <el-option v-for="f in featureList" :key="f.feature_id" :label="labelOf(f.feature_id, f.display_name)" :value="f.feature_id" />
      </el-select>
      <el-input v-model="sf.recipe" placeholder="recipe" clearable style="width: 130px" @change="loadSubs" />
      <el-input v-model="sf.tool" placeholder="机台" clearable style="width: 110px" @change="loadSubs" />
      <el-input v-model="sf.chamber" placeholder="腔室" clearable style="width: 110px" @change="loadSubs" />
      <el-button-group>
        <el-button @click="expandTo(0)">收起</el-button>
        <el-button @click="expandTo(2)">展开到 recipe</el-button>
        <el-button @click="expandTo(3)">全部展开</el-button>
      </el-button-group>
      <el-button @click="loadSubs">刷新</el-button>
    </div>
    <el-table v-loading="subLoading" :data="treeRows" row-key="key" :expand-row-keys="expanded" :row-class-name="({ row }) => 'lv-' + row.kind"
      empty-text="还没有计算调度：先在「算子绑定」页绑定 recipe 并审核通过" class="sched-tree">
      <el-table-column label="特征 / 算子 / recipe / 机台腔室" min-width="320">
        <template #default="{ row }">
          <template v-if="row.kind === 'feature'">
            <span class="lv-badge f">特征</span><b>{{ row.name || row.feature_id }}</b>
            <span v-if="row.name" class="muted mono id">{{ row.feature_id }}</span>
          </template>
          <template v-else-if="row.kind === 'operator'">
            <span class="lv-badge o">算子</span><b>{{ row.name || row.operator }}</b>
            <span class="muted mono id">{{ row.operator }}@{{ row.version }}</span>
          </template>
          <template v-else-if="row.kind === 'recipe'">
            <span class="lv-badge r">recipe</span><b class="mono">{{ row.recipe }}</b>
          </template>
          <template v-else>
            <span class="lv-badge c">腔室</span><span class="mono">{{ row.tool }} / {{ row.chamber }}</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="概况" min-width="230">
        <template #default="{ row }">
          <span v-if="row.kind === 'feature'" class="muted">{{ row.opCount }} 个算子 · {{ row.recipes.length }} 个 recipe · {{ row.tools.length }} 台机台</span>
          <span v-else-if="row.kind === 'operator'" class="muted">{{ row.recipes.length }} 个 recipe</span>
          <template v-else-if="row.kind === 'recipe'">
            <span v-if="row.chambers" class="muted">{{ uniq(row.chambers.map((c) => c.tool)).length }} 台机台 · {{ row.chambers.length }} 个腔室</span>
            <span v-else class="muted">GDE 暂时查不到腔室</span>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="GDE 订阅" width="130">
        <template #default="{ row }"><span v-if="row.kind === 'recipe'" class="mono">{{ row.gde_sub_id || '—' }}</span></template>
      </el-table-column>
      <el-table-column label="同步" width="110">
        <template #default="{ row }">
          <template v-if="row.kind === 'recipe'">
            <el-tag v-if="row.synced" type="success" size="small" round>已同步</el-tag>
            <el-tooltip v-else :content="row.last_error || '等待后台同步'"><el-tag type="danger" size="small" round>未同步</el-tag></el-tooltip>
          </template>
        </template>
      </el-table-column>
      <el-table-column label="已处理到" width="140">
        <template #default="{ row }"><span v-if="row.kind === 'recipe' || row.kind === 'chamber'">{{ fmtTime(row.progress) }}</span></template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }"><StatusTag v-if="row.kind === 'recipe'" kind="sub" :status="row.status" /></template>
      </el-table-column>
      <el-table-column label="操作" width="170">
        <template #default="{ row }">
          <template v-if="row.kind === 'recipe'">
            <el-button v-if="row.status === 'running'" link type="warning" :disabled="!row.gde_sub_id" @click="pause(row)">暂停</el-button>
            <el-button v-else-if="row.status === 'paused'" link type="success" @click="resume(row)">恢复</el-button>
            <el-button link type="primary" @click="openBatch(row, 'fill')">补算</el-button>
            <el-button link type="danger" @click="openBatch(row, 'overwrite')">重算</el-button>
          </template>
        </template>
      </el-table-column>
    </el-table>

    <div class="toolbar" style="margin-top: 26px">
      <b class="block-title">计算批次</b>
      <span class="muted" style="font-size: 12px">实时计算按 recipe、整点归为一个批次；补算只算缺的值，重算覆盖已有值</span>
      <span class="spacer" />
      <el-select v-model="bf.recipe" placeholder="recipe" clearable filterable allow-create style="width: 140px" @change="searchBatches">
        <el-option v-for="r in recipes" :key="r" :label="r" :value="r" />
      </el-select>
      <el-select v-model="bf.mode" placeholder="类型" clearable style="width: 100px" @change="searchBatches">
        <el-option v-for="(t, k) in BATCH_MODE" :key="k" :label="t" :value="k" />
      </el-select>
      <el-select v-model="bf.status" placeholder="状态" clearable style="width: 110px" @change="searchBatches">
        <el-option label="排队中" value="queued" />
        <el-option label="进行中" value="running" />
        <el-option label="完成" value="done" />
        <el-option label="失败" value="failed" />
        <el-option label="已取消" value="cancelled" />
      </el-select>
      <el-button size="small" @click="loadBatches()">刷新</el-button>
    </div>
    <el-table v-loading="batchLoading" :data="rows" border @row-click="showBatch" style="cursor: pointer">
      <el-table-column label="批次" width="80"><template #default="{ row }">#{{ row.batch_id }}</template></el-table-column>
      <el-table-column label="recipe" width="120"><template #default="{ row }"><span class="mono">{{ row.recipe }}</span></template></el-table-column>
      <el-table-column label="类型" width="70"><template #default="{ row }">{{ BATCH_MODE[row.mode] }}</template></el-table-column>
      <el-table-column label="算子" min-width="220" show-overflow-tooltip>
        <template #default="{ row }"><span class="mono" style="font-size: 12px">{{ row.operators ? row.operators.join(', ') : '全部（实时）' }}</span></template>
      </el-table-column>
      <el-table-column label="数据范围" width="230"><template #default="{ row }">{{ fmtTime(row.data_from) }} ~ {{ fmtTime(row.data_to).slice(5) }}</template></el-table-column>
      <el-table-column label="结果" width="170">
        <template #default="{ row }">
          <span>执行 {{ row.run_total }} · 值 {{ row.value_ok }}</span>
          <span v-if="row.value_null" style="color: #e6a23c"> · 空 {{ row.value_null }}</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120">
        <template #default="{ row }">
          <StatusTag kind="batch" :status="row.status" />
          <el-tooltip v-if="row.superseded_by" :content="`已被批次 #${row.superseded_by} 重算覆盖`"><el-tag size="small" type="info" style="margin-left: 4px">已覆盖</el-tag></el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="发起" width="90" prop="created_by" />
      <el-table-column label="" width="70">
        <template #default="{ row }">
          <el-button v-if="row.mode !== 'live' && (row.status === 'queued' || row.status === 'running')" link type="danger" @click.stop="cancel(row)">取消</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-if="pager.total > pager.page_size" v-model:current-page="pager.page" :page-size="pager.page_size" :total="pager.total"
      layout="total, prev, pager, next" style="margin-top: 12px; justify-content: flex-end" @current-change="loadBatches()" />

    <!-- 补算 / 重算 -->
    <el-dialog v-model="dlg.open" :title="`${dlg.mode === 'fill' ? '补算' : '重算'} · ${dlg.recipe}`" width="600px">
      <el-alert v-if="dlg.mode === 'overwrite'" type="warning" :closable="false" show-icon style="margin-bottom: 10px"
        title="重算会覆盖范围内已有的值，旧批次标记为已被覆盖" />
      <el-form label-width="80px">
        <el-form-item label="范围">
          <span style="font-size: 13px">该 recipe 在所有机台 / 腔室上的执行<span v-if="dlg.chambers" class="muted">（GDE 当前 {{ dlg.chambers.length }} 个腔室）</span></span>
        </el-form-item>
        <el-form-item label="算子">
          <el-checkbox-group v-model="dlg.checked" style="display: flex; flex-direction: column">
            <el-checkbox v-for="o in dlg.ops" :key="o" :value="o"><span class="mono">{{ o }}</span></el-checkbox>
          </el-checkbox-group>
        </el-form-item>
        <el-form-item label="数据范围">
          <el-date-picker v-model="dlg.range" type="daterange" value-format="YYYY-MM-DD" :disabled-date="disabledDate" :clearable="false" />
          <div class="muted" style="font-size: 12px; width: 100%">按执行结束时间，单次最多 31 天</div>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="dlg.reason" placeholder="必填，如：算子 v2 上线后补算上周数据" />
        </el-form-item>
      </el-form>
      <ErrorList :errors="dlg.errors" />
      <template #footer>
        <el-button @click="dlg.open = false">取消</el-button>
        <el-button :type="dlg.mode === 'fill' ? 'primary' : 'danger'" :loading="dlg.busy" :disabled="!dlg.checked.length" @click="createBatch">
          提交{{ dlg.mode === 'fill' ? '补算' : '重算' }}
        </el-button>
      </template>
    </el-dialog>

    <!-- 批次详情 -->
    <el-drawer v-model="detail.open" :title="detail.b ? `批次 #${detail.b.batch_id}` : ''" size="520px">
      <template v-if="detail.b">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="类型">{{ BATCH_MODE[detail.b.mode] }}</el-descriptions-item>
          <el-descriptions-item label="状态"><StatusTag kind="batch" :status="detail.b.status" /></el-descriptions-item>
          <el-descriptions-item label="recipe"><span class="mono">{{ detail.b.recipe }}</span></el-descriptions-item>
          <el-descriptions-item label="算子">
            <div v-for="o in detail.b.operators || []" :key="o" class="mono" style="font-size: 12px">{{ o }}</div>
            <span v-if="!detail.b.operators">全部（实时）</span>
          </el-descriptions-item>
          <el-descriptions-item label="数据范围">{{ fmtTime(detail.b.data_from) }} ~ {{ fmtTime(detail.b.data_to) }}</el-descriptions-item>
          <el-descriptions-item label="进度">
            <el-progress v-if="detail.b.run_total" :percentage="pct(detail.b)" style="width: 240px" />
            执行 {{ detail.b.run_total }}，值 {{ detail.b.value_ok }}，空值 {{ detail.b.value_null }}
          </el-descriptions-item>
          <el-descriptions-item label="原因">{{ detail.b.reason || '—' }}</el-descriptions-item>
          <el-descriptions-item v-if="detail.b.error" label="错误"><span style="color: #f56c6c">{{ detail.b.error }}</span></el-descriptions-item>
          <el-descriptions-item v-if="detail.b.superseded_by" label="被覆盖">批次 #{{ detail.b.superseded_by }}</el-descriptions-item>
          <el-descriptions-item label="发起">{{ detail.b.created_by }} · {{ fmtTime(detail.b.created_at, true) }}</el-descriptions-item>
          <el-descriptions-item label="开始 / 结束">{{ fmtTime(detail.b.started_at, true) }} / {{ fmtTime(detail.b.finished_at, true) }}</el-descriptions-item>
        </el-descriptions>
      </template>
    </el-drawer>
  </div>
</template>

<style scoped>
.id { font-size: 12px; margin-left: 6px; }
.lv-badge { display: inline-block; font-size: 11px; line-height: 18px; padding: 0 8px; border-radius: 99px; margin-right: 8px; font-weight: 600; }
.lv-badge.f { background: var(--brand-soft); color: var(--brand); }
.lv-badge.o { background: #f3ecff; color: #8b5cf6; }
.lv-badge.r { background: #fff3e6; color: #f08a24; }
.lv-badge.c { background: #e8f8f1; color: #17a673; }
.sched-tree :deep(.lv-feature) { background: #fbfcff; }
.sched-tree :deep(.lv-feature td) { font-size: 14px; }
.sched-tree :deep(.lv-chamber td) { color: var(--fg-soft); font-size: 12.5px; }
</style>
