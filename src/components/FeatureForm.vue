<script setup>
// 新增特征 / 特征新版本。
// 新增：填名称（必填）+ feature.json 其余字段，id 由后台自动生成；新版本：id 沿用、不可改，名称可顺带修改。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { features } from '../api'
import ErrorList from './ErrorList.vue'

const props = defineProps({ modelValue: Boolean, base: Object }) // base：基于已有特征生成新版本
const emit = defineEmits(['update:modelValue', 'created'])
const TEMPLATE = { version: '1.0.0', desc: '这个特征算什么', output: { unit: '' } }
const name = ref('')
const text = ref('')
const errors = ref([])
const parseError = ref('')
const saving = ref(false)

function bump(v) {
  const p = v.split('.').map(Number)
  return `${p[0]}.${p[1] + 1}.0`
}
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    errors.value = []
    parseError.value = ''
    name.value = props.base?.display_name || ''
    // id、name 不在 JSON 里编辑：id 后台生成（新版本沿用），name 用上面的输入框
    const { id, name: _n, ...rest } = props.base ? { ...props.base.spec, version: bump(props.base.version) } : TEMPLATE
    text.value = JSON.stringify(rest, null, 2)
  },
)

async function save() {
  errors.value = []
  parseError.value = ''
  if (!props.base && !name.value.trim()) {
    errors.value = [{ message: '请填写名称' }]
    return
  }
  let spec
  try {
    spec = JSON.parse(text.value)
  } catch (e) {
    parseError.value = `JSON 格式错误：${e.message}`
    return
  }
  delete spec.id
  delete spec.name
  if (props.base) spec = { id: props.base.feature_id, ...spec }
  if (name.value.trim()) spec.name = name.value.trim()
  saving.value = true
  try {
    const f = await features.create(spec, { silent: true })
    ElMessage.success(`已生成草稿 ${f.display_name || f.feature_id}（${f.feature_id}@${f.version}）`)
    emit('created', f)
    emit('update:modelValue', false)
  } catch (e) {
    errors.value = e.errors.length ? e.errors : [{ message: `${e.code}：${e.message}` }]
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="base ? `新版本：${base.display_name || base.feature_id}` : '新增特征'" width="620px" @update:model-value="emit('update:modelValue', $event)">
    <el-form label-width="64px" @submit.prevent>
      <el-form-item label="名称" :required="!base">
        <el-input v-model="name" maxlength="64" show-word-limit :placeholder="base ? '不改可留空' : '例如：主刻蚀气体流量偏差'" />
      </el-form-item>
      <el-form-item label="ID">
        <span v-if="base" class="mono">{{ base.feature_id }}</span>
        <span v-else class="muted" style="font-size: 13px">不用填，保存后由后台自动生成（如 feat_0012）</span>
        <span v-if="base" class="muted" style="font-size: 12px; margin-left: 8px">不可修改</span>
      </el-form-item>
    </el-form>
    <div class="muted" style="font-size: 12px; margin-bottom: 6px">
      feature.json：version（语义化版本{{ base ? '，需大于已有版本' : '，新特征默认 1.0.0' }}）、desc（1~200 字）、output.unit（可选）。其他键原样保存。
    </div>
    <textarea v-model="text" class="code-input" rows="9" spellcheck="false" />
    <div class="muted" style="font-size: 12px; margin-top: 4px">名称不随版本变化，之后可在列表里修改、不需要评审；关联的机台由算子绑定的 recipe 自动得出。</div>
    <div v-if="parseError" class="err-list" style="list-style: none; padding: 0">{{ parseError }}</div>
    <ErrorList :errors="errors" />
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">校验并保存草稿</el-button>
    </template>
  </el-dialog>
</template>
