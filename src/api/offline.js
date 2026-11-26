// 离线演示：用 offline-data.json（scripts/snapshot.mjs 抓取的快照）应答 /api 请求，不访问后端。
// 查询类接口在前端按参数过滤、分页；修改类接口一律返回 OFFLINE 错误（试跑返回快照里的示例结果）。
import SNAP from './offline-data.json'

const decode = decodeURIComponent
const has = (s, q) => String(s || '').toLowerCase().includes(String(q).toLowerCase())
const page = (items, p) => {
  const n = Number(p.page_size || 20)
  const i = Number(p.page || 1)
  return { items: items.slice((i - 1) * n, i * n), total: items.length, page: i, page_size: n }
}
// 快照时间与现在的差：日期参数按快照时间换算，过几周再打开也能看到数据
const SHIFT = Date.now() - new Date(SNAP.taken_at).getTime()
const shiftDate = (d, endOfDay) => (d ? new Date(new Date(`${d}T${endOfDay ? '23:59:59' : '00:00:00'}`).getTime() - SHIFT) : null)
const chambersMatch = (chs, p) =>
  !(p.tool || p.chamber) || (chs || []).some((c) => (!p.tool || c.tool === p.tool) && (!p.chamber || c.chamber === p.chamber))

function offlineError(message = '离线演示数据为快照，不能修改') {
  return { status: 409, body: { code: 'OFFLINE', message, details: {} } }
}
const notFound = (what) => ({ status: 404, body: { code: 'NOT_FOUND', message: `${what} 不存在（离线快照中没有）`, details: {} } })

const GET = [
  [/^\/features$/, (m, p) => page(SNAP.features.filter((f) =>
    (!p.status || f.status === p.status) && (!p.feature_id || f.feature_id === p.feature_id) &&
    (!p.tool || f.tools.includes(p.tool)) &&
    (!p.q || has(f.feature_id, p.q) || has(f.display_name, p.q) || has(f.description, p.q))), p)],
  [/^\/features\/tools$/, () => SNAP.tools],
  [/^\/features\/([^/]+)\/([^/]+)$/, (m) => SNAP.featureDetails[`${decode(m[1])}@${decode(m[2])}`] || notFound('特征')],
  [/^\/operators$/, (m, p) => page(SNAP.operators.filter((o) =>
    (!p.feature_id || o.feature_id === p.feature_id) && (!p.name || o.name === p.name) && (!p.status || o.status === p.status) &&
    (!p.q || has(o.name, p.q) || has(o.display_name, p.q) || has(o.description, p.q))), p)],
  [/^\/operators\/([^/]+)\/([^/]+)\/(\d+)$/, (m) => SNAP.operatorDetails[`${decode(m[1])}/${decode(m[2])}@${m[3]}`] || notFound('算子')],
  [/^\/bindings$/, (m, p) => ({ items: SNAP.bindings.filter((b) =>
    (!p.feature_id || b.feature_id === p.feature_id) && (!p.operator || has(b.operator, p.operator)) &&
    (!p.recipe || (b.active?.spec.recipes || []).includes(p.recipe)) &&
    (!p.status || (p.status === 'active' ? b.active : b.pending))) })],
  [/^\/bindings\/export$/, () => new Response(JSON.stringify(SNAP.export, null, 2), { headers: { 'Content-Type': 'application/json' } })],
  [/^\/bindings\/([^/]+)\/([^/]+)$/, (m) => SNAP.revisions[`${decode(m[1])}/${decode(m[2])}`] || { revisions: [] }],
  [/^\/gde\/fleets$/, () => SNAP.gde.fleets],
  [/^\/gde\/fleets\/([^/]+)\/chambers$/, (m) => SNAP.gde.fleetChambers[decode(m[1])] || notFound('fleet')],
  [/^\/gde\/recipes$/, (m, p) => SNAP.gde.recipes.filter((r) => !p.q || has(r, p.q)).slice(0, Number(p.limit || 50))],
  [/^\/gde\/recipes\/([^/]+)\/chambers$/, (m) => SNAP.gde.recipeChambers[decode(m[1])] || notFound('recipe')],
  [/^\/gde\/chambers\/([^/]+)\/recipes$/, (m) => SNAP.gde.chamberRecipes[decode(m[1])] || notFound('腔室')],
  [/^\/gde\/runs$/, (m, p) => [...(SNAP.gde.runs[p.recipe] || [])].filter((r) => !p.chamber || r.chamber === p.chamber).slice(0, Number(p.limit || 200))],
  [/^\/schedules$/, (m, p) => SNAP.schedules.filter((s) => (!p.recipe || has(s.recipe, p.recipe)) && chambersMatch(s.chambers, p))],
  [/^\/schedules\/tree$/, (m, p) => SNAP.tree
    .filter((f) => !p.feature_id || f.feature_id === p.feature_id)
    .map((f) => ({ ...f, operators: f.operators
      .map((o) => ({ ...o, recipes: o.recipes.filter((r) => (!p.recipe || has(r.recipe, p.recipe)) && chambersMatch(r.chambers, p)) }))
      .filter((o) => o.recipes.length) }))
    .filter((f) => f.operators.length)],
  [/^\/batches$/, (m, p) => page(SNAP.batches.filter((b) =>
    (!p.recipe || b.recipe === p.recipe) && (!p.mode || b.mode === p.mode) && (!p.status || b.status === p.status)), p)],
  [/^\/batches\/(\d+)$/, (m) => SNAP.batches.find((b) => b.batch_id === Number(m[1])) || notFound('批次')],
  [/^\/values$/, (m, p) => {
    const from = shiftDate(p.from)
    const to = shiftDate(p.to, true)
    return page((SNAP.values[p.operator] || []).filter((v) => {
      const t = new Date(v.run_end_at)
      return (!p.tool || v.tool === p.tool) && (!p.chamber || v.chamber === p.chamber) && (!p.recipe || v.recipe === p.recipe) &&
        (!from || t >= from) && (!to || t <= to) && (!p.only_null || v.value === null)
    }), { page_size: 100, ...p })
  }],
]

function trial(m, body) {
  const ref = `${decode(m[1])}/${decode(m[2])}@${m[3]}`
  const r = SNAP.trials[ref] || Object.values(SNAP.trials)[0]
  if (!r) return offlineError('离线快照中没有试跑示例')
  const run = Object.values(SNAP.gde.runs).flat().find((x) => x.run_id === body?.run_id)
  return { ...r, run: run ? { ...r.run, ...run } : { ...r.run, run_id: body?.run_id || r.run.run_id } }
}

/** 返回值：普通对象（成功的 JSON）、Response（raw 下载）或 {status, body}（错误） */
export function offlineRequest(method, path, params = {}, body) {
  if (method === 'GET') {
    for (const [re, fn] of GET) {
      const m = re.exec(path)
      if (m) return fn(m, params)
    }
    return notFound(path)
  }
  const t = /^\/operators\/([^/]+)\/([^/]+)\/(\d+)\/trial$/.exec(path)
  if (method === 'POST' && t) return trial(t, body)
  return offlineError()
}
