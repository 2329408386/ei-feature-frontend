<script setup>
// 新增特征 / 特征新版本：直接填 feature.json
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { features } from '../api'
import ErrorList from './ErrorList.vue'

const props = defineProps({ modelValue: Boolean, base: Object }) // base：基于已有特征生成新版本
const emit = defineEmits(['update:modelValue', 'created'])
const TEMPLATE = { id: 'my_feature', version: '1.0.0', desc: '这个特征算什么', output: { unit: '' } }
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
    const spec = props.base ? { ...props.base.spec, version: bump(props.base.version) } : TEMPLATE
    text.value = JSON.stringify(spec, null, 2)
  },
)

async function save() {
  errors.value = []
  parseError.value = ''
  let spec
  try {
    spec = JSON.parse(text.value)
  } catch (e) {
    parseError.value = `JSON 格式错误：${e.message}`
    return
  }
  saving.value = true
  try {
    const f = await features.create(spec, { silent: true })
    ElMessage.success(`已生成草稿 ${f.feature_id}@${f.version}`)
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
  <el-dialog :model-value="modelValue" :title="base ? `新版本：${base.feature_id}` : '新增特征'" width="620px" @update:model-value="emit('update:modelValue', $event)">
    <div class="muted" style="font-size: 12px; margin-bottom: 6px">
      feature.json：id（小写字母开头，3~64 位）、version（语义化版本，需大于已有版本）、desc（1~200 字）、output.unit（可选）。其他键原样保存。
    </div>
    <textarea v-model="text" class="code-input" rows="12" spellcheck="false" />
    <div v-if="parseError" class="err-list" style="list-style: none; padding: 0">{{ parseError }}</div>
    <ErrorList :errors="errors" />
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">校验并保存草稿</el-button>
    </template>
  </el-dialog>
</template>
