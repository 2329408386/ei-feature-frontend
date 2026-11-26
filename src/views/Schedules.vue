<script setup>
// 调度：腔室订阅表 + 计算批次表；补算 / 重算按腔室勾选算子
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { batches, bindings, schedules } from '../api'
import { BATCH_MODE, daysAgo, fmtTime, today } from '../util'
import StatusTag from '../components/StatusTag.vue'
import ErrorList from '../components/ErrorList.vue'

// ======================================================== 腔室订阅
const subs = ref([])
const subLoading = ref(false)
async function loadSubs() {
  subLoading.value = true
  try {
    subs.value = await schedules.list()
  } finally {
    subLoading.value = false
  }
}
async function pause(s) {
  await ElMessageBox.confirm(`暂停腔室 ${s.chamber} 的计算？会经 SDK 暂停 GDE 订阅，恢复后继续推送。`, '暂停', { type: 'warning' })
  await schedules.pause(s.chamber)
  ElMessage.success('已暂停')
  loadSubs()
}
async function resume(s) {
  await schedules.resume(s.chamber)
  ElMessage.success('已恢复')
  loadSubs()
}

// ======================================================== 批次
const bf = reactive({ chamber: '', mode: '', status: '' })
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
const chambers = computed(() => [...new Set(subs.value.map((s) => s.chamber))].sort())

// 有排队或进行中的批次时每 5 秒刷新
let timer = null
onMounted(() => {
  loadSubs()
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
const dlg = reactive({ open: false, chamber: '', mode: 'fill', ops: [], checked: [], range: [daysAgo(7), today()], reason: '', errors: [], busy: false, loading: false })
async function openBatch(s, mode) {
  Object.assign(dlg, { open: true, chamber: s.chamber, mode, ops: [], checked: [], range: [daysAgo(7), today()], reason: '', errors: [], loading: true })
  try {
    const r = await bindings.list({ chamber: s.chamber, status: 'active' })
    // 该腔室生效绑定中的算子，以及它在这个腔室上绑定的 recipe
    dlg.ops = r.items
      .filter((it) => it.active)
      .map((it) => ({
        ref: `${it.feature_id}/${it.operator}@${it.active.version}`,
        recipes: it.active.spec.recipes.filter((x) => x.chambers.some((c) => c.chamber === s.chamber)).map((x) => x.recipe),
      }))
    dlg.checked = dlg.ops.map((o) => o.ref)
  } finally {
    dlg.loading = false
  }
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
      { chamber: dlg.chamber, mode: dlg.mode, operators: dlg.checked, from: dlg.range[0], to: dlg.range[1], reason: dlg.reason.trim() },
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
      <b>腔室订阅</b>
      <span class="muted" style="font-size: 12px">订阅范围 = 该腔室上所有生效绑定的 recipe 并集；审核通过后自动同步 GDE，失败由后台每分钟重试</span>
      <span class="spacer" />
      <el-button size="small" @click="loadSubs">刷新</el-button>
    </div>
    <el-table v-loading="subLoading" :data="subs" border empty-text="还没有腔室订阅：先在「算子绑定」页绑定并审核通过">
      <el-table-column label="机台 / 腔室" width="160"><template #default="{ row }">{{ row.tool }} / <b>{{ row.chamber }}</b></template></el-table-column>
      <el-table-column label="GDE 订阅" width="140"><template #default="{ row }"><span class="mono">{{ row.gde_sub_id || '—' }}</span></template></el-table-column>
      <el-table-column label="订阅的 recipe" min-width="200">
        <template #default="{ row }">
          <el-tag v-for="r in row.recipes" :key="r" size="small" type="info" style="margin: 1px 4px 1px 0">{{ r }}</el-tag>
          <span v-if="!row.recipes.length" class="muted">（空，待取消订阅）</span>
        </template>
      </el-table-column>
      <el-table-column label="算子数" prop="operator_count" width="80" align="center" />
      <el-table-column label="同步" width="150">
        <template #default="{ row }">
          <el-tag v-if="row.synced" type="success" size="small">已同步</el-tag>
          <el-tooltip v-else :content="row.last_error || '等待后台同步'">
            <el-tag type="danger" size="small">未同步{{ row.last_error ? '（有错误）' : '' }}</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="已处理到" width="150"><template #default="{ row }">{{ fmtTime(row.progress) }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><StatusTag kind="sub" :status="row.status" /></template></el-table-column>
      <el-table-column label="操作" width="190">
        <template #default="{ row }">
          <el-button v-if="row.status === 'running'" link type="warning" :disabled="!row.gde_sub_id" @click="pause(row)">暂停</el-button>
          <el-button v-else-if="row.status === 'paused'" link type="success" @click="resume(row)">恢复</el-button>
          <el-button link type="primary" :disabled="!row.operator_count" @click="openBatch(row, 'fill')">补算</el-button>
          <el-button link type="danger" :disabled="!row.operator_count" @click="openBatch(row, 'overwrite')">重算</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="toolbar" style="margin-top: 22px">
      <b>计算批次</b>
      <span class="muted" style="font-size: 12px">实时计算按腔室、整点归为一个批次；补算只算缺的值，重算覆盖已有值</span>
      <span class="spacer" />
      <el-select v-model="bf.chamber" placeholder="腔室" clearable filterable allow-create style="width: 120px" @change="searchBatches">
        <el-option v-for="c in chambers" :key="c" :label="c" :value="c" />
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
      <el-table-column label="腔室" prop="chamber" width="100" />
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
    <el-dialog v-model="dlg.open" :title="`${dlg.mode === 'fill' ? '补算' : '重算'} · ${dlg.chamber}`" width="600px">
      <el-alert v-if="dlg.mode === 'overwrite'" type="warning" :closable="false" show-icon style="margin-bottom: 10px"
        title="重算会覆盖范围内已有的值，旧批次标记为已被覆盖" />
      <el-form label-width="80px" v-loading="dlg.loading">
        <el-form-item label="算子">
          <el-checkbox-group v-model="dlg.checked" style="display: flex; flex-direction: column">
            <el-checkbox v-for="o in dlg.ops" :key="o.ref" :value="o.ref">
              <span class="mono">{{ o.ref }}</span> <span class="muted" style="font-size: 12px">{{ o.recipes.join('、') }}</span>
            </el-checkbox>
          </el-checkbox-group>
          <div v-if="!dlg.loading && !dlg.ops.length" class="muted">该腔室没有生效绑定</div>
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
          <el-descriptions-item label="腔室">{{ detail.b.chamber }}</el-descriptions-item>
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
        <div v-if="detail.b.plan" style="margin-top: 12px">
          <div class="section-title">计算计划（创建时快照）</div>
          <el-table :data="Object.entries(detail.b.plan).map(([recipe, ops]) => ({ recipe, ops }))" size="small" border>
            <el-table-column label="recipe" prop="recipe" width="120" />
            <el-table-column label="算子"><template #default="{ row }"><div v-for="o in row.ops" :key="o" class="mono" style="font-size: 12px">{{ o }}</div></template></el-table-column>
          </el-table>
        </div>
      </template>
    </el-drawer>
  </div>
</template>
