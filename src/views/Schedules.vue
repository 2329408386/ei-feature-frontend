<script setup>
// 调度：以 recipe 为键——一个 recipe 一个 GDE 订阅，下面挂多个机台 / 腔室（GDE 反查）和多个算子；
// 计算批次表；补算 / 重算按 recipe 勾选算子（覆盖该 recipe 下全部腔室）
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { batches, schedules } from '../api'
import { BATCH_MODE, daysAgo, fmtTime, today } from '../util'
import StatusTag from '../components/StatusTag.vue'
import ErrorList from '../components/ErrorList.vue'

// ======================================================== recipe 订阅
const sf = reactive({ recipe: '', tool: '', chamber: '' })
const subs = ref([])
const subLoading = ref(false)
async function loadSubs() {
  subLoading.value = true
  try {
    subs.value = await schedules.list({ ...sf })
  } finally {
    subLoading.value = false
  }
}
async function pause(s) {
  await ElMessageBox.confirm(`暂停 recipe ${s.recipe} 的计算？会经 SDK 暂停 GDE 订阅（该 recipe 下全部腔室），恢复后继续推送。`, '暂停', { type: 'warning' })
  await schedules.pause(s.recipe)
  ElMessage.success('已暂停')
  loadSubs()
}
async function resume(s) {
  await schedules.resume(s.recipe)
  ElMessage.success('已恢复')
  loadSubs()
}
function groupByTool(list) {
  const g = {}
  for (const c of list || []) (g[c.tool] ||= []).push(c)
  return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
}
const toolCount = (row) => new Set((row.chambers || []).map((c) => c.tool)).size

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
const recipes = computed(() => subs.value.map((s) => s.recipe))

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
const dlg = reactive({ open: false, recipe: '', chambers: null, mode: 'fill', ops: [], checked: [], range: [daysAgo(7), today()], reason: '', errors: [], busy: false })
function openBatch(s, mode) {
  Object.assign(dlg, {
    open: true, recipe: s.recipe, chambers: s.chambers, mode, ops: s.operators, checked: [...s.operators],
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
      <b>recipe 订阅</b>
      <span class="muted" style="font-size: 12px">每个 recipe 一个 GDE 订阅，GDE 推送它在所有机台 / 腔室上的执行（含新腔室）；审核通过后自动同步，失败由后台每分钟重试</span>
      <span class="spacer" />
      <el-input v-model="sf.recipe" placeholder="recipe" clearable size="small" style="width: 140px" @change="loadSubs" />
      <el-input v-model="sf.tool" placeholder="机台" clearable size="small" style="width: 110px" @change="loadSubs" />
      <el-input v-model="sf.chamber" placeholder="腔室" clearable size="small" style="width: 110px" @change="loadSubs" />
      <el-button size="small" @click="loadSubs">刷新</el-button>
    </div>
    <el-table v-loading="subLoading" :data="subs" border row-key="recipe" empty-text="还没有 recipe 订阅：先在「算子绑定」页绑定并审核通过">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div class="expand">
            <div>
              <div class="section-title">机台 / 腔室 <span class="muted" style="font-weight: normal; font-size: 12px">GDE 反查跑过该 recipe 的；新腔室会自动出现</span></div>
              <div v-if="row.chambers === null" class="muted" style="font-size: 13px">GDE 暂时不可用，查不到腔室</div>
              <el-table v-else :data="row.chambers" size="small" border empty-text="GDE 没有返回腔室">
                <el-table-column label="机台" prop="tool" width="120" />
                <el-table-column label="腔室" prop="chamber" width="120" />
                <el-table-column label="已处理到"><template #default="{ row: c }">{{ fmtTime(c.progress) }}</template></el-table-column>
              </el-table>
            </div>
            <div>
              <div class="section-title">算子</div>
              <div v-for="o in row.operators" :key="o" class="mono" style="font-size: 12px; padding: 2px 0">{{ o }}</div>
              <div v-if="!row.operators.length" class="muted" style="font-size: 13px">没有生效绑定（待取消订阅）</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="recipe" min-width="140"><template #default="{ row }"><b class="mono">{{ row.recipe }}</b></template></el-table-column>
      <el-table-column label="机台 / 腔室" min-width="240">
        <template #default="{ row }">
          <template v-if="row.chambers">
            <span class="muted" style="font-size: 12px">{{ toolCount(row) }} 台 · {{ row.chambers.length }} 腔：</span>
            <span v-for="[tool, list] in groupByTool(row.chambers)" :key="tool" style="margin-right: 10px; font-size: 13px">
              {{ tool }}（{{ list.map((c) => c.chamber).join('、') }}）
            </span>
          </template>
          <span v-else class="muted">—</span>
        </template>
      </el-table-column>
      <el-table-column label="算子" min-width="260">
        <template #default="{ row }">
          <div v-for="o in row.operators.slice(0, 3)" :key="o" class="mono" style="font-size: 12px; line-height: 18px">{{ o }}</div>
          <span v-if="row.operators.length > 3" class="muted" style="font-size: 12px">… 共 {{ row.operators.length }} 个，展开查看</span>
          <span v-if="!row.operators.length" class="muted">（无，待取消订阅）</span>
        </template>
      </el-table-column>
      <el-table-column label="GDE 订阅" width="120"><template #default="{ row }"><span class="mono">{{ row.gde_sub_id || '—' }}</span></template></el-table-column>
      <el-table-column label="同步" width="130">
        <template #default="{ row }">
          <el-tag v-if="row.synced" type="success" size="small">已同步</el-tag>
          <el-tooltip v-else :content="row.last_error || '等待后台同步'">
            <el-tag type="danger" size="small">未同步{{ row.last_error ? '（有错误）' : '' }}</el-tag>
          </el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="已处理到" width="140"><template #default="{ row }">{{ fmtTime(row.progress) }}</template></el-table-column>
      <el-table-column label="状态" width="90"><template #default="{ row }"><StatusTag kind="sub" :status="row.status" /></template></el-table-column>
      <el-table-column label="操作" width="180">
        <template #default="{ row }">
          <el-button v-if="row.status === 'running'" link type="warning" :disabled="!row.gde_sub_id" @click="pause(row)">暂停</el-button>
          <el-button v-else-if="row.status === 'paused'" link type="success" @click="resume(row)">恢复</el-button>
          <el-button link type="primary" :disabled="!row.operators.length" @click="openBatch(row, 'fill')">补算</el-button>
          <el-button link type="danger" :disabled="!row.operators.length" @click="openBatch(row, 'overwrite')">重算</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="toolbar" style="margin-top: 22px">
      <b>计算批次</b>
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
.expand { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 24px; padding: 4px 16px 10px 48px; }
</style>
