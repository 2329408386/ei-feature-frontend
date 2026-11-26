// 从运行中的 ei-feature-service 抓取一份数据快照，供离线演示构建使用（npm run snapshot）。
// 用法：EI_FEATURE_API=http://127.0.0.1:8000 node scripts/snapshot.mjs
import { writeFileSync } from 'node:fs'

const API = (process.env.EI_FEATURE_API || 'http://127.0.0.1:8000') + '/api'
const H = { 'X-User': 'offline-snapshot', 'X-Client': 'console', 'Content-Type': 'application/json' }
const enc = encodeURIComponent
async function get(path, params = {}) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== '')).toString()
  const r = await fetch(`${API}${path}${qs ? '?' + qs : ''}`, { headers: H })
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status} ${await r.text()}`)
  return r.json()
}
async function post(path, body) {
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: H, body: JSON.stringify(body) })
  return r.ok ? r.json() : null
}
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)

const snap = { taken_at: new Date().toISOString(), gde: {} }
snap.features = (await get('/features', { page_size: 200 })).items
snap.tools = await get('/features/tools')
snap.featureDetails = {}
for (const f of snap.features) snap.featureDetails[`${f.feature_id}@${f.version}`] = await get(`/features/${enc(f.feature_id)}/${enc(f.version)}`)
snap.operators = (await get('/operators', { page_size: 200 })).items
snap.operatorDetails = {}
for (const o of snap.operators) snap.operatorDetails[o.ref] = await get(`/operators/${enc(o.feature_id)}/${enc(o.name)}/${o.version}`)
snap.bindings = (await get('/bindings')).items
snap.revisions = {}
for (const o of new Set(snap.operators.map((o) => `${o.feature_id}/${o.name}`))) snap.revisions[o] = await get(`/bindings/${o}`)
snap.export = await get('/bindings/export')

const g = snap.gde
g.fleets = await get('/gde/fleets')
g.fleetChambers = {}
for (const f of g.fleets) g.fleetChambers[f] = await get(`/gde/fleets/${enc(f)}/chambers`, { start: day(30), end: day(0) })
g.recipes = await get('/gde/recipes', { limit: 500 })
g.recipeChambers = {}
for (const r of g.recipes) g.recipeChambers[r] = await get(`/gde/recipes/${enc(r)}/chambers`)
g.chamberRecipes = {}
for (const c of new Set(Object.values(g.fleetChambers).flat().map((x) => x.chamber))) g.chamberRecipes[c] = await get(`/gde/chambers/${enc(c)}/recipes`, { start: day(30), end: day(0) })
g.runs = {}
for (const r of g.recipes) g.runs[r] = await get('/gde/runs', { recipe: r, start: day(3), end: day(0), limit: 300 })

snap.schedules = await get('/schedules')
snap.tree = await get('/schedules/tree')
snap.batches = (await get('/batches', { page_size: 200 })).items

// 特征值：每个已发布 / 已下线算子最近 30 天
snap.values = {}
for (const o of snap.operators.filter((o) => o.status === 'published' || o.status === 'retired')) {
  const all = []
  for (let page = 1; page <= 5; page++) {
    const r = await get('/values', { operator: o.ref, from: day(30), to: day(0), page_size: 1000, page })
    all.push(...r.items)
    if (all.length >= r.total) break
  }
  snap.values[o.ref] = all
}

// 试跑：每个算子用其绑定 recipe 的一个最近执行试跑一次，离线时作为示例结果
snap.trials = {}
for (const o of snap.operators.filter((o) => o.status !== 'retired')) {
  const b = snap.bindings.find((x) => x.feature_id === o.feature_id && x.operator === o.name)
  const recipe = b?.active?.spec.recipes[0] || g.recipes[0]
  const run = (g.runs[recipe] || [])[0]
  if (!run) continue
  const r = await post(`/operators/${enc(o.feature_id)}/${enc(o.name)}/${o.version}/trial`, { run_id: run.run_id })
  if (r) snap.trials[o.ref] = r
}

writeFileSync(new URL('../src/api/offline-data.json', import.meta.url), JSON.stringify(snap))
console.log('快照已写入 src/api/offline-data.json：', snap.features.length, '个特征，', snap.operators.length, '个算子，',
  Object.values(snap.values).reduce((n, v) => n + v.length, 0), '个特征值')
