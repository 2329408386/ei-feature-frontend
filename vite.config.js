import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 本地开发：/api 代理到 ei-feature-service（默认 http://127.0.0.1:8000）
const target = process.env.EI_FEATURE_API || 'http://127.0.0.1:8000'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: { '/api': { target, changeOrigin: true } },
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    proxy: { '/api': { target, changeOrigin: true } },
  },
})
