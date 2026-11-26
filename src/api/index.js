// 各领域接口，路径与 redesign.html 第 4 页第 5 节一致
import { get, post, del, request } from './http'

const patch = (path, body) => request('PATCH', path, { body })

const enc = encodeURIComponent
const fpath = (id, v) => `/features/${enc(id)}/${enc(v)}`
const opath = (fid, name, v) => `/operators/${enc(fid)}/${enc(name)}/${v}`
const bpath = (fid, op) => `/bindings/${enc(fid)}/${enc(op)}`

export const features = {
  list: (params) => get('/features', params),
  // 所有特征关联的机台（生效绑定的 recipe 经 GDE 反查），供筛选
  tools: () => get('/features/tools'),
  // 修改显示名称；feature_id 不变，不需要评审
  updateMeta: (id, body) => patch(`/features/${enc(id)}`, body),
  detail: (id, v) => get(fpath(id, v)),
  create: (spec, opts) => post('/features', spec, opts),
  // 删除：自己的草稿或已下线的；deleteImpact 先看影响范围（弹窗警告用）
  remove: (id, v) => del(fpath(id, v)),
  deleteImpact: (id, v) => request('DELETE', fpath(id, v), { params: { dry_run: true } }),
  // 重新上线（不再评审）；operators：随该特征下线的算子一并上线
  restore: (id, v, body) => post(`${fpath(id, v)}/restore`, body),
  submit: (id, v) => post(`${fpath(id, v)}/submit`),
  review: (id, v, body) => post(`${fpath(id, v)}/review`, body),
  retire: (id, v, reason) => post(`${fpath(id, v)}/retire`, { reason }),
}

export const operators = {
  list: (params) => get('/operators', params),
  // 修改显示名称；算子名不变，不需要评审
  updateMeta: (fid, name, body) => patch(`/operators/${enc(fid)}/${enc(name)}`, body),
  detail: (fid, name, v) => get(opath(fid, name, v)),
  create: (body, opts) => post('/operators', body, opts),
  remove: (fid, name, v) => del(opath(fid, name, v)),
  deleteImpact: (fid, name, v) => request('DELETE', opath(fid, name, v), { params: { dry_run: true } }),
  restore: (fid, name, v, body) => post(`${opath(fid, name, v)}/restore`, body),
  submit: (fid, name, v) => post(`${opath(fid, name, v)}/submit`),
  review: (fid, name, v, body) => post(`${opath(fid, name, v)}/review`, body),
  retire: (fid, name, v, reason) => post(`${opath(fid, name, v)}/retire`, { reason }),
  trial: (fid, name, v, run_id, opts) => post(`${opath(fid, name, v)}/trial`, { run_id }, opts),
}

export const gde = {
  fleets: () => get('/gde/fleets'),
  fleetChambers: (fleet, start, end) => get(`/gde/fleets/${enc(fleet)}/chambers`, { start, end }),
  recipes: (q, limit = 50) => get('/gde/recipes', { q, limit }),
  recipeChambers: (recipe) => get(`/gde/recipes/${enc(recipe)}/chambers`),
  chamberRecipes: (chamber, start, end) => get(`/gde/chambers/${enc(chamber)}/recipes`, { start, end }),
  runs: (params) => get('/gde/runs', params), // {recipe, chamber?, start?, end?, limit?}
}

export const bindings = {
  list: (params) => get('/bindings', params),
  revisions: (fid, op) => get(bpath(fid, op)),
  submit: (fid, op, body, opts) => post(bpath(fid, op), body, opts),
  review: (fid, op, rev, body) => post(`${bpath(fid, op)}/revisions/${rev}/review`, body),
  withdraw: (fid, op, rev) => post(`${bpath(fid, op)}/revisions/${rev}/withdraw`),
  exportFile: (params) => request('GET', '/bindings/export', { params, raw: true }),
  import: (doc, dryRun, opts) => request('POST', '/bindings/import', { ...opts, params: { dry_run: dryRun }, body: doc }),
}

export const schedules = {
  list: (params) => get('/schedules', params),
  // 特征 → 算子 → recipe → 机台 / 腔室
  tree: (params) => get('/schedules/tree', params),
  pause: (recipe) => post(`/schedules/${enc(recipe)}/pause`),
  resume: (recipe) => post(`/schedules/${enc(recipe)}/resume`),
}

export const batches = {
  list: (params) => get('/batches', params),
  get: (id) => get(`/batches/${id}`),
  create: (body, opts) => post('/batches', body, opts),
  cancel: (id) => post(`/batches/${id}/cancel`),
}

export const values = {
  list: (params) => get('/values', params),
}
