<script setup>
import { computed } from 'vue'
import { STATUS, REV_STATUS, BATCH_STATUS, SUB_STATUS } from '../util'

const props = defineProps({ status: String, kind: { type: String, default: 'review' } })
const maps = { review: STATUS, revision: REV_STATUS, batch: BATCH_STATUS, sub: SUB_STATUS }
const info = computed(() => maps[props.kind][props.status] || { text: props.status, type: 'info' })
</script>

<template>
  <el-tag :type="info.type" size="small" disable-transitions>{{ info.text }}</el-tag>
</template>
