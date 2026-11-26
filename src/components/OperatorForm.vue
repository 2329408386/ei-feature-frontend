<script setup>
// 新增算子：填名称（必填）+ operator.json + 代码，算子 ID 由后台生成；
// 基于已有算子提交新版本（base）：ID 沿用、不可改，名称可顺带修改
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { operators } from '../api'
import ErrorList from './ErrorList.vue'

const props = defineProps({
  modelValue: Boolean,
  featureId: String,
  existing: { type: Array, default: () => [] }, // 该特征下已有算子（各版本），用来推算 ID、新版本号和默认文件名
  base: Object, // 基于某个算子版本（含 code）提交新版本
})
const emit = defineEmits(['update:modelValue', 'created'])

const CODE = `from eifeature import Skip, gde, ops


def fetch(run_id):
    """只在这里取数。"""
    s = gde.trace(run_id, "GasFlow_Ar", unit="sccm").steps(210, 212)
    return {"s": {"t": s.t, "v": s.v}}


def compute(data):
    """纯计算；数据不合格 raise Skip("REASON_CODE")。"""
    s = ops.dedup(data["s"])
    if len(s) < 20:
        raise Skip("LOW_COVERAGE")
    return ops.mean(s)
`
const specText = ref('')
const code = ref('')
const codeFile = ref('')
const displayName = ref('') // 名称：新算子必填；新版本可留空（不改）
const errors = ref([])
const saving = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    errors.value = []
    codeFile.value = ''
    displayName.value = props.base?.display_name || ''
    if (props.base) {
      const { id, name, ...rest } = props.base.spec // id、name 不在 JSON 里编辑
      specText.value = JSON.stringify(rest, null, 2)
      code.value = props.base.code || ''
    } else {
      specText.value = JSON.stringify({ desc: '这个算子怎么算' }, null, 2)
      code.value = CODE
    }
  },
)

// 新算子的 ID 与后台规则一致（op_N，取第一个未占用的），只用于提示文件名
const predictedId = computed(() => {
  const used = new Set(props.existing.map((o) => o.name))
  let n = used.size + 1
  while (used.has(`op_${n}`)) n++
  return `op_${n}`
})
const opId = computed(() => props.base?.name || predictedId.value)
const nextVersion = computed(() => {
  if (!props.base) return 1
  const vs = props.existing.filter((o) => o.name === props.base.name).map((o) => o.version)
  return vs.length ? Math.max(...vs) + 1 : props.base.version + 1
})
const defaultFile = computed(() => `${opId.value}_v${nextVersion.value}.py`)

const isCode = (e) => !!e.line || (e.file && e.file.endsWith('.py'))
const codeErrors = computed(() => errors.value.filter(isCode))
function errorsOf(file) {
  if (file === 'other') return errors.value.filter((e) => !isCode(e) && !['operator.json', 'code_file'].includes(e.file))
  return errors.value.filter((e) => !isCode(e) && e.file === file)
}

function onTab(e) {
  // 代码框里 Tab 输入 4 个空格
  const ta = e.target
  const s = ta.selectionStart
  code.value = code.value.slice(0, s) + '    ' + code.value.slice(ta.selectionEnd)
  requestAnimationFrame(() => (ta.selectionStart = ta.selectionEnd = s + 4))
}

async function save() {
  errors.value = []
  if (!props.base && !displayName.value.trim()) {
    errors.value = [{ message: '请填写名称' }]
    return
  }
  let spec
  try {
    spec = JSON.parse(specText.value)
  } catch (e) {
    errors.value = [{ file: 'operator.json', message: `JSON 格式错误：${e.message}` }]
    return
  }
  delete spec.id
  delete spec.name
  if (props.base) spec = { id: props.base.name, ...spec }
  if (displayName.value.trim()) spec.name = displayName.value.trim()
  saving.value = true
  try {
    const body = { feature_id: props.featureId, spec, code: code.value }
    if (codeFile.value.trim()) body.code_file = codeFile.value.trim()
    const o = await operators.create(body, { silent: true })
    ElMessage.success(`已生成草稿 ${o.display_name || o.name}（${o.ref}，${o.code_file}）`)
    emit('created', o)
    emit('update:modelValue', false)
  } catch (e) {
    errors.value = e.errors.length ? e.errors : [{ message: `${e.code}：${e.message}` }]
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="base ? `新版本 · ${base.display_name || base.name} v${nextVersion}` : `新增算子 · ${featureId}`" width="860px" top="5vh"
    @update:model-value="emit('update:modelValue', $event)">
    <el-form label-width="64px" @submit.prevent>
      <el-form-item label="名称" :required="!base">
        <el-input v-model="displayName" maxlength="64" show-word-limit :placeholder="base ? '不改可留空' : '例如：偏差均值'" style="width: 420px" />
      </el-form-item>
      <el-form-item label="ID">
        <template v-if="base"><span class="mono">{{ base.name }}</span><span class="muted" style="font-size: 12px; margin-left: 8px">不可修改；保存后为 v{{ nextVersion }}，特征版本不变</span></template>
        <span v-else class="muted" style="font-size: 13px">不用填，保存后由后台自动生成（预计 <span class="mono">{{ predictedId }}</span>）</span>
      </el-form-item>
    </el-form>
    <div class="section-title">operator.json <span class="muted" style="font-weight: normal; font-size: 12px">desc（1~200 字）；其他键原样保存</span></div>
    <textarea v-model="specText" class="code-input" rows="4" spellcheck="false" />
    <ErrorList :errors="errorsOf('operator.json')" />

    <div class="section-title" style="margin-top: 12px">
      代码
      <span class="muted" style="font-weight: normal; font-size: 12px">顶层定义 fetch(run_id) 和 compute(data)；import 仅限 eifeature、math、statistics、numpy 等白名单</span>
    </div>
    <textarea v-model="code" class="code-input" rows="18" spellcheck="false" @keydown.tab.prevent="onTab" />
    <ErrorList :errors="codeErrors" />

    <div style="display: flex; align-items: center; gap: 8px; margin-top: 12px">
      <span class="section-title" style="margin: 0">文件名</span>
      <el-input v-model="codeFile" :placeholder="defaultFile" style="width: 280px" class="mono" />
      <span class="muted" style="font-size: 12px">可选，不填为 {{ defaultFile }}</span>
    </div>
    <ErrorList :errors="errorsOf('code_file')" />
    <ErrorList :errors="errorsOf('other')" />

    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">校验并保存草稿</el-button>
    </template>
  </el-dialog>
</template>
