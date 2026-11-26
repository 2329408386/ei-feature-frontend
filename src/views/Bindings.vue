<script setup>
// 算子绑定：左侧算子列表 + 右侧编辑（fleet + 时间 → 腔室 → recipe → 算子版本、JSON、修订）。
// fleet、腔室只用来缩小 recipe 候选；绑定里只存 recipe。选好 recipe 后不再反查 / 勾选机台腔室：
// 审核通过后按 recipe 订阅 GDE，GDE 自动推送该 recipe 在所有机台 / 腔室上的 run_id（含以后新增的腔室）。
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { bindings, features, gde, operators } from '../api'
import { DEV_USER_SWITCH, devUser } from '../api/http'
import { daysAgo, fmtTime, labelOf, normalizeSpec, today } from '../util'
import StatusTag from '../components/StatusTag.vue'
import ErrorList from '../components/ErrorList.vue'
import JsonDiff from '../components/JsonDiff.vue'
import ImportDialog from '../components/ImportDialog.vue'

const me = DEV_USER_SWITCH ? devUser.name : null
function groupByTool(list) {
  const g = {}
  for (const c of list) (g[c.tool] ||= []).push(c.chamber)
  return Object.entries(g).sort(([a], [b]) => a.localeCompare(b))
}

// ======================================================== 左侧：算子列表
const filter = reactive({ feature_id: '', operator: '', recipe: '', status: '' })
const featureList = ref([]) // [{feature_id, display_name}]
const featureNames = computed(() => Object.fromEntries(featureList.value.map((f) => [f.feature_id, f.display_name])))
const opNames = ref({}) // "fid/op" -> display_name
const items = ref([]) // [{feature_id, operator, active, pending}]
const listLoading = ref(false)
const selected = ref(null) // {feature_id, operator}

const bindingFilterOn = computed(() => !!(filter.recipe || filter.status))

async function loadList() {
  listLoading.value = true
  try {
    const params = { ...filter }
    const [b, pub] = await Promise.all([
      bindings.list(params),
      // 没有绑定过的已发布算子也要能选；按 recipe / 状态筛选时只看绑定结果
      bindingFilterOn.value ? null : operators.list({ status: 'published', feature_id: filter.feature_id || undefined, page_size: 200 }),
    ])
    const map = new Map()
    for (const it of b.items) map.set(`${it.feature_id}/${it.operator}`, it)
    if (pub) {
      for (const o of pub.items) {
        if (o.display_name) opNames.value[`${o.feature_id}/${o.name}`] = o.display_name
        if (filter.operator && !o.name.includes(filter.operator) && !(o.display_name || '').includes(filter.operator)) continue
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
  const [fs, ops] = await Promise.all([features.list({ page_size: 200 }), operators.list({ page_size: 200 })])
  const seen = new Map()
  for (const f of fs.items) if (!seen.has(f.feature_id)) seen.set(f.feature_id, f)
  featureList.value = [...seen.values()].sort((a, b) => a.feature_id.localeCompare(b.feature_id))
  for (const o of ops.items) if (o.display_name) opNames.value[`${o.feature_id}/${o.name}`] = o.display_name
})
const grouped = computed(() => {
  const g = {}
  for (const it of items.value) (g[it.feature_id] ||= []).push(it)
  return Object.entries(g)
})
const opName = (it) => opNames.value[`${it.feature_id}/${it.operator}`]
const recipeCount = (it) => it.active?.spec.recipes.length || 0

// ======================================================== 右侧：编辑状态
const revisions = ref([])
const versions = ref([]) // 该算子已发布的版本（降序）
const base = ref(null) // 编辑的基准修订（生效中的）
const ed = reactive({
  version: null,
  recipes: [], // [recipe]
})
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
  loadSpec(it.active?.spec)
}

/** 把一个绑定 spec 载入编辑器；没有则清空（版本默认最新已发布） */
function loadSpec(spec) {
  errors.value = []
  ed.version = versions.value.includes(spec?.version) ? spec.version : versions.value[0] ?? spec?.version ?? null
  ed.recipes = [...(spec?.recipes || [])]
}

// ---- ① fleet + 时间范围 → 腔室（默认全选）→ recipe 候选
const scope = reactive({
  fleets: [],
  fleet: '',
  range: [daysAgo(30), today()],
  chambers: [], // [{tool, chamber}]
  checked: [], // [chamber]
  recipes: [], // 勾选腔室在时间范围内跑过的 recipe（并集）
  loading: '',
  error: '',
})
const recipeCache = new Map() // `${chamber}|${start}|${end}` -> [recipe]
onMounted(async () => (scope.fleets = await gde.fleets()))
async function onFleet() {
  Object.assign(scope, { chambers: [], checked: [], recipes: [], error: '' })
  if (!scope.fleet) return
  scope.loading = 'chamber'
  try {
    scope.chambers = await gde.fleetChambers(scope.fleet, scope.range[0], scope.range[1])
    scope.checked = scope.chambers.map((c) => c.chamber)
  } catch (e) {
    scope.error = `${e.code}：${e.message}`
  } finally {
    scope.loading = ''
  }
}
function toggleChamber(c) {
  const i = scope.checked.indexOf(c)
  if (i >= 0) scope.checked.splice(i, 1)
  else scope.checked.push(c)
}
function toggleTool(list) {
  const all = list.every((c) => scope.checked.includes(c))
  scope.checked = all ? scope.checked.filter((c) => !list.includes(c)) : [...new Set([...scope.checked, ...list])]
}
let seq = 0
watch(
  () => [scope.checked.slice(), scope.range?.[0], scope.range?.[1]],
  async () => {
    const my = ++seq
    if (!scope.checked.length) return (scope.recipes = [])
    scope.loading = 'recipe'
    try {
      const [start, end] = scope.range
      const lists = await Promise.all(scope.checked.map(async (c) => {
        const k = `${c}|${start}|${end}`
        if (!recipeCache.has(k)) recipeCache.set(k, await gde.chamberRecipes(c, start, end))
        return recipeCache.get(k)
      }))
      if (my === seq) scope.recipes = [...new Set(lists.flat())].sort()
    } catch (e) {
      scope.error = `${e.code}：${e.message}`
    } finally {
      if (my === seq) scope.loading = ''
    }
  },
)
const chamberGroups = computed(() => groupByTool(scope.chambers))

// 没选 fleet 时，recipe 直接在 GDE 全部 recipe 中模糊搜索（防抖 300 ms）
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
const candidates = computed(() => (scope.fleet ? scope.recipes : recipeOptions.value))
function addRecipe(name) {
  recipePick.value = ''
  if (!name || ed.recipes.includes(name)) return
  ed.recipes.push(name)
}
function addAll() {
  for (const r of scope.recipes) addRecipe(r)
}
function removeRecipe(i) {
  ed.recipes.splice(i, 1)
  errors.value = []
}
const recipeErrors = (i) => errors.value.filter((e) => e.path === `recipes[${i}]`)
const otherErrors = computed(() => errors.value.filter((e) => !e.path || !/^recipes\[\d+\]$/.test(e.path)))

// ---- ② 生成的绑定 JSON
const generated = computed(() => {
  if (!selected.value) return null
  return {
    feature_id: selected.value.feature_id,
    operator: selected.value.operator,
    version: ed.version,
    recipes: [...ed.recipes],
  }
})
const baseSpec = computed(() => base.value?.spec || null)
const sameSpec = (a, b) => !!a && !!b && JSON.stringify(normalizeSpec(a)) === JSON.stringify(normalizeSpec(b))
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
function revert() {
  loadSpec(baseSpec.value)
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
  ElMessage.success(decision === 'approve' ? '已生效，正在按 recipe 同步 GDE 订阅' : '已退回')
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
      <span class="muted" style="font-size: 13px">按 fleet → 腔室 → recipe 选择；只绑 recipe，审核通过后 GDE 自动推送该 recipe 下所有机台 / 腔室的 run_id，新增腔室也会自动计算</span>
      <span class="spacer" />
      <el-button @click="importOpen = true">导入</el-button>
      <el-button @click="doExport">导出</el-button>
    </div>
    <div class="split">
      <!-- 左侧 -->
      <div class="left card">
        <div class="filters">
          <el-select v-model="filter.feature_id" placeholder="特征" clearable filterable size="small" @change="loadList">
            <el-option v-for="f in featureList" :key="f.feature_id" :label="labelOf(f.feature_id, f.display_name)" :value="f.feature_id" />
          </el-select>
          <el-input v-model="filter.operator" placeholder="算子" clearable size="small" @change="loadList" />
          <el-input v-model="filter.recipe" placeholder="recipe" clearable size="small" @change="loadList" />
          <el-select v-model="filter.status" placeholder="状态" clearable size="small" @change="loadList">
            <el-option label="生效中" value="active" />
            <el-option label="有待审核" value="pending" />
          </el-select>
        </div>
        <div v-loading="listLoading" class="op-list">
          <div v-if="!items.length" class="muted" style="padding: 20px; text-align: center; font-size: 13px">没有匹配的算子</div>
          <template v-for="[fid, list] in grouped" :key="fid">
            <div class="group">{{ labelOf(fid, featureNames[fid]) }}</div>
            <div v-for="it in list" :key="it.operator" class="op-item" :class="{ on: selected && selected.feature_id === it.feature_id && selected.operator === it.operator }" @click="select(it)">
              <div style="display: flex; align-items: center; gap: 6px">
                <b>{{ opName(it) || it.operator }}</b>
                <span v-if="opName(it)" class="muted mono" style="font-size: 11px">{{ it.operator }}</span>
                <span v-if="it.active" class="muted" style="font-size: 12px">v{{ it.active.version }} · #{{ it.active.revision }}</span>
                <span class="spacer" style="flex: 1" />
                <el-tag v-if="it.pending" type="warning" size="small">待审核</el-tag>
                <el-tag v-else-if="it.active && it.active.spec.recipes.length" type="success" size="small">生效中</el-tag>
                <el-tag v-else type="info" size="small">未绑定</el-tag>
              </div>
              <div v-if="recipeCount(it)" class="muted" style="font-size: 12px; margin-top: 2px">
                {{ recipeCount(it) }} 个 recipe：{{ it.active.spec.recipes.slice(0, 3).join('、') }}{{ recipeCount(it) > 3 ? ' …' : '' }}
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
              <b style="font-size: 16px">{{ opName(selected) || selected.operator }}</b>
              <span class="mono muted" style="font-size: 13px">{{ selected.feature_id }}/{{ selected.operator }}</span>
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
            <div class="step-title"><span class="no">1</span>选 fleet、时间范围和腔室 <span class="muted">只用来缩小 recipe 候选范围，不写进绑定</span></div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center">
              <el-select v-model="scope.fleet" placeholder="选择 fleet" clearable style="width: 180px" @change="onFleet">
                <el-option v-for="f in scope.fleets" :key="f" :label="f" :value="f" />
              </el-select>
              <el-date-picker v-model="scope.range" type="daterange" value-format="YYYY-MM-DD" :clearable="false" style="width: 260px" @change="onFleet" />
              <span v-if="scope.fleet && scope.chambers.length" class="muted" style="font-size: 12px">已勾选 {{ scope.checked.length }} / {{ scope.chambers.length }} 个腔室</span>
            </div>
            <div v-if="scope.error" class="err-list" style="list-style: none; padding: 0">{{ scope.error }}</div>
            <div v-if="scope.fleet" v-loading="scope.loading === 'chamber'" class="chambers">
              <div v-if="!scope.chambers.length && scope.loading !== 'chamber'" class="muted" style="font-size: 12px">该 fleet 在这段时间内没有执行</div>
              <div v-for="[tool, list] in chamberGroups" :key="tool" class="tool-row">
                <el-checkbox :model-value="list.every((c) => scope.checked.includes(c))" :indeterminate="list.some((c) => scope.checked.includes(c)) && !list.every((c) => scope.checked.includes(c))"
                  style="margin-right: 10px; font-weight: 600" @change="toggleTool(list)">{{ tool }}</el-checkbox>
                <span v-for="c in list" :key="c" class="chip" :class="{ on: scope.checked.includes(c) }" @click="toggleChamber(c)">{{ c }}</span>
              </div>
            </div>
          </div>

          <div class="card step">
            <div class="step-title"><span class="no">2</span>选 recipe
              <span class="muted">{{ scope.fleet ? `候选为勾选腔室跑过的 recipe（${scope.recipes.length} 个）` : '未选 fleet 时在全部 recipe 中搜索' }}；GDE 会自动推送 recipe 关联的所有机台与腔室</span>
            </div>
            <div style="display: flex; gap: 8px; align-items: center">
              <el-select v-model="recipePick" filterable :remote="!scope.fleet" :remote-method="searchRecipes" :loading="recipeLoading || scope.loading === 'recipe'"
                placeholder="输入关键字过滤，点击加入" style="width: 320px" @change="addRecipe" @focus="!scope.fleet && searchRecipes('')">
                <el-option v-for="r in candidates" :key="r" :label="r" :value="r" :disabled="ed.recipes.includes(r)" />
              </el-select>
              <el-button v-if="scope.fleet && scope.recipes.length" plain @click="addAll">全部加入</el-button>
            </div>
            <div class="recipe-chips">
              <span v-if="!ed.recipes.length" class="muted" style="font-size: 13px">还没有绑定 recipe</span>
              <span v-for="(r, i) in ed.recipes" :key="r" class="recipe-chip" :class="{ bad: recipeErrors(i).length }">
                <span class="mono">{{ r }}</span>
                <span class="x" title="移除" @click="removeRecipe(i)">×</span>
              </span>
            </div>
            <template v-for="(r, i) in ed.recipes" :key="r + '-err'"><ErrorList v-if="recipeErrors(i).length" :errors="recipeErrors(i)" /></template>
          </div>

          <!-- ② -->
          <div class="card step">
            <div class="step-title"><span class="no">3</span>算子版本与绑定 JSON</div>
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
              <el-table-column label="recipe" min-width="150">
                <template #default="{ row }">
                  <span v-if="!row.spec.recipes.length" class="muted">空（解除全部绑定）</span>
                  <span v-else>{{ row.spec.recipes.join('、') }}</span>
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
.op-list { max-height: calc(100vh - 200px); overflow: auto; min-height: 120px; }
.group { font-size: 12px; color: #909399; padding: 8px 6px 4px; }
.op-item { padding: 9px 12px; border-radius: 12px; margin-bottom: 2px; cursor: pointer; border: 1px solid transparent; }
.op-item:hover { background: var(--soft-bg); }
.op-item.on { background: var(--brand-soft); border-color: var(--brand-line); }
.right { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 12px; }
.step-title { font-weight: 600; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
.step-title .muted { font-weight: normal; font-size: 12px; }
.no { display: inline-flex; width: 20px; height: 20px; border-radius: 50%; background: linear-gradient(135deg, #5b6cff, #22c3ee); color: #fff; font-size: 12px; align-items: center; justify-content: center; }
.tool-row { display: flex; align-items: center; flex-wrap: wrap; padding: 2px 0; }
.chambers { background: var(--soft-bg); border-radius: 12px; padding: 8px 12px; margin-top: 10px; min-height: 30px; }
.chip { display: inline-block; padding: 2px 10px; margin: 3px 6px 3px 0; border-radius: 99px; font-size: 12px; cursor: pointer; border: 1px solid var(--line); color: var(--fg-soft); background: #fff; user-select: none; }
.chip.on { background: var(--brand-soft); border-color: var(--brand-line); color: var(--brand); }
.recipe-chips { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; }
.recipe-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 6px 4px 12px; border-radius: 99px; background: var(--brand-soft); color: var(--brand); font-size: 13px; }
.recipe-chip.bad { background: #fff0f0; color: #e5484d; }
.recipe-chip .x { width: 18px; height: 18px; line-height: 17px; text-align: center; border-radius: 50%; cursor: pointer; }
.recipe-chip .x:hover { background: #fff; }
</style>
