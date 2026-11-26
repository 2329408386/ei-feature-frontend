// 离线演示构建（npm run build:offline）时为 true：请求由 offline.js 用内置快照应答，不访问后端
export const OFFLINE = import.meta.env.VITE_OFFLINE === 'true'
