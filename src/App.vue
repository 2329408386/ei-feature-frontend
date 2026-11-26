<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { DEV_USER_SWITCH, devUser, setDevUser } from './api/http'

const route = useRoute()
const nav = [
  { path: '/features', step: '1·2', title: '特征' },
  { path: '/bindings', step: '3', title: '算子绑定' },
  { path: '/schedules', step: '4', title: '调度' },
  { path: '/results', step: '5', title: '结果' },
]
const title = computed(() => route.meta.title || '')
const users = ['alice', 'bob', 'carol']
// 切换用户后重新加载当前页，避免沿用上一个用户的按钮状态
function switchUser(u) {
  setDevUser(u)
  location.reload()
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="200px" class="aside">
      <div class="brand">ei-feature-service</div>
      <router-link v-for="n in nav" :key="n.path" :to="n.path" class="nav" active-class="active">
        <span class="step">{{ n.step }}</span>{{ n.title }}
      </router-link>
    </el-aside>
    <el-container>
      <el-header class="header" height="52px">
        <span class="crumb">ei-feature-service / <b>{{ title }}</b></span>
        <span class="spacer" />
        <template v-if="DEV_USER_SWITCH">
          <span class="muted" style="font-size: 12px; margin-right: 6px">当前用户（开发模式，替代网关 X-User）</span>
          <el-select :model-value="devUser.name" size="small" style="width: 120px" allow-create filterable @change="switchUser">
            <el-option v-for="u in users" :key="u" :label="u" :value="u" />
          </el-select>
        </template>
      </el-header>
      <el-main style="padding: 0">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout { height: 100%; }
.aside { background: #1f2d3d; color: #bfcbd9; }
.brand { color: #fff; font-weight: 600; padding: 18px 16px; font-size: 15px; border-bottom: 1px solid #2c3e50; }
.nav { display: flex; align-items: center; gap: 10px; padding: 12px 18px; color: #bfcbd9; text-decoration: none; font-size: 14px; }
.nav:hover { background: #263445; }
.nav.active { background: #409eff22; color: #fff; border-left: 3px solid #409eff; padding-left: 15px; }
.step { display: inline-block; min-width: 26px; text-align: center; font-size: 11px; border-radius: 10px; background: #2c3e50; color: #8aa4bf; padding: 1px 4px; }
.nav.active .step { background: #409eff; color: #fff; }
.header { display: flex; align-items: center; background: #fff; border-bottom: 1px solid #e4e7ed; }
.crumb { color: #606266; }
.spacer { flex: 1; }
</style>
