<script setup>
// 导入绑定：先 dry_run 校验，确认后为每个 new 的算子生成待审核修订
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { bindings } from '../api'
import ErrorList from './ErrorList.vue'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue', 'done'])
const text = ref('')
const result = ref(null)
const error = ref('')
const busy = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      text.value = ''
      result.value = null
      error.value = ''
    }
  },
)

function onFile(file) {
  const reader = new FileReader()
  reader.onload = () => {
    text.value = reader.result
    result.value = null
  }
  reader.readAsText(file.raw)
}

const ACTION = {
  new: { text: '新建修订', type: 'success' },
  skip: { text: '无变化', type: 'info' },
  conflict: { text: '有待审核', type: 'warning' },
  error: { text: '错误', type: 'danger' },
}

async function run(dryRun) {
  error.value = ''
  let doc
  try {
    doc = JSON.parse(text.value)
  } catch (e) {
    error.value = `JSON 格式错误：${e.message}`
    return
  }
  busy.value = true
  try {
    result.value = await bindings.import(doc, dryRun, { silent: true })
    if (!dryRun) {
      const n = result.value.items.filter((i) => i.action === 'new').length
      ElMessage.success(`已生成 ${n} 个待审核修订`)
      emit('done')
    }
  } catch (e) {
    error.value = `${e.code}：${e.message}`
  } finally {
    busy.value = false
  }
}
const newCount = () => (result.value?.items || []).filter((i) => i.action === 'new' && !i.revision).length
</script>

<template>
  <el-dialog :model-value="modelValue" title="导入绑定" width="760px" @update:model-value="emit('update:modelValue', $event)">
    <div style="display: flex; gap: 8px; align-items: center; margin-bottom: 8px">
      <el-upload :auto-upload="false" :show-file-list="false" accept=".json" :on-change="onFile">
        <el-button>选择导出的 JSON 文件</el-button>
      </el-upload>
      <span class="muted" style="font-size: 12px">或直接粘贴；格式 ei-feature-service.bindings/v2，每个算子独立校验</span>
    </div>
    <textarea v-model="text" class="code-input" rows="10" spellcheck="false" placeholder='{"format": "ei-feature-service.bindings/v2", "bindings": [...]}' />
    <div v-if="error" class="err-list" style="list-style: none; padding: 0">{{ error }}</div>
    <el-table v-if="result" :data="result.items" size="small" border style="margin-top: 10px">
      <el-table-column label="算子" min-width="180"><template #default="{ row }"><span class="mono">{{ row.feature_id }}/{{ row.operator }}</span></template></el-table-column>
      <el-table-column label="结果" width="100"><template #default="{ row }"><el-tag :type="ACTION[row.action].type" size="small">{{ ACTION[row.action].text }}</el-tag></template></el-table-column>
      <el-table-column label="说明" min-width="240">
        <template #default="{ row }">
          {{ row.message }}<span v-if="row.revision"> → 修订 #{{ row.revision }}</span>
          <ErrorList :errors="row.errors || []" />
        </template>
      </el-table-column>
    </el-table>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">关闭</el-button>
      <el-button :loading="busy" :disabled="!text.trim()" @click="run(true)">校验（不落库）</el-button>
      <el-button type="primary" :loading="busy" :disabled="!result || !newCount()" @click="run(false)">导入 {{ result ? newCount() : '' }} 个</el-button>
    </template>
  </el-dialog>
</template>
