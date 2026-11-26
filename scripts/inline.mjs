// 把 dist-offline/ 的 index.html 与 JS、CSS 合成一个可直接双击打开的 HTML：offline/ei-feature-offline.html
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const dist = new URL('../dist-offline/', import.meta.url)
let html = readFileSync(new URL('index.html', dist), 'utf8')
const read = (p) => readFileSync(new URL(p.replace(/^\.\//, ''), dist), 'utf8')
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>\n${read(href)}\n</style>`)
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '')
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g,
  (_, src) => `<script type="module">\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`)
html = html.replace(/<link rel="icon"[^>]*href="([^"]+\.svg)"[^>]*>/, (_, href) => {
  const svg = read(href.replace(/^\//, './'))
  return `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(svg)}">`
})
html = html.replace('<title>', '<title>离线演示 · ')
if (/src="\.\/assets|href="\.\/assets/.test(html)) throw new Error('仍有未内联的资源引用')
mkdirSync(new URL('../offline/', import.meta.url), { recursive: true })
const out = new URL('../offline/ei-feature-offline.html', import.meta.url)
writeFileSync(out, html)
console.log(`已生成 ${out.pathname}（${(html.length / 1024 / 1024).toFixed(1)} MB）`)
