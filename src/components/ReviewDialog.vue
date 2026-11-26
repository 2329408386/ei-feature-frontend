<script setup>
// 评审：特征（描述 + 意见）；算子（描述、只读代码、试跑框、评审清单、意见；通过前至少试跑 1 个 run_id）
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { features, operators } from '../api'
import CodeView from './CodeView.vue'
import TrialBox from './TrialBox.vue'
import ReviewLog from './ReviewLog.vue'

const props = defineProps({ modelValue: Boolean, kind: String, target: Object }) // kind: feature | operator
const emit = defineEmits(['update:modelValue', 'done'])

const detail = ref(null)
const comment = ref('')
const trialRuns = ref([])
const checks = ref([])
const busy = ref(false)
const CHECKLIST = [
  '只在 fetch 中取数，compute 是纯计算',
  '数据不合格时 raise Skip 并给出明确原因码',
  '试跑结果的量级、单位与特征说明一致',
  '没有硬编码的机台、腔室或 recipe',
]

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    comment.value = ''
    trialRuns.value = []
    checks.value = []
    detail.value = null
    const t = props.target
    detail.value = props.kind === 'operator' ? await operators.detail(t.feature_id, t.name, t.version) : t
  },
)

const title = computed(() => {
  const t = props.target
  if (!t) return ''
  return props.kind === 'operator' ? `评审算子 ${t.feature_id}/${t.name}@${t.version}` : `评审特征 ${t.feature_id}@${t.version}`
})
const canApprove = computed(() => props.kind === 'feature' || (trialRuns.value.length > 0 && checks.value.length === CHECKLIST.length))

function onRan(runId) {
  if (!trialRuns.value.includes(runId)) trialRuns.value.push(runId)
}

async function decide(decision) {
  if (decision === 'reject' && !comment.value.trim()) {
    ElMessage.warning('退回需要填写意见')
    return
  }
  busy.value = true
  const t = props.target
  const body = { decision, comment: comment.value.trim() || null }
  try {
    if (props.kind === 'operator') await operators.review(t.feature_id, t.name, t.version, { ...body, trial_runs: trialRuns.value })
    else await features.review(t.feature_id, t.version, body)
    ElMessage.success(decision === 'approve' ? '已通过并发布' : '已退回为草稿')
    emit('done')
    emit('update:modelValue', false)
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <el-dialog :model-value="modelValue" :title="title" :width="kind === 'operator' ? '920px' : '600px'" top="4vh" @update:model-value="emit('update:modelValue', $event)">
    <div v-if="detail" v-loading="!detail">
      <el-descriptions :column="2" border size="small">
        <el-descriptions-item label="描述" :span="2">{{ detail.description }}</el-descriptions-item>
        <el-descriptions-item label="提交人">{{ detail.created_by }}</el-descriptions-item>
        <el-descriptions-item v-if="kind === 'feature'" label="单位">{{ detail.unit || '—' }}</el-descriptions-item>
        <el-descriptions-item v-else label="文件"><span class="mono">{{ detail.code_file }}</span></el-descriptions-item>
      </el-descriptions>

      <template v-if="kind === 'feature'">
        <div class="section-title" style="margin-top: 12px">feature.json</div>
        <CodeView :code="JSON.stringify(detail.spec, null, 2)" lang="json" />
        <div class="muted" style="font-size: 12px; margin-top: 8px">特征评审不需要试跑。通过后，同一特征原来已发布的版本自动下线（其算子不受影响）。</div>
      </template>

      <template v-else>
        <div class="section-title" style="margin-top: 12px">operator.json</div>
        <CodeView :code="JSON.stringify(detail.spec, null, 2)" lang="json" />
        <div class="section-title" style="margin-top: 12px">代码 <span class="muted mono" style="font-weight: normal">{{ detail.code_file }}</span></div>
        <CodeView :code="detail.code" max-height="300px" />
        <div class="section-title" style="margin-top: 12px">
          试跑 <span class="muted" style="font-weight: normal; font-size: 12px">通过前至少试跑 1 个 run_id；结果不写入特征值</span>
        </div>
        <TrialBox :op="detail" @ran="onRan" />
        <div v-if="trialRuns.length" class="muted mono" style="font-size: 12px; margin-top: 6px">本次评审记录的试跑：{{ trialRuns.join(', ') }}</div>
        <div class="section-title" style="margin-top: 12px">评审清单</div>
        <el-checkbox-group v-model="checks" style="display: flex; flex-direction: column">
          <el-checkbox v-for="c in CHECKLIST" :key="c" :value="c" :label="c" />
        </el-checkbox-group>
      </template>

      <div v-if="detail.review_log?.length" style="margin-top: 12px">
        <div class="section-title">历史评审</div>
        <ReviewLog :log="detail.review_log" />
      </div>

      <div class="section-title" style="margin-top: 12px">意见</div>
      <el-input v-model="comment" type="textarea" :rows="2" placeholder="退回时必填" />
    </div>
    <template #footer>
      <span v-if="kind === 'operator' && !canApprove" class="muted" style="font-size: 12px; margin-right: 12px">
        {{ trialRuns.length ? '请勾选完评审清单' : '请先试跑至少 1 个 run_id' }}
      </span>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="danger" plain :loading="busy" @click="decide('reject')">退回</el-button>
      <el-button type="success" :loading="busy" :disabled="!canApprove" @click="decide('approve')">通过并发布</el-button>
    </template>
  </el-dialog>
</template>
