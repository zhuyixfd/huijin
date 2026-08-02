/** 后端 DATETIME 按北京时间（无时区后缀）存储与返回 */

export function parseApiDateTime(iso) {
  if (iso == null || iso === '') return null
  if (iso instanceof Date) return Number.isNaN(iso.getTime()) ? null : iso
  let s = String(iso).trim().replace(' ', 'T')
  if (!s) return null
  // 已有 Z / ±offset 的按标准解析
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // 无时区：按北京时间
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(`${s}T00:00:00+08:00`)
    return Number.isNaN(d.getTime()) ? null : d
  }
  // 补秒
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) s = `${s}:00`
  const d = new Date(`${s}+08:00`)
  return Number.isNaN(d.getTime()) ? null : d
}

export function fmtDateTime(iso) {
  if (!iso) return '—'
  const t = parseApiDateTime(iso)
  if (!t) return String(iso)
  return t.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

export function fmtDate(v) {
  if (!v) return '—'
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = parseApiDateTime(s)
  return t ? t.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }) : s
}
