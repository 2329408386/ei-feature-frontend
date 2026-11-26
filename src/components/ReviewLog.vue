<script setup>
import { fmtTime } from '../util'
defineProps({ log: { type: Array, default: () => [] } })
const TEXT = { approve: '通过', reject: '退回', restore: '重新上线' }
const TYPE = { approve: 'success', reject: 'danger', restore: 'primary' }
</script>

<template>
  <div v-if="!log.length" class="muted" style="font-size: 12px">暂无评审记录</div>
  <el-timeline v-else style="padding-left: 2px">
    <el-timeline-item v-for="(e, i) in log" :key="i" :timestamp="fmtTime(e.at)" :type="TYPE[e.decision] || 'info'" size="large">
      <b>{{ e.reviewer }}</b> {{ TEXT[e.decision] || e.decision }}
      <span v-if="e.comment">：{{ e.comment }}</span>
      <div v-if="e.retire_reason" class="muted" style="font-size: 12px">此前下线原因：{{ e.retire_reason }}</div>
      <div v-if="e.trial_runs?.length" class="muted mono" style="font-size: 12px">试跑：{{ e.trial_runs.join(', ') }}</div>
    </el-timeline-item>
  </el-timeline>
</template>
