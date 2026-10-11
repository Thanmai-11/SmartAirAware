const BASE = import.meta.env.VITE_API_BASE ?? ''

export class ApiError extends Error {
  constructor(status, message, fields = {}) {
    super(message)
    this.status = status
    this.fields = fields
  }
}

function parseDetail(detail) {
  if (typeof detail === 'string') return { message: detail, fields: {} }
  if (Array.isArray(detail)) {
    const fields = {}
    const parts = detail.map((d) => {
      const loc = Array.isArray(d.loc) ? d.loc.filter((x) => x !== 'body') : []
      const name = String(loc[loc.length - 1] ?? '')
      if (name) fields[name] = d.msg
      return name ? `${name}: ${d.msg}` : d.msg
    })
    return { message: parts.join('; '), fields }
  }
  return { message: 'The request was rejected.', fields: {} }
}

async function request(path, { method = 'GET', body, form, adminKey, allow404 = false } = {}) {
  const headers = {}
  if (adminKey) headers['X-Admin-Key'] = adminKey
  let payload
  if (form) payload = form
  else if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
    payload = JSON.stringify(body)
  }
  let res
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: payload })
  } catch {
    throw new ApiError(0, 'Cannot reach the server.')
  }
  if (allow404 && res.status === 404) return null
  if (!res.ok) {
    let data = null
    try { data = await res.json() } catch { /* not json */ }
    if (res.status === 401 || res.status === 403)
      throw new ApiError(res.status, 'Admin key is missing or wrong.')
    const { message, fields } = parseDetail(data?.detail)
    throw new ApiError(res.status, message || `Request failed (${res.status}).`, fields)
  }
  if (res.status === 204) return null
  return res.json()
}

export const csvUrl = `${BASE}/api/schedule/latest.csv`

export const api = {
  health:      ()        => request('/api/health'),
  schedule:    ()        => request('/api/schedule/latest', { allow404: true }),
  forecast:    ()        => request('/api/forecast/latest', { allow404: true }),
  runs:        ()        => request('/api/runs', { allow404: true }),
  settings:    ()        => request('/api/settings'),
  occupancy:   ()        => request('/api/occupancy'),
  putSettings: (key, b)  => request('/api/settings', { method: 'PUT', body: b, adminKey: key }),
  putOccupancy:(key, b)  => request('/api/occupancy', { method: 'PUT', body: b, adminKey: key }),
  runNow:      (key)     => request('/api/run', { method: 'POST', adminKey: key }),
}
