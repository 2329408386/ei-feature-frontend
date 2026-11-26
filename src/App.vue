<script setup>
import { useRoute } from 'vue-router'
import { DEV_USER_SWITCH, devUser, setDevUser } from './api/http'
import { OFFLINE } from './api/offline-flag'

const route = useRoute()
const nav = [
  { path: '/features', title: '特征' },
  { path: '/bindings', title: '算子绑定' },
  { path: '/schedules', title: '调度' },
  { path: '/results', title: '结果' },
]
const users = ['alice', 'bob', 'carol']
// 切换用户后重新加载当前页，避免沿用上一个用户的按钮状态
function switchUser(u) {
  setDevUser(u)
  location.reload()
}
</script>

<template>
  <div class="layout">
    <header class="topbar">
      <div class="brand">
        <span class="logo">ƒ</span>
        <span class="name">EI Feature</span>
        <span class="sub">特征计算平台</span>
      </div>
      <nav class="nav">
        <router-link v-for="n in nav" :key="n.path" :to="n.path" class="nav-item" :class="{ active: route.path.startsWith(n.path) }">{{ n.title }}</router-link>
      </nav>
      <span class="spacer" />
      <span v-if="OFFLINE" class="offline">离线演示 · 数据为快照，修改不会保存</span>
      <template v-else-if="DEV_USER_SWITCH">
        <span class="muted" style="font-size: 12px; margin-right: 8px">开发模式用户</span>
        <el-select :model-value="devUser.name" size="small" style="width: 110px" allow-create filterable @change="switchUser">
          <el-option v-for="u in users" :key="u" :label="u" :value="u" />
        </el-select>
      </template>
      <span class="avatar">{{ (devUser.name || 'u').slice(0, 1).toUpperCase() }}</span>
    </header>
    <main class="main"><router-view /></main>
  </div>
</template>

<style scoped>
.layout { min-height: 100%; display: flex; flex-direction: column; }
.topbar { position: sticky; top: 0; z-index: 20; display: flex; align-items: center; gap: 28px; height: 60px; padding: 0 28px;
  background: rgba(255, 255, 255, 0.78); backdrop-filter: saturate(1.6) blur(14px); border-bottom: 1px solid rgba(230, 233, 242, 0.8); }
.brand { display: flex; align-items: center; gap: 10px; }
.logo { width: 32px; height: 32px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; color: #fff; font: 700 18px/1 'JetBrains Mono', monospace;
  background: linear-gradient(135deg, #5b6cff, #22c3ee); box-shadow: 0 6px 16px rgba(91, 108, 255, 0.35); }
.name { font-weight: 700; font-size: 16px; letter-spacing: 0.2px; }
.sub { font-size: 12px; color: var(--fg-faint); padding-left: 10px; border-left: 1px solid var(--line); }
.nav { display: flex; gap: 4px; background: #f1f3f9; padding: 4px; border-radius: 12px; }
.nav-item { padding: 6px 16px; border-radius: 9px; color: var(--fg-soft); text-decoration: none; font-size: 14px; font-weight: 500; transition: all 0.15s; }
.nav-item:hover { color: var(--fg); }
.nav-item.active { background: #fff; color: var(--brand); box-shadow: 0 2px 8px rgba(25, 35, 70, 0.08); }
.spacer { flex: 1; }
.offline { font-size: 12px; color: #b26a00; background: #fff6e6; padding: 4px 12px; border-radius: 99px; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #ffb86b, #ff6b9a); color: #fff; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-size: 14px; }
.main { flex: 1; }
</style>
