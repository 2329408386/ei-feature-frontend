<script setup>
// 算子绑定：左侧算子列表 + 右侧四步编辑（fleet → recipe → 反查机台 / 腔室 → 版本、JSON、修订）
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { bindings, features, gde, operators } from '../api'
import { DEV_USER_SWITCH, devUser } from '../api/http'
import { daysAgo, fmtTime, normalizeSpec, today } from '../util'
import StatusTag from '../components/StatusTag.vue'
import ErrorList from '../components/ErrorList.vue'
import JsonDiff from '../components/JsonDiff.vue'
import ImportDialog from '../components/ImportDialog.vue'

const me = DEV_USER_SWITCH ? devUser.name : null
const key = (c) => `${c.tool}|${c.chamber}`
const unkey = (k) => {
  const [tool, chamber] = k.split('|')
  return { tool, chamber }
}
function groupByTool(list) {
  const g = {}
  for (const c of list) (g[c.tool] ||= []).push(c)
  return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
}

// ======================================================== 左侧：算子列表
const filter = reactive({ feature_id: '', operator: '', tool: '', chamber: '', recipe: '', status: '' })
const featureIds = ref([])
const items = ref([]) // [{feature_id, operator, active, pending}]
const listLoading = ref(false)
const selected = ref(null) // {feature_id, operator}

const bindingFilterOn = computed(() => !!(filter.tool || filter.chamber || filter.recipe || filter.status))

async function loadList() {
  listLoading.value = true
  try {
    const params = { ...filter }
    const [b, pub] = await Promise.all([
      bindings.list(params),
      // 没有绑定过的已发布算子也要能选；按机台 / 腔室 / recipe / 状态筛选时只看绑定结果
      bindingFilterOn.value ? null : operators.list({ status: 'published', feature_id: filter.feature_id || undefined, page_size: 200 }),
    ])
    const map = new Map()
    for (const it of b.items) map.set(`${it.feature_id}/${it.operator}`, it)
    if (pub) {
      for (const o of pub.items) {
        if (filter.operator && !o.name.includes(filter.operator)) continue
        const k = `${o.feature_id}/${o.name}`
        if (!map.has(k)) map.set(k, { feature_id: o.feature_id, operator: o.name, active: null, pending: null })
      }
    }
    items.value = [...map.values()].sort((a, b) => `${a.feature_id}/${a.operator}`.localeCompare(`${b.feature_id}/${b.operator}`))
    if (selected.value) {
      const cur = items.value.find((i) => i.feature_id === selected.value.feature_id && i.operator === selected.value.operator)
      if (cur) selected.value = cur
    }
  } finally {
    listLoading.value = false
  }
}
onMounted(async () => {
  loadList()
  const r = await features.list({ page_size: 200 })
  featureIds.value = [...new Set(r.items.map((f) => f.feature_id))].sort()
})
const grouped = computed(() => {
  const g = {}
  for (const it of items.value) (g[it.feature_id] ||= []).push(it)
  return Object.entries(g)
})
function recipeCount(it) {
  return it.active?.spec.recipes.length || 0
}
function chamberCount(it) {
  return new Set((it.active?.spec.recipes || []).flatMap((r) => r.chambers.map(key))).size
}

// ======================================================== 右侧：编辑状态
const revisions = ref([])
const versions = ref([]) // 该算子已发布的版本（降序）
const base = ref(null) // 编辑的基准修订（生效中的）
const ed = reactive({
  version: null,
  fleet: '',
  range: [daysAgo(30), today()],
  fleetChambers: [],
  fleetChecked: [],
  fleetLoading: false,
  recipes: [], // [{recipe, candidates: [], checked: [], loading, error, showOut}]
})
const fleets = ref([])
const errors = ref([])
const submitting = ref(false)

async function select(it) {
  selected.value = it
  errors.value = []
  const [revs, pub] = await Promise.all([
    bindings.revisions(it.feature_id, it.operator),
    operators.list({ feature_id: it.feature_id, name: it.operator, status: 'published', page_size: 200 }),
  ])
  revisions.value = revs.revisions
  versions.value = pub.items.map((o) => o.version).sort((a, b) => b - a)
  base.value = it.active
  await loadSpec(it.active?.spec)
}

/** 把一个绑定 spec 载入编辑器；没有则清空（版本默认最新已发布） */
async function loadSpec(spec) {
  errors.value = []
  ed.version = versions.value.includes(spec?.version) ? spec.version : versions.value[0] ?? spec?.version ?? null
  ed.fleet = spec?.fleet?.name || ''
  ed.range = spec?.fleet ? [spec.fleet.start, spec.fleet.end] : [daysAgo(30), today()]
  ed.fleetChambers = []
  ed.fleetChecked = []
  ed.recipes = (spec?.recipes || []).map((r) => ({
    recipe: r.recipe,
    candidates: [],
    checked: r.chambers.map(key),
    loading: true,
    error: '',
    showOut: false,
  }))
  const tasks = ed.recipes.map((r) => loadCandidates(r, false))
  if (ed.fleet) {
    tasks.push(loadFleetChambers(false))
  }
  await Promise.all(tasks)
  if (ed.fleet) {
    // 回显：fleet 下腔室默认全部勾选；但已绑定、却不在 fleet 中的腔室保持原样
    ed.fleetChecked = ed.fleetChambers.map(key)
  }
  fleetSnap = [...ed.fleetChecked]
}

// ---- ① fleet + 时间范围
async function loadFleets() {
  if (!fleets.value.length) fleets.value = await gde.fleets()
}
onMounted(loadFleets)
async function loadFleetChambers(applyDefault = true) {
  if (!ed.fleet) {
    ed.fleetChambers = []
    ed.fleetChecked = []
    fleetSnap = []
    return
  }
  ed.fleetLoading = true
  try {
    const [start, end] = ed.range || []
    ed.fleetChambers = await gde.fleetChambers(ed.fleet, start, end)
    if (applyDefault) {
      ed.fleetChecked = ed.fleetChambers.map(key) // 默认全部勾选
      // 已选 recipe 中 fleet 范围内的腔室勾上，范围外的取消
      for (const r of ed.recipes) r.checked = r.candidates.map(key).filter((k) => ed.fleetChecked.includes(k))
    }
    fleetSnap = [...ed.fleetChecked]
  } finally {
    ed.fleetLoading = false
  }
}
const fleetSet = computed(() => new Set(ed.fleetChecked))
const hasFleet = computed(() => !!ed.fleet && ed.fleetChambers.length > 0)
// 第 ① 步由用户勾选变化时同步到各 recipe：取消的腔室在 recipe 里也取消，重新勾上的在跑过的 recipe 里勾上
// （程序回显时不走这里，所以载入已有修订不会改动它的腔室）
let fleetSnap = []
function onFleetChange() {
  const now = ed.fleetChecked
  const added = now.filter((k) => !fleetSnap.includes(k))
  const removed = fleetSnap.filter((k) => !now.includes(k))
  for (const r of ed.recipes) {
    const cand = new Set(r.candidates.map(key))
    r.checked = r.checked.filter((k) => !removed.includes(k))
    for (const k of added) if (cand.has(k) && !r.checked.includes(k)) r.checked.push(k)
  }
  fleetSnap = [...now]
}
/** 机台一级复选框的勾选 / 半选状态 */
function toolState(checked, list) {
  const n = list.filter((c) => checked.includes(key(c))).length
  return { modelValue: n > 0 && n === list.length, indeterminate: n > 0 && n < list.length }
}
function toggleIn(obj, field, k, on) {
  obj[field] = on ? [...new Set([...obj[field], k])] : obj[field].filter((x) => x !== k)
}
function toggleFleet(k, on) {
  toggleIn(ed, 'fleetChecked', k, on)
  onFleetChange()
}
function toggleTool(tool, on) {
  const ks = ed.fleetChambers.filter((c) => c.tool === tool).map(key)
  ed.fleetChecked = on ? [...new Set([...ed.fleetChecked, ...ks])] : ed.fleetChecked.filter((k) => !ks.includes(k))
  onFleetChange()
}

// ---- ② recipe 模糊选择（防抖 300 ms）
const recipeOptions = ref([])
const recipeLoading = ref(false)
const recipePick = ref('')
let timer = null
function searchRecipes(q) {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    recipeLoading.value = true
    try {
      recipeOptions.value = await gde.recipes(q || undefined)
    } finally {
      recipeLoading.value = false
    }
  }, 300)
}
async function addRecipe(name) {
  recipePick.value = ''
  if (!name || ed.recipes.some((r) => r.recipe === name)) return
  const r = reactive({ recipe: name, candidates: [], checked: [], loading: true, error: '', showOut: false })
  ed.recipes.push(r)
  await loadCandidates(r, true)
}
function removeRecipe(i) {
  ed.recipes.splice(i, 1)
  errors.value = []
}

// ---- ③ 反查机台 / 腔室
async function loadCandidates(r, applyDefault) {
  r.loading = true
  r.error = ''
  try {
    r.candidates = await gde.recipeChambers(r.recipe)
    if (applyDefault) {
      // 默认勾选 fleet 范围内的；没选 fleet 时全部勾选
      r.checked = r.candidates.map(key).filter((k) => !hasFleet.value || fleetSet.value.has(k))
    }
  } catch (e) {
    r.error = `${e.code}：${e.message}`
  } finally {
    r.loading = false
  }
}
const inScope = (r) => r.candidates.filter((c) => !hasFleet.value || fleetSet.value.has(key(c)))
const outScope = (r) => (hasFleet.value ? r.candidates.filter((c) => !fleetSet.value.has(key(c))) : [])
function setRecipeTool(r, tool, list, on) {
  const ks = list.filter((c) => c.tool === tool).map(key)
  r.checked = on ? [...new Set([...r.checked, ...ks])] : r.checked.filter((k) => !ks.includes(k))
}
function recipeErrors(i) {
  return errors.value.filter((e) => e.path && (e.path === `recipes[${i}]` || e.path.startsWith(`recipes[${i}].`) || e.path.startsWith(`recipes[${i}]`)))
}
const otherErrors = computed(() => errors.value.filter((e) => !e.path || !e.path.startsWith('recipes[')))

// ---- ④ 生成的绑定 JSON
const generated = computed(() => {
  if (!selected.value) return null
  const spec = {
    feature_id: selected.value.feature_id,
    operator: selected.value.operator,
    version: ed.version,
  }
  if (ed.fleet && ed.range?.length === 2) spec.fleet = { name: ed.fleet, start: ed.range[0], end: ed.range[1] }
  spec.recipes = ed.recipes.map((r) => ({ recipe: r.recipe, chambers: r.checked.map(unkey) }))
  return spec
})
const baseSpec = computed(() => base.value?.spec || null)
function sameSpec(a, b) {
  if (!a || !b) return false
  return JSON.stringify(normalizeSpec(a)) === JSON.stringify(normalizeSpec(b)) && JSON.stringify(a.fleet || null) === JSON.stringify(b.fleet || null)
}
const dirty = computed(() => {
  if (!generated.value) return false
  if (!baseSpec.value) return ed.recipes.length > 0
  return !sameSpec(generated.value, baseSpec.value)
})
const pending = computed(() => selected.value?.pending || null)
const canSubmit = computed(() => dirty.value && !pending.value && ed.version != null && ed.recipes.length > 0)

async function submit() {
  errors.value = []
  submitting.value = true
  try {
    const it = selected.value
    const rev = await bindings.submit(it.feature_id, it.operator, { ...generated.value, base_revision: base.value?.revision ?? null }, { silent: true })
    ElMessage.success(`已提交修订 #${rev.revision}，等待审核`)
    await refreshSelected()
  } catch (e) {
    errors.value = e.errors.length ? e.errors : [{ message: `${e.code}：${e.message}` }]
    if (!e.errors.length) ElMessage.error(`${e.code}：${e.message}`)
  } finally {
    submitting.value = false
  }
}
async function revert() {
  await loadSpec(baseSpec.value)
}
async function refreshSelected() {
  await loadList()
  const it = items.value.find((i) => i.feature_id === selected.value.feature_id && i.operator === selected.value.operator)
  if (it) await select(it)
}

// ---- 待审核修订
async function reviewPending(decision) {
  const it = selected.value
  let comment = null
  if (decision === 'reject') {
    const { value } = await ElMessageBox.prompt('退回意见', `退回修订 #${pending.value.revision}`, {
      inputValidator: (v) => !!v?.trim() || '请填写意见',
    })
    comment = value.trim()
  }
  await bindings.review(it.feature_id, it.operator, pending.value.revision, { decision, comment })
  ElMessage.success(decision === 'approve' ? '已生效，正在同步腔室订阅' : '已退回')
  await refreshSelected()
}
async function withdrawPending() {
  const it = selected.value
  await bindings.withdraw(it.feature_id, it.operator, pending.value.revision)
  ElMessage.success('已撤回')
  await refreshSelected()
}

// ---- 修订对比
const diff = reactive({ open: false, left: null, right: null, leftTitle: '', rightTitle: '' })
function compare(rev) {
  const idx = revisions.value.findIndex((r) => r.revision === rev.revision)
  const prev = revisions.value.slice(idx + 1).find((r) => r.status === 'active' || r.status === 'superseded') || null
  Object.assign(diff, {
    open: true,
    left: prev?.spec || null,
    right: rev.spec,
    leftTitle: prev ? `#${prev.revision}` : '（无）',
    rightTitle: `#${rev.revision}`,
  })
}
function comparePendingWithActive() {
  Object.assign(diff, {
    open: true,
    left: base.value?.spec || null,
    right: pending.value.spec,
    leftTitle: base.value ? `生效 #${base.value.revision}` : '（无生效修订）',
    rightTitle: `待审核 #${pending.value.revision}`,
  })
}
function compareEditing() {
  Object.assign(diff, {
    open: true,
    left: baseSpec.value,
    right: generated.value,
    leftTitle: base.value ? `生效 #${base.value.revision}` : '（无生效修订）',
    rightTitle: '当前编辑',
  })
}
const SOURCE = { console: '控制台', api: 'API', import: '导入', system: '系统' }

// ---- 导入 / 导出
const importOpen = ref(false)
async function doExport() {
  const resp = await bindings.exportFile({ ...filter })
  const blob = await resp.blob()
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'ei-feature-service-bindings.json'
  a.click()
  URL.revokeObjectURL(a.href)
}
</script>

<template>
  <div class="page bindings">
    <div class="toolbar">
      <span class="muted" style="font-size: 13px">fleet、腔室、recipe 经 /api/gde 从 GDE 获取；recipe 绑到算子上，审核通过后同步 GDE 订阅</span>
      <span class="spacer" />
      <el-button @click="importOpen = true">导入</el-button>
      <el-button @click="doExport">导出</el-button>
    </div>
    <div class="split">
      <!-- 左侧 -->
      <div class="left card">
        <div class="filters">
          <el-select v-model="filter.feature_id" placeholder="特征" clearable filterable size="small" @change="loadList">
            <el-option v-for="f in featureIds" :key="f" :label="f" :value="f" />
          </el-select>
          <el-input v-model="filter.operator" placeholder="算子" clearable size="small" @change="loadList" />
          <el-input v-model="filter.tool" placeholder="机台" clearable size="small" @change="loadList" />
          <el-input v-model="filter.chamber" placeholder="腔室" clearable size="small" @change="loadList" />
          <el-input v-model="filter.recipe" placeholder="recipe" clearable size="small" @change="loadList" />
          <el-select v-model="filter.status" placeholder="状态" clearable size="small" @change="loadList">
            <el-option label="生效中" value="active" />
            <el-option label="有待审核" value="pending" />
          </el-select>
        </div>
        <div v-loading="listLoading" class="op-list">
          <div v-if="!items.length" class="muted" style="padding: 20px; text-align: center; font-size: 13px">没有匹配的算子</div>
          <template v-for="[fid, list] in grouped" :key="fid">
            <div class="group">{{ fid }}</div>
            <div v-for="it in list" :key="it.operator" class="op-item" :class="{ on: selected && selected.feature_id === it.feature_id && selected.operator === it.operator }" @click="select(it)">
              <div style="display: flex; align-items: center; gap: 6px">
                <b>{{ it.operator }}</b>
                <span v-if="it.active" class="muted" style="font-size: 12px">v{{ it.active.version }} · #{{ it.active.revision }}</span>
                <span class="spacer" style="flex: 1" />
                <el-tag v-if="it.pending" type="warning" size="small">待审核</el-tag>
                <el-tag v-else-if="it.active && it.active.spec.recipes.length" type="success" size="small">生效中</el-tag>
                <el-tag v-else type="info" size="small">未绑定</el-tag>
              </div>
              <div v-if="it.active && recipeCount(it)" class="muted" style="font-size: 12px; margin-top: 2px">
                {{ recipeCount(it) }} 个 recipe · {{ chamberCount(it) }} 个腔室
              </div>
            </div>
          </template>
        </div>
      </div>

      <!-- 右侧 -->
      <div class="right">
        <div v-if="!selected" class="card muted" style="padding: 60px; text-align: center">从左侧选择一个算子，编辑它的绑定</div>
        <template v-else>
          <div class="card head">
            <div style="display: flex; align-items: center; gap: 10px">
              <b style="font-size: 16px" class="mono">{{ selected.feature_id }}/{{ selected.operator }}</b>
              <span v-if="base" class="muted" style="font-size: 13px">生效修订 #{{ base.revision }}（v{{ base.version }}，{{ base.reviewed_by }} 于 {{ fmtTime(base.reviewed_at) }} 审核）</span>
              <span v-else class="muted" style="font-size: 13px">尚无生效绑定</span>
            </div>
            <el-alert v-if="pending" type="warning" :closable="false" style="margin-top: 10px">
              <template #title>
                待审核修订 #{{ pending.revision }}（v{{ pending.version }}，{{ pending.created_by }} 于 {{ fmtTime(pending.created_at) }} 提交）
              </template>
              <div style="display: flex; gap: 8px; margin-top: 6px">
                <el-button size="small" @click="comparePendingWithActive">与生效修订对比</el-button>
                <template v-if="!me || pending.created_by !== me">
                  <el-button size="small" type="success" @click="reviewPending('approve')">通过</el-button>
                  <el-button size="small" type="danger" plain @click="reviewPending('reject')">退回</el-button>
                </template>
                <el-button v-if="!me || pending.created_by === me" size="small" @click="withdrawPending">撤回</el-button>
                <span v-if="me && pending.created_by === me" class="muted" style="font-size: 12px; align-self: center">审核人需是其他人（右上角切换用户）</span>
              </div>
            </el-alert>
          </div>

          <!-- ① -->
          <div class="card step">
            <div class="step-title"><span class="no">1</span>选 fleet 和时间范围 <span class="muted">只用于选腔室和回显，不参与计算</span></div>
            <div style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap">
              <el-select v-model="ed.fleet" placeholder="选择 fleet" clearable style="width: 200px" @change="loadFleetChambers()">
                <el-option v-for="f in fleets" :key="f" :label="f" :value="f" />
              </el-select>
              <el-date-picker v-model="ed.range" type="daterange" value-format="YYYY-MM-DD" start-placeholder="开始" end-placeholder="结束" :clearable="false" style="width: 260px" @change="loadFleetChambers()" />
              <span v-if="ed.fleet" class="muted" style="font-size: 12px">该时间范围内有执行的腔室 {{ ed.fleetChambers.length }} 个，已勾选 {{ ed.fleetChecked.length }} 个</span>
            </div>
            <div v-loading="ed.fleetLoading" style="margin-top: 8px">
              <div v-for="[tool, list] in groupByTool(ed.fleetChambers)" :key="tool" class="tool-row">
                <el-checkbox v-bind="toolState(ed.fleetChecked, list)" @change="(v) => toggleTool(tool, v)"><b>{{ tool }}</b></el-checkbox>
                <el-checkbox v-for="c in list" :key="key(c)" :model-value="ed.fleetChecked.includes(key(c))" @change="(v) => toggleFleet(key(c), v)">{{ c.chamber }}</el-checkbox>
              </div>
            </div>
          </div>

          <!-- ② ③ -->
          <div class="card step">
            <div class="step-title"><span class="no">2</span>选 recipe <span class="muted">输入关键字自动过滤，点击候选项加入</span></div>
            <el-select v-model="recipePick" filterable remote :remote-method="searchRecipes" :loading="recipeLoading" placeholder="搜索 recipe" style="width: 320px"
              @change="addRecipe" @focus="searchRecipes('')">
              <el-option v-for="r in recipeOptions" :key="r" :label="r" :value="r" :disabled="ed.recipes.some((x) => x.recipe === r)" />
            </el-select>

            <div class="step-title" style="margin-top: 14px"><span class="no">3</span>勾选机台 / 腔室 <span class="muted">按 recipe 反查跑过它的机台和腔室</span></div>
            <div v-if="!ed.recipes.length" class="muted" style="font-size: 13px">还没有绑定 recipe</div>
            <div v-for="(r, i) in ed.recipes" :key="r.recipe" class="recipe-card" :class="{ bad: recipeErrors(i).length }" v-loading="r.loading">
              <div style="display: flex; align-items: center; gap: 8px">
                <b class="mono">{{ r.recipe }}</b>
                <span class="muted" style="font-size: 12px">已勾选 {{ r.checked.length }} / {{ r.candidates.length }}</span>
                <span style="flex: 1" />
                <el-button link type="danger" size="small" @click="removeRecipe(i)">移除</el-button>
              </div>
              <div v-if="r.error" class="err-list" style="list-style: none; padding: 0">{{ r.error }}</div>
              <div v-for="[tool, list] in groupByTool(inScope(r))" :key="tool" class="tool-row">
                <el-checkbox v-bind="toolState(r.checked, list)" @change="(v) => setRecipeTool(r, tool, list, v)"><b>{{ tool }}</b></el-checkbox>
                <el-checkbox v-for="c in list" :key="key(c)" :model-value="r.checked.includes(key(c))" @change="(v) => toggleIn(r, 'checked', key(c), v)">{{ c.chamber }}</el-checkbox>
              </div>
              <div v-if="!r.loading && !inScope(r).length && !r.error" class="muted" style="font-size: 12px">fleet 范围内没有跑过该 recipe 的腔室</div>
              <div v-if="outScope(r).length" style="margin-top: 4px">
                <el-button link size="small" @click="r.showOut = !r.showOut">
                  {{ r.showOut ? '收起' : '展开' }}不在 fleet 范围内的 {{ outScope(r).length }} 个腔室
                </el-button>
                <div v-show="r.showOut" class="out-scope">
                  <div v-for="[tool, list] in groupByTool(outScope(r))" :key="tool" class="tool-row">
                    <b style="font-size: 13px; margin-right: 12px">{{ tool }}</b>
                    <el-checkbox v-for="c in list" :key="key(c)" :model-value="r.checked.includes(key(c))" @change="(v) => toggleIn(r, 'checked', key(c), v)">{{ c.chamber }}</el-checkbox>
                  </div>
                </div>
              </div>
              <ErrorList :errors="recipeErrors(i)" />
            </div>
          </div>

          <!-- ④ -->
          <div class="card step">
            <div class="step-title"><span class="no">4</span>算子版本与绑定 JSON</div>
            <div style="display: flex; gap: 8px; align-items: center">
              <span>算子版本</span>
              <el-select v-model="ed.version" style="width: 140px" placeholder="无已发布版本">
                <el-option v-for="v in versions" :key="v" :label="`v${v}${v === versions[0] ? '（最新）' : ''}`" :value="v" />
              </el-select>
              <span v-if="!versions.length" class="err-list" style="list-style: none; padding: 0; margin: 0">该算子没有已发布版本，不能绑定</span>
            </div>
            <ErrorList :errors="otherErrors" />
            <div class="section-title" style="margin-top: 12px">
              自动生成的绑定 JSON <span class="muted" style="font-weight: normal; font-size: 12px">只读，提交的就是它</span>
              <el-button v-if="dirty" link type="primary" size="small" style="margin-left: 8px" @click="compareEditing">与生效修订对比</el-button>
            </div>
            <pre class="code" style="max-height: 260px">{{ JSON.stringify(generated, null, 2) }}</pre>
            <div style="display: flex; gap: 8px; margin-top: 10px; align-items: center">
              <el-button :disabled="!dirty" @click="revert">撤销修改</el-button>
              <el-button type="primary" :disabled="!canSubmit" :loading="submitting" @click="submit">提交审核</el-button>
              <span class="muted" style="font-size: 12px">
                <template v-if="pending">已有待审核修订，审核或撤回后才能再提交</template>
                <template v-else-if="!dirty">与生效修订相同</template>
                <template v-else-if="!ed.recipes.length">至少绑定 1 个 recipe</template>
              </span>
            </div>
          </div>

          <!-- 历史修订 -->
          <div class="card step">
            <div class="step-title">历史修订</div>
            <el-table :data="revisions" size="small" border empty-text="还没有修订">
              <el-table-column label="修订" width="70"><template #default="{ row }">#{{ row.revision }}</template></el-table-column>
              <el-table-column label="状态" width="90"><template #default="{ row }"><StatusTag kind="revision" :status="row.status" /></template></el-table-column>
              <el-table-column label="版本" width="60"><template #default="{ row }">v{{ row.version }}</template></el-table-column>
              <el-table-column label="内容" min-width="150">
                <template #default="{ row }">
                  <span v-if="!row.spec.recipes.length" class="muted">空（解除全部绑定）</span>
                  <span v-else>{{ row.spec.recipes.map((r) => r.recipe).join('、') }}</span>
                </template>
              </el-table-column>
              <el-table-column label="来源" width="70"><template #default="{ row }">{{ SOURCE[row.source] }}</template></el-table-column>
              <el-table-column label="提交" width="150"><template #default="{ row }">{{ row.created_by }} · {{ fmtTime(row.created_at) }}</template></el-table-column>
              <el-table-column label="审核" min-width="160">
                <template #default="{ row }">
                  <span v-if="row.reviewed_by">{{ row.reviewed_by }}<span v-if="row.review_note" class="muted">：{{ row.review_note }}</span></span>
                  <span v-else class="muted">—</span>
                </template>
              </el-table-column>
              <el-table-column label="" width="120">
                <template #default="{ row }">
                  <el-button link type="primary" size="small" @click="compare(row)">对比</el-button>
                  <el-button link type="primary" size="small" @click="loadSpec(row.spec)">载入</el-button>
                </template>
              </el-table-column>
            </el-table>
          </div>
        </template>
      </div>
    </div>

    <el-dialog v-model="diff.open" title="修订对比" width="720px">
      <JsonDiff :left="diff.left" :right="diff.right" :left-title="diff.leftTitle" :right-title="diff.rightTitle" />
    </el-dialog>
    <ImportDialog v-model="importOpen" @done="loadList" />
  </div>
</template>

<style scoped>
.split { display: flex; gap: 14px; align-items: flex-start; }
.left { width: 320px; flex-shrink: 0; padding: 10px; position: sticky; top: 0; }
.filters { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.op-list { max-height: calc(100vh - 230px); overflow: auto; min-height: 120px; }
.group { font-size: 12px; color: #909399; padding: 8px 6px 4px; font-family: Menlo, Consolas, monospace; }
.op-item { padding: 8px 10px; border-radius: 4px; cursor: pointer; border: 1px solid transparent; }
.op-item:hover { background: #f5f7fa; }
.op-item.on { background: #ecf5ff; border-color: #b3d8ff; }
.right { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.step-title { font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.step-title .muted { font-weight: normal; font-size: 12px; }
.no { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: #409eff; color: #fff; font-size: 12px; align-items: center; justify-content: center; }
.tool-row { display: flex; align-items: center; flex-wrap: wrap; padding: 2px 0; }
.tool-row :deep(.el-checkbox) { margin-right: 18px; }
.recipe-card { border: 1px solid #ebeef5; border-radius: 4px; padding: 8px 12px; margin-top: 8px; }
.recipe-card.bad { border-color: #f56c6c; }
.out-scope { background: #fafafa; border-radius: 4px; padding: 4px 8px; }
</style>
