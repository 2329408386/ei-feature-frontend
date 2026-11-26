import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 本地开发：/api 代理到 ei-feature-service（默认 http://127.0.0.1:8000）
const target = process.env.EI_FEATURE_API || 'http://127.0.0.1:8000'

// mode=offline：离线演示构建（npm run build:offline），产物再由 scripts/inline.mjs 合成单个 HTML
export default defineConfig(({ mode }) => ({
  plugins: [vue()],
  ...(mode === 'offline' && {
    base: './',
    build: {
      outDir: 'dist-offline',
      assetsInlineLimit: 100_000_000,
      cssCodeSplit: false,
      chunkSizeWarningLimit: 10_000,
      rolldownOptions: { output: { codeSplitting: false } },
    },
  }),
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
}))
