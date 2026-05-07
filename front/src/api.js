import { authFetch, formatApiError } from './auth.js'

export async function parseJsonOrThrow(r) {
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    throw new Error(formatApiError(data) || `HTTP ${r.status}`)
  }
  return data
}

export function getJson(path) {
  return authFetch(path).then(parseJsonOrThrow)
}

export function postJson(path, body) {
  return authFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(parseJsonOrThrow)
}

export function patchJson(path, body) {
  return authFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then(parseJsonOrThrow)
}

export function deleteReq(path) {
  return authFetch(path, { method: 'DELETE' }).then((r) => {
    if (!r.ok && r.status !== 204) return parseJsonOrThrow(r)
    return null
  })
}
