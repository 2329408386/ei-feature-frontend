// 显示用的小工具
export const STATUS = {
  draft: { text: '草稿', type: 'info' },
  review: { text: '待评审', type: 'warning' },
  published: { text: '已发布', type: 'success' },
  retired: { text: '已下线', type: 'danger' },
}
export const REV_STATUS = {
  pending: { text: '待审核', type: 'warning' },
  active: { text: '生效中', type: 'success' },
  rejected: { text: '已退回', type: 'danger' },
  withdrawn: { text: '已撤回', type: 'info' },
  superseded: { text: '已被替代', type: 'info' },
}
export const BATCH_STATUS = {
  queued: { text: '排队中', type: 'info' },
  running: { text: '进行中', type: 'primary' },
  done: { text: '完成', type: 'success' },
  failed: { text: '失败', type: 'danger' },
  cancelled: { text: '已取消', type: 'info' },
}
export const BATCH_MODE = { live: '实时', fill: '补算', overwrite: '重算' }
export const SUB_STATUS = {
  running: { text: '运行中', type: 'success' },
  paused: { text: '已暂停', type: 'warning' },
  cancelled: { text: '已取消', type: 'info' },
  unknown: { text: '未知', type: 'danger' },
}

const pad = (n) => String(n).padStart(2, '0')
export function fmtTime(s, withSec = false) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d)) return s
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return withSec ? `${base}:${pad(d.getSeconds())}` : base
}
export function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
export function daysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return fmtDate(d)
}
export const today = () => fmtDate(new Date())

export function fmtNum(v, digits = 4) {
  if (v === null || v === undefined) return '—'
  return Number(v).toFixed(digits).replace(/\.?0+$/, '')
}

/** 语义化版本比较 */
export function cmpSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]
  return 0
}

export function opRef(o) {
  return `${o.feature_id}/${o.name ?? o.operator}@${o.version}`
}
export function parseRef(ref) {
  const m = /^([^/]+)\/([^@]+)@(\d+)$/.exec(ref)
  return m ? { feature_id: m[1], operator: m[2], version: Number(m[3]) } : null
}

/** 把绑定 spec 规范化（recipe 按名称、腔室按 (tool, chamber) 排序），用于比较是否有修改 */
export function normalizeSpec(spec) {
  const recipes = (spec.recipes || [])
    .map((r) => ({
      recipe: r.recipe,
      chambers: [...r.chambers]
        .sort((a, b) => (a.tool + '\0' + a.chamber).localeCompare(b.tool + '\0' + b.chamber))
        .map((c) => ({ tool: c.tool, chamber: c.chamber })),
    }))
    .sort((a, b) => a.recipe.localeCompare(b.recipe))
  return { feature_id: spec.feature_id, operator: spec.operator, version: spec.version, recipes }
}
