export function emptyFinishedOutput() {
  return { piece_code: '', spec: '', pieces: '', weight_return: '', return_date: '', remark: '' }
}

function toTrimmedOrNull(v) {
  const s = v === null || v === undefined ? '' : String(v)
  const t = s.trim()
  return t ? t : null
}

function toDateOrNull(v) {
  const s = v === null || v === undefined ? '' : String(v).trim()
  if (!s) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  return s
}

function toNumberOrNull(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function toIntOrNull(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const i = Math.trunc(n)
  return i
}

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function isSupParenContent(raw) {
  const t = String(raw ?? '').trim()
  if (!t) return false
  if (t.length > 8) return false
  return /^[0-9+\-a-zA-Z]+$/.test(t)
}

export function formatForgingSpecHtml(raw, emptyText = '—') {
  const s = raw === null || raw === undefined ? '' : String(raw)
  if (!s.trim()) return escapeHtml(emptyText ?? '')
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '^' && s[i + 1] !== '^') {
      const j = s.indexOf('^', i + 1)
      if (j !== -1) {
        const inner = s.slice(i + 1, j)
        out += `<sup>${escapeHtml(inner)}</sup>`
        i = j + 1
        continue
      }
      let k = i + 1
      let inner = ''
      while (k < s.length) {
        const ch = s[k]
        if (!/^[0-9+\-a-zA-Z]$/.test(ch)) break
        inner += ch
        if (inner.length >= 8) break
        k += 1
      }
      if (inner) {
        out += `<sup>${escapeHtml(inner)}</sup>`
        i = i + 1 + inner.length
        continue
      }
      out += escapeHtml('^')
      i += 1
      continue
    }
    if (s[i] === '^' && s[i + 1] === '^') {
      const j = s.indexOf('^^', i + 2)
      if (j !== -1) {
        const inner = s.slice(i + 2, j)
        out += `<sup>${escapeHtml(inner)}</sup>`
        i = j + 2
        continue
      }
      let k = i + 2
      let inner = ''
      while (k < s.length) {
        const ch = s[k]
        if (!/^[0-9+\-a-zA-Z]$/.test(ch)) break
        inner += ch
        if (inner.length >= 8) break
        k += 1
      }
      if (inner) {
        out += `<sup>${escapeHtml(inner)}</sup>`
        i = i + 2 + inner.length
        continue
      }
      out += escapeHtml('^^')
      i += 2
      continue
    }
    if (s[i] === '(') {
      const j = s.indexOf(')', i + 1)
      if (j !== -1) {
        const inner = s.slice(i + 1, j)
        if (isSupParenContent(inner)) {
          out += `<sup>${escapeHtml(inner.trim())}</sup>`
          i = j + 1
          continue
        }
      }
    }
    out += escapeHtml(s[i])
    i += 1
  }
  return out
}

export function formatForgingSpecPlain(raw, emptyText = '') {
  const s = raw === null || raw === undefined ? '' : String(raw)
  if (!s.trim()) return String(emptyText ?? '')
  let out = ''
  let i = 0
  while (i < s.length) {
    if (s[i] === '^' && s[i + 1] !== '^') {
      const j = s.indexOf('^', i + 1)
      if (j !== -1) {
        out += s.slice(i + 1, j)
        i = j + 1
        continue
      }
      let k = i + 1
      let inner = ''
      while (k < s.length) {
        const ch = s[k]
        if (!/^[0-9+\-a-zA-Z]$/.test(ch)) break
        inner += ch
        if (inner.length >= 8) break
        k += 1
      }
      if (inner) {
        out += inner
        i = i + 1 + inner.length
        continue
      }
      out += '^'
      i += 1
      continue
    }
    if (s[i] === '^' && s[i + 1] === '^') {
      const j = s.indexOf('^^', i + 2)
      if (j !== -1) {
        out += s.slice(i + 2, j)
        i = j + 2
        continue
      }
      let k = i + 2
      let inner = ''
      while (k < s.length) {
        const ch = s[k]
        if (!/^[0-9+\-a-zA-Z]$/.test(ch)) break
        inner += ch
        if (inner.length >= 8) break
        k += 1
      }
      if (inner) {
        out += inner
        i = i + 2 + inner.length
        continue
      }
      out += '^^'
      i += 2
      continue
    }
    if (s[i] === '(') {
      const j = s.indexOf(')', i + 1)
      if (j !== -1) {
        const inner = s.slice(i + 1, j)
        if (isSupParenContent(inner)) {
          out += inner.trim()
          i = j + 1
          continue
        }
      }
    }
    out += s[i]
    i += 1
  }
  return out
}

const SUPERSCRIPT_CHAR_MAP = {
  '0': '\u2070',
  '1': '\u00b9',
  '2': '\u00b2',
  '3': '\u00b3',
  '4': '\u2074',
  '5': '\u2075',
  '6': '\u2076',
  '7': '\u2077',
  '8': '\u2078',
  '9': '\u2079',
  '+': '\u207a',
  '-': '\u207b',
  '=': '\u207c',
  '(': '\u207d',
  ')': '\u207e',
  A: '\u1d2c',
  B: '\u1d2e',
  D: '\u1d30',
  E: '\u1d31',
  G: '\u1d33',
  H: '\u1d34',
  I: '\u1d35',
  J: '\u1d36',
  K: '\u1d37',
  L: '\u1d38',
  M: '\u1d39',
  N: '\u1d3a',
  O: '\u1d3c',
  P: '\u1d3e',
  R: '\u1d3f',
  T: '\u1d40',
  U: '\u1d41',
  V: '\u2c7d',
  W: '\u1d42',
  a: '\u1d43',
  b: '\u1d47',
  c: '\u1d9c',
  d: '\u1d48',
  e: '\u1d49',
  f: '\u1da0',
  g: '\u1d4d',
  h: '\u02b0',
  i: '\u2071',
  j: '\u02b2',
  k: '\u1d4f',
  l: '\u02e1',
  m: '\u1d50',
  n: '\u207f',
  o: '\u1d52',
  p: '\u1d56',
  r: '\u02b3',
  s: '\u02e2',
  t: '\u1d57',
  u: '\u1d58',
  v: '\u1d5b',
  w: '\u02b7',
  x: '\u02e3',
  y: '\u02b8',
  z: '\u1dbb',
}

function toSuperscriptText(raw) {
  let out = ''
  for (const ch of String(raw ?? '')) {
    out += SUPERSCRIPT_CHAR_MAP[ch] ?? ch
  }
  return out
}

export function formatForgingSpecCsv(raw, emptyText = '') {
  const plain = formatForgingSpecPlain(raw, emptyText)
  const source = raw === null || raw === undefined ? '' : String(raw)
  if (!source.trim()) return plain
  let out = ''
  let i = 0
  while (i < source.length) {
    if (source[i] === '^' && source[i + 1] !== '^') {
      const j = source.indexOf('^', i + 1)
      if (j !== -1) {
        out += toSuperscriptText(source.slice(i + 1, j))
        i = j + 1
        continue
      }
      let k = i + 1
      let inner = ''
      while (k < source.length) {
        const ch = source[k]
        if (!/^[0-9+\-a-zA-Z]$/.test(ch)) break
        inner += ch
        if (inner.length >= 8) break
        k += 1
      }
      if (inner) {
        out += toSuperscriptText(inner)
        i = i + 1 + inner.length
        continue
      }
      out += '^'
      i += 1
      continue
    }
    if (source[i] === '^' && source[i + 1] === '^') {
      const j = source.indexOf('^^', i + 2)
      if (j !== -1) {
        out += toSuperscriptText(source.slice(i + 2, j))
        i = j + 2
        continue
      }
      let k = i + 2
      let inner = ''
      while (k < source.length) {
        const ch = source[k]
        if (!/^[0-9+\-a-zA-Z]$/.test(ch)) break
        inner += ch
        if (inner.length >= 8) break
        k += 1
      }
      if (inner) {
        out += toSuperscriptText(inner)
        i = i + 2 + inner.length
        continue
      }
      out += '^^'
      i += 2
      continue
    }
    if (source[i] === '(') {
      const j = source.indexOf(')', i + 1)
      if (j !== -1) {
        const inner = source.slice(i + 1, j)
        if (isSupParenContent(inner)) {
          out += toSuperscriptText(inner.trim())
          i = j + 1
          continue
        }
      }
    }
    out += source[i]
    i += 1
  }
  return out || plain
}

export function normalizeFinishedOutputsForApi(rows) {
  const list = Array.isArray(rows) ? rows : []
  const out = []
  for (const r of list) {
    const piece_code = toTrimmedOrNull(r?.piece_code)
    const spec = toTrimmedOrNull(r?.spec)
    const piecesRaw = toIntOrNull(r?.pieces)
    const pieces = piecesRaw !== null && piecesRaw >= 1 ? piecesRaw : null
    const weight_return = toNumberOrNull(r?.weight_return)
    const return_date = toDateOrNull(r?.return_date)
    const remark = toTrimmedOrNull(r?.remark)
    const hasPieces = pieces !== null
    if (!piece_code && !spec && weight_return === null && !return_date && !remark && !hasPieces) continue
    out.push({ piece_code, spec, pieces, weight_return, return_date, remark })
  }
  return out.length ? out : null
}

export function parseFinishedOutputsFromItem(it) {
  const raw = it?.finished_outputs
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((x) => ({
      piece_code: x?.piece_code ?? '',
      spec: x?.spec ?? '',
      pieces: x?.pieces ?? '',
      weight_return: x?.weight_return ?? '',
      return_date: x?.return_date ?? '',
      remark: x?.remark ?? '',
    }))
  }
  return [
    {
      piece_code: '',
      spec: '',
      pieces: it?.quantity ?? '',
      weight_return: it?.weight_return ?? '',
      return_date: it?.return_date ?? '',
      remark: '',
    },
  ]
}

export function sumFinishedOutputWeights(rows) {
  const list = Array.isArray(rows) ? rows : []
  let total = 0
  let any = false
  for (const r of list) {
    const n = toNumberOrNull(r?.weight_return)
    if (n === null) continue
    total += n
    any = true
  }
  return any ? total : null
}

export function formatPieceCodeLabel(pieceCode) {
  const s = pieceCode === null || pieceCode === undefined ? '' : String(pieceCode).trim()
  return s ? s : '—'
}

export function expandOrdersToDeliveryLines(orderRows) {
  const rows = Array.isArray(orderRows) ? orderRows : []
  const out = []
  for (const it of rows) {
    const fos = Array.isArray(it?.finished_outputs) && it.finished_outputs.length
      ? it.finished_outputs
      : [{ spec: null, weight_return: it?.weight_return ?? null, remark: null, piece_code: null }]
    for (const fo of fos) {
      out.push({
        customer_name: it?.customer_name ?? it?.customer?.name ?? '',
        material_grade: it?.material_grade ?? '',
        spec_incoming: it?.spec_incoming ?? '',
        piece_code: fo?.piece_code ?? null,
        spec: fo?.spec ?? '',
        quantity: fo?.pieces ?? null,
        weight_incoming: it?.weight_incoming ?? null,
        weight_return: fo?.weight_return ?? it?.weight_return ?? null,
        return_date: fo?.return_date ?? it?.return_date ?? null,
        cut_head_weight: it?.cut_head_weight ?? null,
        forging_requirements: it?.forging_requirements ?? '',
        remark: (fo?.remark ?? it?.remark) ?? '',
      })
    }
  }
  return out
}

