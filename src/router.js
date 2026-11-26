import { createRouter, createWebHistory } from 'vue-router'

export default createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/features' },
    { path: '/features', component: () => import('./views/Features.vue'), meta: { title: '特征' } },
    { path: '/bindings', component: () => import('./views/Bindings.vue'), meta: { title: '算子绑定' } },
    { path: '/schedules', component: () => import('./views/Schedules.vue'), meta: { title: '调度' } },
    { path: '/results', component: () => import('./views/Results.vue'), meta: { title: '结果' } },
  ],
})
