<script setup>
import { fmtTime } from '../util'
defineProps({ log: { type: Array, default: () => [] } })
</script>

<template>
  <div v-if="!log.length" class="muted" style="font-size: 12px">暂无评审记录</div>
  <el-timeline v-else style="padding-left: 2px">
    <el-timeline-item v-for="(e, i) in log" :key="i" :timestamp="fmtTime(e.at)" :type="e.decision === 'approve' ? 'success' : 'danger'" size="large">
      <b>{{ e.reviewer }}</b> {{ e.decision === 'approve' ? '通过' : '退回' }}
      <span v-if="e.comment">：{{ e.comment }}</span>
      <div v-if="e.trial_runs?.length" class="muted mono" style="font-size: 12px">试跑：{{ e.trial_runs.join(', ') }}</div>
    </el-timeline-item>
  </el-timeline>
</template>
