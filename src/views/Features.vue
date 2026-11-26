<script setup>
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { features, operators } from '../api'
import { DEV_USER_SWITCH, devUser } from '../api/http'
import { fmtTime } from '../util'
import StatusTag from '../components/StatusTag.vue'
import FeatureForm from '../components/FeatureForm.vue'
import OperatorForm from '../components/OperatorForm.vue'
import ReviewDialog from '../components/ReviewDialog.vue'
import OperatorDrawer from '../components/OperatorDrawer.vue'
import MetaDialog from '../components/MetaDialog.vue'
import { Edit, InfoFilled } from '@element-plus/icons-vue'

const me = DEV_USER_SWITCH ? devUser.name : null
const mine = (row) => !me || row.created_by === me
const others = (row) => !me || row.created_by !== me

const filter = reactive({ status: '', tool: '', q: '' })
// 机台不手填：特征下算子生效绑定的 recipe，经 GDE 反查到的机台
const tools = ref([])
async function loadTools() {
  tools.value = await features.tools()
}
const pager = reactive({ page: 1, page_size: 20, total: 0 })
const rows = ref([])
const opsByFeature = ref({}) // feature_id -> [Operator]
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    const r = await features.list({ ...filter, page: pager.page, page_size: pager.page_size })
    rows.value = r.items
    pager.total = r.total
    const ids = [...new Set(r.items.map((f) => f.feature_id))]
    const lists = await Promise.all(ids.map((id) => operators.list({ feature_id: id, page_size: 200 })))
    opsByFeature.value = Object.fromEntries(ids.map((id, i) => [id, lists[i].items]))
  } finally {
    loading.value = false
  }
}
onMounted(() => {
  load()
  loadTools()
})
function search() {
  pager.page = 1
  load()
}

// 一个特征下的算子数：按名称计（取各名称的最新非下线版本是否存在）
const opNames = (fid) => new Set((opsByFeature.value[fid] || []).map((o) => o.name)).size
const publishedOps = (fid) => (opsByFeature.value[fid] || []).filter((o) => o.status === 'published').length
const allRetired = (fid) => rows.value.filter((f) => f.feature_id === fid).every((f) => f.status === 'retired')
const reviewer = (row) => row.published_by || [...(row.review_log || [])].reverse()[0]?.reviewer || '—'

// ---- 对话框
const featureForm = reactive({ open: false, base: null })
const opForm = reactive({ open: false, featureId: '', base: null })
const review = reactive({ open: false, kind: 'feature', target: null })
const drawer = reactive({ open: false, target: null })
const metaDlg = reactive({ open: false, kind: 'feature', target: null })
function editMeta(kind, target) {
  Object.assign(metaDlg, { kind, target, open: true })
}
function onMetaSaved() {
  load()
}

function newFeature(base = null) {
  featureForm.base = base
  featureForm.open = true
}
async function newOperator(featureId, baseOp = null) {
  opForm.featureId = featureId
  opForm.base = baseOp ? await operators.detail(baseOp.feature_id, baseOp.name, baseOp.version) : null
  opForm.open = true
}
function openReview(kind, target) {
  Object.assign(review, { kind, target, open: true })
}
function openDrawer(op) {
  Object.assign(drawer, { target: op, open: true })
}

// ---- 特征操作
async function submitFeature(f) {
  await features.submit(f.feature_id, f.version)
  ElMessage.success('已提交评审')
  load()
}
async function deleteFeature(f) {
  await ElMessageBox.confirm(`删除草稿 ${f.feature_id}@${f.version}？`, '确认', { type: 'warning' })
  await features.remove(f.feature_id, f.version)
  ElMessage.success('已删除')
  load()
}
async function retireFeature(f) {
  const { value } = await ElMessageBox.prompt(
    `整个特征下线：${f.feature_id} 下已发布的 ${publishedOps(f.feature_id)} 个算子一起下线并移出绑定，历史值保留。`,
    `下线特征 ${f.feature_id}@${f.version}`,
    { inputPlaceholder: '下线原因（必填）', inputValidator: (v) => !!v?.trim() || '请填写原因', type: 'warning', confirmButtonText: '下线' },
  )
  const r = await features.retire(f.feature_id, f.version, value.trim())
  const recipes = [...new Set(r.affected.flatMap((a) => a.recipes))]
  ElMessageBox.alert(
    `一并下线的算子：${r.operators.join('，') || '无'}\n不再计算的 recipe：${recipes.join('，') || '无'}`,
    '已下线',
    { type: 'success' },
  )
  load()
}

// ---- 算子操作
async function submitOp(o) {
  await operators.submit(o.feature_id, o.name, o.version)
  ElMessage.success('已提交评审')
  load()
}
async function deleteOp(o) {
  await ElMessageBox.confirm(`删除草稿 ${o.ref}？代码文件一并删除。`, '确认', { type: 'warning' })
  await operators.remove(o.feature_id, o.name, o.version)
  ElMessage.success('已删除')
  load()
}
async function retireOp(o) {
  const { value } = await ElMessageBox.prompt(`算子 ${o.ref} 下线后从绑定中移除，历史值保留。`, '下线算子', {
    inputPlaceholder: '下线原因（必填）',
    inputValidator: (v) => !!v?.trim() || '请填写原因',
    type: 'warning',
    confirmButtonText: '下线',
  })
  const r = await operators.retire(o.feature_id, o.name, o.version, value.trim())
  const recipes = r.affected.flatMap((a) => a.recipes)
  ElMessage.success(recipes.length ? `已下线；不再计算的 recipe：${recipes.join('，')}` : '已下线')
  load()
}
</script>

<template>
  <div class="page">
    <div class="toolbar">
      <span class="muted" style="font-size: 13px">草稿 → 待评审 → 已发布 → 已下线</span>
      <span class="spacer" />
      <el-select v-model="filter.tool" placeholder="全部机台" clearable filterable style="width: 140px" @change="search">
        <el-option v-for="t in tools" :key="t" :label="t" :value="t" />
      </el-select>
      <el-select v-model="filter.status" placeholder="全部状态" clearable style="width: 120px" @change="search">
        <el-option label="草稿" value="draft" />
        <el-option label="待评审" value="review" />
        <el-option label="已发布" value="published" />
        <el-option label="已下线" value="retired" />
      </el-select>
      <el-input v-model="filter.q" placeholder="特征 ID、名称或说明" clearable style="width: 220px" @keyup.enter="search" @clear="search" />
      <el-button @click="search">查询</el-button>
      <el-button type="primary" @click="newFeature()">新增特征</el-button>
    </div>

    <el-table v-loading="loading" :data="rows" border style="width: 100%" :row-key="(r) => r.feature_id + '@' + r.version">
      <el-table-column type="expand">
        <template #default="{ row }">
          <div style="padding: 4px 16px 10px 48px">
            <div class="toolbar" style="margin-bottom: 6px">
              <b>{{ row.feature_id }} 的算子</b>
              <span class="muted" style="font-size: 12px">算子挂在特征下，与特征版本无关；同名算子再次提交自动升版本</span>
              <span class="spacer" />
              <el-button size="small" type="primary" plain :disabled="allRetired(row.feature_id)" @click="newOperator(row.feature_id)">新增算子</el-button>
            </div>
            <el-table :data="opsByFeature[row.feature_id] || []" size="small" border empty-text="还没有算子">
              <el-table-column label="算子" min-width="180">
                <template #default="{ row: o }">
                  <el-link type="primary" @click="openDrawer(o)">{{ o.display_name || o.name }}</el-link>
                  <span v-if="o.display_name" class="muted mono" style="font-size: 12px; margin-left: 4px">{{ o.name }}</span>
                  <el-button link size="small" style="margin-left: 4px" title="修改名称" @click="editMeta('operator', o)"><el-icon><Edit /></el-icon></el-button>
                </template>
              </el-table-column>
              <el-table-column label="版本" width="70"><template #default="{ row: o }">v{{ o.version }}</template></el-table-column>
              <el-table-column label="说明" prop="description" min-width="220" show-overflow-tooltip />
              <el-table-column label="文件" min-width="150"><template #default="{ row: o }"><span class="mono">{{ o.code_file }}</span></template></el-table-column>
              <el-table-column label="状态" width="90"><template #default="{ row: o }"><StatusTag :status="o.status" /></template></el-table-column>
              <el-table-column label="提交人" prop="created_by" width="90" />
              <el-table-column label="操作" width="290">
                <template #default="{ row: o }">
                  <el-button v-if="o.status === 'draft' && mine(o)" link type="primary" @click="submitOp(o)">提交评审</el-button>
                  <el-button v-if="o.status === 'review' && others(o)" link type="warning" @click="openReview('operator', o)">评审</el-button>
                  <el-button v-if="o.status !== 'retired'" link type="primary" @click="openDrawer(o)">试跑</el-button>
                  <el-button link type="primary" @click="newOperator(o.feature_id, o)">新版本</el-button>
                  <el-button v-if="o.status === 'published'" link type="danger" @click="retireOp(o)">下线</el-button>
                  <el-button v-if="o.status === 'draft' && mine(o)" link type="danger" @click="deleteOp(o)">删除</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="特征" min-width="200">
        <template #default="{ row }">
          <b>{{ row.display_name || row.feature_id }}</b>
          <el-button link size="small" style="margin-left: 4px" title="修改名称" @click="editMeta('feature', row)"><el-icon><Edit /></el-icon></el-button>
          <div v-if="row.display_name" class="muted mono" style="font-size: 12px">{{ row.feature_id }}</div>
        </template>
      </el-table-column>
      <el-table-column label="计算的机台" min-width="190">
        <template #header>
          计算的机台
          <el-tooltip content="由该特征各算子生效绑定的 recipe 经 GDE 反查得出，不用手填"><el-icon style="vertical-align: -2px; color: #a8abb2"><InfoFilled /></el-icon></el-tooltip>
        </template>
        <template #default="{ row }">
          <span v-if="row.tools?.length" class="tool-tags">
            <el-tag v-for="t in row.tools" :key="t" size="small" effect="plain" round :type="t === filter.tool ? 'primary' : 'info'" style="cursor: pointer" @click="filter.tool = t; search()">{{ t }}</el-tag>
          </span>
          <span v-else class="muted" style="font-size: 12px">未绑定</span>
        </template>
      </el-table-column>
      <el-table-column label="版本" prop="version" width="80" />
      <el-table-column label="说明" min-width="220" show-overflow-tooltip>
        <template #default="{ row }">{{ row.description }}<span v-if="row.unit" class="muted">（{{ row.unit }}）</span></template>
      </el-table-column>
      <el-table-column label="算子数" width="80" align="center">
        <template #default="{ row }">
          <el-tooltip :content="`已发布 ${publishedOps(row.feature_id)} 个版本`"><span>{{ opNames(row.feature_id) }}</span></el-tooltip>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="90">
        <template #default="{ row }">
          <el-tooltip v-if="row.retire_reason" :content="row.retire_reason"><StatusTag :status="row.status" /></el-tooltip>
          <StatusTag v-else :status="row.status" />
        </template>
      </el-table-column>
      <el-table-column label="提交人" prop="created_by" width="90" />
      <el-table-column label="评审人" width="90"><template #default="{ row }">{{ reviewer(row) }}</template></el-table-column>
      <el-table-column label="更新" width="140"><template #default="{ row }">{{ fmtTime(row.published_at || row.submitted_at || row.created_at) }}</template></el-table-column>
      <el-table-column label="操作" width="240">
        <template #default="{ row }">
          <el-button v-if="row.status === 'draft' && mine(row)" link type="primary" @click="submitFeature(row)">提交评审</el-button>
          <el-button v-if="row.status === 'review' && others(row)" link type="warning" @click="openReview('feature', row)">评审</el-button>
          <el-button v-if="row.status === 'published'" link type="primary" @click="newOperator(row.feature_id)">新增算子</el-button>
          <el-button link type="primary" @click="newFeature(row)">新版本</el-button>
          <el-button v-if="row.status === 'published'" link type="danger" @click="retireFeature(row)">下线</el-button>
          <el-button v-if="row.status === 'draft' && mine(row)" link type="danger" @click="deleteFeature(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-pagination v-if="pager.total > pager.page_size" v-model:current-page="pager.page" :page-size="pager.page_size" :total="pager.total"
      layout="total, prev, pager, next" style="margin-top: 12px; justify-content: flex-end" @current-change="load" />

    <FeatureForm v-model="featureForm.open" :base="featureForm.base" @created="onMetaSaved" />
    <MetaDialog v-model="metaDlg.open" :kind="metaDlg.kind" :target="metaDlg.target" @saved="onMetaSaved" />
    <OperatorForm v-model="opForm.open" :feature-id="opForm.featureId" :existing="opsByFeature[opForm.featureId] || []" :base="opForm.base" @created="load" />
    <ReviewDialog v-model="review.open" :kind="review.kind" :target="review.target" @done="load" />
    <OperatorDrawer v-model="drawer.open" :target="drawer.target" />
  </div>
</template>
