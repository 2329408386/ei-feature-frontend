<script setup>
// 算子详情：operator.json、代码、评审记录、试跑
import { ref, watch } from 'vue'
import { operators } from '../api'
import { fmtTime } from '../util'
import CodeView from './CodeView.vue'
import ReviewLog from './ReviewLog.vue'
import StatusTag from './StatusTag.vue'
import TrialBox from './TrialBox.vue'

const props = defineProps({ modelValue: Boolean, target: Object })
const emit = defineEmits(['update:modelValue'])
const detail = ref(null)

watch(
  () => [props.modelValue, props.target],
  async ([open]) => {
    if (!open || !props.target) return
    detail.value = null
    const t = props.target
    detail.value = await operators.detail(t.feature_id, t.name, t.version)
  },
)
</script>

<template>
  <el-drawer :model-value="modelValue" size="760px" :title="target ? `${target.feature_id}/${target.name}@${target.version}` : ''" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="detail">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="状态"><StatusTag :status="detail.status" /></el-descriptions-item>
        <el-descriptions-item label="文件"><span class="mono">{{ detail.code_file }}</span></el-descriptions-item>
        <el-descriptions-item label="描述" :span="2">{{ detail.description }}</el-descriptions-item>
        <el-descriptions-item label="提交人">{{ detail.created_by }} · {{ fmtTime(detail.created_at) }}</el-descriptions-item>
        <el-descriptions-item label="发布">{{ detail.published_by ? `${detail.published_by} · ${fmtTime(detail.published_at)}` : '—' }}</el-descriptions-item>
        <el-descriptions-item v-if="detail.retired_at" label="下线" :span="2">{{ detail.retired_by }} · {{ fmtTime(detail.retired_at) }} · {{ detail.retire_reason }}</el-descriptions-item>
        <el-descriptions-item label="code_hash" :span="2"><span class="mono" style="font-size: 12px">{{ detail.code_hash }}</span></el-descriptions-item>
      </el-descriptions>
      <div class="section-title" style="margin-top: 14px">operator.json</div>
      <CodeView :code="JSON.stringify(detail.spec, null, 2)" lang="json" />
      <div class="section-title" style="margin-top: 14px">代码</div>
      <CodeView :code="detail.code" max-height="360px" />
      <template v-if="detail.status !== 'retired'">
        <div class="section-title" style="margin-top: 14px">试跑</div>
        <TrialBox :op="detail" />
      </template>
      <div class="section-title" style="margin-top: 14px">评审记录</div>
      <ReviewLog :log="detail.review_log" />
    </div>
  </el-drawer>
</template>
