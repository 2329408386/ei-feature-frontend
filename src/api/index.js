// 各领域接口，路径与 redesign.html 第 4 页第 5 节一致
import { get, post, del, request } from './http'

const enc = encodeURIComponent
const fpath = (id, v) => `/features/${enc(id)}/${enc(v)}`
const opath = (fid, name, v) => `/operators/${enc(fid)}/${enc(name)}/${v}`
const bpath = (fid, op) => `/bindings/${enc(fid)}/${enc(op)}`

export const features = {
  list: (params) => get('/features', params),
  detail: (id, v) => get(fpath(id, v)),
  create: (spec, opts) => post('/features', spec, opts),
  remove: (id, v) => del(fpath(id, v)),
  submit: (id, v) => post(`${fpath(id, v)}/submit`),
  review: (id, v, body) => post(`${fpath(id, v)}/review`, body),
  retire: (id, v, reason) => post(`${fpath(id, v)}/retire`, { reason }),
}

export const operators = {
  list: (params) => get('/operators', params),
  detail: (fid, name, v) => get(opath(fid, name, v)),
  create: (body, opts) => post('/operators', body, opts),
  remove: (fid, name, v) => del(opath(fid, name, v)),
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
  pause: (chamber) => post(`/schedules/${enc(chamber)}/pause`),
  resume: (chamber) => post(`/schedules/${enc(chamber)}/resume`),
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
