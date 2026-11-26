<script setup>
// 修改特征（名称、机台类型）或算子（名称）。ID 不变、对全部版本生效、不需要评审。
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { features, operators } from '../api'

const props = defineProps({
  modelValue: Boolean,
  kind: String, // feature | operator
  target: Object, // feature: {feature_id, display_name, tool_type}；operator: {feature_id, name, display_name}
  toolTypes: { type: Array, default: () => [] },
})
const emit = defineEmits(['update:modelValue', 'saved'])
const name = ref('')
const toolType = ref('')
const saving = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open || !props.target) return
    name.value = props.target.display_name || ''
    toolType.value = props.target.tool_type || ''
  },
)

async function save() {
  saving.value = true
  try {
    const t = props.target
    if (props.kind === 'feature') {
      await features.updateMeta(t.feature_id, { name: name.value.trim() || null, tool_type: toolType.value?.trim() || null })
    } else {
      await operators.updateMeta(t.feature_id, t.name, { name: name.value.trim() || null })
    }
    ElMessage.success('已保存')
    emit('saved')
    emit('update:modelValue', false)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="kind === 'feature' ? '修改特征信息' : '修改算子名称'" width="460px" @update:model-value="emit('update:modelValue', $event)">
    <el-form v-if="target" label-width="80px">
      <el-form-item :label="kind === 'feature' ? '特征 ID' : '算子'">
        <span class="mono">{{ kind === 'feature' ? target.feature_id : `${target.feature_id}/${target.name}` }}</span>
        <span class="muted" style="font-size: 12px; margin-left: 8px">ID 不可修改</span>
      </el-form-item>
      <el-form-item label="名称">
        <el-input v-model="name" maxlength="64" show-word-limit placeholder="显示名称，留空则显示 ID" />
      </el-form-item>
      <el-form-item v-if="kind === 'feature'" label="机台类型">
        <el-select v-model="toolType" filterable allow-create clearable default-first-option placeholder="如 ETCH、CVD，可直接输入" style="width: 100%">
          <el-option v-for="t in toolTypes" :key="t" :label="t" :value="t" />
        </el-select>
      </el-form-item>
    </el-form>
    <div class="muted" style="font-size: 12px">对全部版本生效，不需要评审；引用、绑定、特征值仍按 ID。</div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>
