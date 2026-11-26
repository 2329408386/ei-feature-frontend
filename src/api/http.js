// 统一请求封装：带 X-Client: console；错误统一 {code, message, details}，用 ElMessage 提示。
import { ElMessage } from 'element-plus'
import { reactive } from 'vue'
import { OFFLINE } from './offline-flag'

export const DEV_USER_SWITCH = import.meta.env.VITE_DEV_USER_SWITCH === 'true'
export const devUser = reactive({ name: localStorage.getItem('ei.devUser') || 'alice' })
export function setDevUser(name) {
  devUser.name = name
  localStorage.setItem('ei.devUser', name)
}

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`)
    this.status = status
    this.code = body?.code || 'HTTP_ERROR'
    this.details = body?.details || {}
  }
  /** SPEC_INVALID / BINDING_INVALID / VALIDATION_ERROR 的逐条错误 */
  get errors() {
    return Array.isArray(this.details.errors) ? this.details.errors : []
  }
}

function qs(params) {
  if (!params) return ''
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, x))
    else sp.append(k, v)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/**
 * @param {string} method
 * @param {string} path  不含 /api 前缀
 * @param {{params?: object, body?: any, silent?: boolean, raw?: boolean}} opts
 *   silent：出错时不弹提示（调用方自己展示，如逐条校验错误）
 */
export async function request(method, path, { params, body, silent = false, raw = false } = {}) {
  if (OFFLINE) return offline(method, path, { params, body, silent })
  const headers = { 'X-Client': 'console' }
  if (DEV_USER_SWITCH) headers['X-User'] = devUser.name
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let resp
  try {
    resp = await fetch(`/api${path}${qs(params)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    const err = new ApiError(0, { code: 'NETWORK', message: `无法连接服务：${e.message}` })
    if (!silent) ElMessage.error(err.message)
    throw err
  }
  if (raw && resp.ok) return resp
  if (resp.status === 204) return null
  const text = await resp.text()
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = { message: text }
  }
  if (!resp.ok) {
    const err = new ApiError(resp.status, data)
    if (!silent) {
      const extra = err.errors.length ? `（${err.errors.length} 处错误）` : ''
      ElMessage.error({ message: `${err.code}：${err.message}${extra}`, duration: 5000 })
    }
    throw err
  }
  return data
}

// 离线演示：offline.js 只在离线构建里被加载（内联进单个 HTML）
async function offline(method, path, { params, body, silent }) {
  const { offlineRequest } = await import('./offline.js')
  const clean = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== ''))
  const r = offlineRequest(method, path, clean, body)
  if (r && typeof r.status === 'number' && r.body?.code) {
    const err = new ApiError(r.status, r.body)
    if (!silent) ElMessage.warning(err.message)
    throw err
  }
  return r
}

export const get = (path, params, opts) => request('GET', path, { ...opts, params })
export const post = (path, body, opts) => request('POST', path, { ...opts, body })
export const del = (path, opts) => request('DELETE', path, opts)
