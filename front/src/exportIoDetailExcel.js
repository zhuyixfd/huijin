import { formatForgingSpecCsv } from './finishedOutputs.js'
import { parseApiDateTime } from './datetime.js'

function escapeHtml(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  const d = parseApiDateTime(iso)
  if (!d) return String(iso)
  const pad = (n) => String(n).padStart(2, '0')
  // 按北京时间输出
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const get = (t) => parts.find((p) => p.type === t)?.value || '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

function compareOrderNo(a, b) {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  const na = sa.match(/^([A-Za-z]+)(\d+)(?:-(\d+))?$/)
  const nb = sb.match(/^([A-Za-z]+)(\d+)(?:-(\d+))?$/)
  if (na && nb) {
    const c0 = na[1].localeCompare(nb[1])
    if (c0 !== 0) return c0
    const c1 = Number(na[2]) - Number(nb[2])
    if (c1 !== 0) return c1
    return Number(na[3] || 0) - Number(nb[3] || 0)
  }
  return sa.localeCompare(sb, 'zh')
}

function itemUnitCount(it) {
  const qty = Number(it?.quantity)
  if (Number.isFinite(qty) && qty >= 1) return Math.floor(qty)
  const fos = Array.isArray(it?.finished_outputs) ? it.finished_outputs : []
  let total = 0
  let any = false
  for (const fo of fos) {
    const pieces = Number(fo?.pieces)
    if (!Number.isFinite(pieces) || pieces < 1) continue
    total += Math.floor(pieces)
    any = true
  }
  if (any) return total
  return 1
}

function stripUnitCodeSuffix(code) {
  const s = String(code ?? '').trim()
  const m = s.match(/^(.*?)-(\d+)$/)
  return m ? m[1] : s
}

function buildUnitStatuses(it, qty) {
  if (!Number.isFinite(qty) || qty < 1) return []
  const fallback = String(it?.production_status ?? '').trim() || '在库中'
  const raw = Array.isArray(it?.unit_production_statuses) ? it.unit_production_statuses : null
  if (raw && raw.length === qty) return [...raw]
  const base = raw
    ? raw.map((s) => {
        const t = String(s ?? '').trim()
        return t || fallback
      })
    : []
  while (base.length < qty) base.push(fallback)
  return base.slice(0, qty)
}

function expandOutputsByPiece(it, units) {
  const raw =
    Array.isArray(it?.finished_outputs) && it.finished_outputs.length
      ? it.finished_outputs
      : [
          {
            spec: '',
            pieces: units,
            weight_return: it?.weight_return ?? null,
            return_date: it?.return_date ?? null,
            remark: '',
          },
        ]
  const out = []
  for (const fo of raw) {
    const rawPieces = Number(fo?.pieces)
    const pieces = Number.isFinite(rawPieces) && rawPieces >= 1 ? Math.floor(rawPieces) : 1
    for (let i = 0; i < pieces; i += 1) {
      out.push({
        spec: String(fo?.spec ?? '').trim(),
        return_date: String(fo?.return_date ?? '').trim(),
        weight_return: fo?.weight_return ?? '',
        remark: String(fo?.remark ?? '').trim(),
      })
    }
  }
  return out
}

function downloadExcelHtml(filename, html) {
  const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * 导出客户出入明细 Excel（与处理中「数据导出」列结构一致）
 * @param {object} opts
 * @param {string} opts.customerName
 * @param {Array<object>} opts.items
 * @param {string} [opts.fileName]
 * @param {number} [opts.headerYear]
 */
export function exportIoDetailExcel({ customerName, items, fileName, headerYear }) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) {
    throw new Error('无可导出数据')
  }

  const expandedRows = []
  const itemsSorted = [...list].sort((a, b) => {
    const cmp = compareOrderNo(a.order_no, b.order_no)
    if (cmp !== 0) return cmp
    return Number(a.id) - Number(b.id)
  })

  for (const it of itemsSorted) {
    const units = itemUnitCount(it)
    const codes = Array.isArray(it?.processing_unit_codes) ? it.processing_unit_codes : []
    const unitStatuses = buildUnitStatuses(it, units)
    const byPiece = expandOutputsByPiece(it, units)
    for (let u = 0; u < units; u += 1) {
      const fo = byPiece[u] ?? byPiece[byPiece.length - 1] ?? {}
      const unitStatus = String(unitStatuses[u] ?? it.production_status ?? '在库中')
      expandedRows.push([
        String(it?.id ?? '').trim() || '—',
        String(it?.incoming_date ?? '').trim() || '—',
        fmtDateTime(it?.order_created_at),
        String(it?.incoming_no ?? '').trim() || '—',
        String(it?.material_grade ?? '').trim() || '—',
        String(it?.spec_incoming ?? '').trim() || '—',
        String(it?.weight_incoming ?? '').trim() || '—',
        String(codes[u] ?? '').trim() || '—',
        unitStatus || '—',
        String(fo?.spec ?? '').trim() || '—',
        String(it?.remark ?? '').trim() || '—',
        String(it?.forging_requirements ?? '').trim() || '—',
        String(fo?.return_date ?? '').trim() || '—',
        String(fo?.weight_return ?? '').trim() || '—',
        String(fo?.remark ?? '').trim() || '—',
      ])
    }
  }

  if (expandedRows.length === 0) {
    throw new Error('无可导出数据')
  }

  const headers = [
    '明细ID',
    '来料日期',
    '下单时间',
    '炉号',
    '材质',
    '来料规格',
    '来料重量',
    '件号',
    '生产状态',
    '锻造规格',
    '锻造备注',
    '锻造要求',
    '送回日期',
    '送回重量',
    '分支备注',
  ]

  const mergeable = (v) => {
    const s = String(v ?? '').trim()
    if (!s) return false
    if (s === '—' || s === '-') return false
    return true
  }

  const mergeCols = new Set([0, 1, 2, 3, 4, 5, 6, 10, 11])
  const spansByCol = new Map()
  const rowPieceGroups = expandedRows.map((r) => {
    const g = stripUnitCodeSuffix(r?.[7] ?? '')
    if (!g || g === '—' || g === '-') return ''
    return g
  })
  for (const colIdx of mergeCols) {
    const spans = Array.from({ length: expandedRows.length }, () => 1)
    let i = 0
    while (i < expandedRows.length) {
      const val = expandedRows[i][colIdx]
      const groupKey = rowPieceGroups[i]
      if (!mergeable(val) || !groupKey) {
        i += 1
        continue
      }
      let j = i + 1
      while (
        j < expandedRows.length &&
        expandedRows[j][colIdx] === val &&
        rowPieceGroups[j] === groupKey
      ) {
        j += 1
      }
      const len = j - i
      spans[i] = len
      for (let k = i + 1; k < j; k += 1) spans[k] = 0
      i = j
    }
    spansByCol.set(colIdx, spans)
  }

  const name = String(customerName ?? '').trim() || '—'
  const year = headerYear ?? new Date().getFullYear()
  const today = new Date()
  const mm = String(today.getMonth() + 1).padStart(2, '0')
  const dd = String(today.getDate()).padStart(2, '0')
  const outName =
    String(fileName ?? '').trim() || `${name}-出入明细-${year}${mm}${dd}.xls`

  const css = `
      table{border-collapse:collapse;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:12pt}
      td,th{border:1px solid #333;padding:4px 6px;vertical-align:middle}
      th{background:#f3f3f3;font-weight:700;text-align:center;white-space:nowrap}
      .head td{font-weight:700}
      .num{text-align:right}
    `

  const buildRow = (cells, rowIndex) => {
    let tds = ''
    for (let c = 0; c < cells.length; c += 1) {
      const v = cells[c]
      const isNum = c === 6 || c === 13
      const spanArr = spansByCol.get(c)
      if (spanArr) {
        const span = spanArr[rowIndex]
        if (span === 0) continue
        const rs = span > 1 ? ` rowspan="${span}"` : ''
        if (c === 9) {
          tds += `<td${rs}${isNum ? ' class="num"' : ''}>${escapeHtml(formatForgingSpecCsv(v, '—'))}</td>`
        } else {
          tds += `<td${rs}${isNum ? ' class="num"' : ''}>${escapeHtml(v)}</td>`
        }
        continue
      }
      if (c === 9) {
        tds += `<td${isNum ? ' class="num"' : ''}>${escapeHtml(formatForgingSpecCsv(v, '—'))}</td>`
      } else {
        tds += `<td${isNum ? ' class="num"' : ''}>${escapeHtml(v)}</td>`
      }
    }
    return `<tr>${tds}</tr>`
  }

  const head1 = `<tr class="head"><td>客户</td><td colspan="7">${escapeHtml(name)}</td><td colspan="4">${escapeHtml(year)}</td><td colspan="3">计量单位:kg</td></tr>`
  const head2 = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
  const body = expandedRows.map((r, idx) => buildRow(r, idx)).join('')
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body><table>${head1}${head2}${body}</table></body></html>`
  downloadExcelHtml(outName, html)
}
