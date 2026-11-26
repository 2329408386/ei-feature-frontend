import { createRouter, createWebHashHistory, createWebHistory } from 'vue-router'
import { OFFLINE } from './api/offline-flag'

export default createRouter({
  // 离线演示是本地文件（file://），只能用 hash 路由
  history: OFFLINE ? createWebHashHistory() : createWebHistory(),
  routes: [
    { path: '/', redirect: '/features' },
    { path: '/features', component: () => import('./views/Features.vue'), meta: { title: '特征' } },
    { path: '/bindings', component: () => import('./views/Bindings.vue'), meta: { title: '算子绑定' } },
    { path: '/schedules', component: () => import('./views/Schedules.vue'), meta: { title: '调度' } },
    { path: '/results', component: () => import('./views/Results.vue'), meta: { title: '结果' } },
  ],
})
