/**
 * 出库送货单：按收货单位（客户名称）拆分多页；模态框内可编辑后打印（不写入数据库）；支持导出 Excel。
 */

import {
  expandOrdersToDeliveryLines,
  formatForgingSpecHtml,
} from './finishedOutputs.js'

const slipCss = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Roboto, "PingFang SC", sans-serif; padding: 16px; color: #111; background: #fff; }
  .delivery-sheet { page-break-after: always; max-width: 900px; margin: 0 auto; }
  .delivery-sheet:last-child { page-break-after: auto; }
  .company-title { font-size: 18px; font-weight: 700; text-align: center; letter-spacing: 0.12em; margin: 0 0 6px; }
  .delivery-huge { font-size: 32px; font-weight: 800; text-align: center; letter-spacing: 0.35em; margin: 6px 0 18px; }
  .delivery-meta-grid { width: 100%; border-collapse: collapse; table-layout: fixed; margin: 0 0 12px; font-size: 14px; }
  .delivery-meta-grid td { border: none; padding: 0 4px 4px; vertical-align: bottom; }
  .delivery-meta-grid .serial-cell { text-align: right; white-space: nowrap; mso-number-format:"\\@"; }
  .delivery-meta-grid .consignee-cell { text-align: left; }
  .delivery-meta-grid .date-cell { text-align: right; white-space: nowrap; }
  .delivery-serial { color: #c00; font-weight: 800; mso-number-format:"\\@"; }
  table.delivery-grid { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  table.delivery-grid th, table.delivery-grid td { border: 1px solid #333; padding: 6px 8px; vertical-align: middle; word-break: break-word; }
  table.delivery-grid th { background: #eee; font-weight: 600; text-align: center; }
  table.delivery-grid td.num { text-align: center; }
  table.delivery-grid tr.total-row td { font-weight: 700; background: #fafafa; }
  .delivery-sign { display: flex; justify-content: space-between; margin-top: 28px; font-size: 14px; padding: 0 8px; }
  @media print {
    body { padding: 0; }
    @page { margin: 12mm; size: A4 portrait; }
  }
`

function esc(s) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/** 2026年5月7日 */
function fmtCnDate(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d)
  return `${t.getFullYear()}年${t.getMonth() + 1}月${t.getDate()}日`
}

function weightCell(it) {
  const w = it.weight_return ?? it.weight_incoming
  if (w === null || w === undefined || w === '') return '—'
  return String(w)
}

function returnDateCell(it) {
  const d = it?.return_date
  if (!d) return '—'
  const s = String(d)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? s : t.toLocaleDateString('zh-CN')
}

const DELIVERY_SLIP_SERIAL_STORAGE_KEY = 'delivery_slip.serial.v1'

function padDeliverySlipSerial(n) {
  const v = Number(n)
  if (!Number.isFinite(v) || v < 1) return '0000001'
  return String(Math.trunc(v)).padStart(7, '0')
}

function loadDeliverySlipSerialState() {
  try {
    if (typeof window === 'undefined') {
      return { nextSerial: 1, lastFingerprint: '', lastSerial: 0 }
    }
    const raw = window.localStorage.getItem(DELIVERY_SLIP_SERIAL_STORAGE_KEY)
    if (!raw) return { nextSerial: 1, lastFingerprint: '', lastSerial: 0 }
    const parsed = JSON.parse(raw)
    const nextSerial = Number(parsed?.nextSerial)
    const lastSerial = Number(parsed?.lastSerial)
    return {
      nextSerial: Number.isFinite(nextSerial) && nextSerial >= 1 ? Math.trunc(nextSerial) : 1,
      lastFingerprint: String(parsed?.lastFingerprint ?? ''),
      lastSerial: Number.isFinite(lastSerial) && lastSerial >= 1 ? Math.trunc(lastSerial) : 0,
    }
  } catch {
    return { nextSerial: 1, lastFingerprint: '', lastSerial: 0 }
  }
}

function saveDeliverySlipSerialState(state) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(DELIVERY_SLIP_SERIAL_STORAGE_KEY, JSON.stringify(state))
  } catch {
    return
  }
}

function buildDeliverySlipSourceFingerprint(outboundRows) {
  const rows = Array.isArray(outboundRows) ? [...outboundRows] : []
  rows.sort((a, b) => {
    const ida = Number(a?.id) || 0
    const idb = Number(b?.id) || 0
    if (ida !== idb) return ida - idb
    return String(a?.order_no ?? '').localeCompare(String(b?.order_no ?? ''), 'zh-CN')
  })
  const payload = rows.map((r) => ({
    id: r?.id ?? null,
    order_no: r?.order_no ?? '',
    customer_name: r?.customer_name ?? '',
    material_grade: r?.material_grade ?? '',
    spec_incoming: r?.spec_incoming ?? '',
    weight_incoming: r?.weight_incoming ?? null,
    quantity: r?.quantity ?? null,
    weight_return: r?.weight_return ?? null,
    cut_head_weight: r?.cut_head_weight ?? null,
    forging_requirements: r?.forging_requirements ?? '',
    remark: r?.remark ?? '',
    production_status: r?.production_status ?? '',
    processing_unit_codes: Array.isArray(r?.processing_unit_codes) ? r.processing_unit_codes : [],
    unit_production_statuses: Array.isArray(r?.unit_production_statuses) ? r.unit_production_statuses : [],
    finished_outputs: Array.isArray(r?.finished_outputs)
      ? r.finished_outputs.map((fo) => ({
          spec: fo?.spec ?? '',
          pieces: fo?.pieces ?? null,
          weight_return: fo?.weight_return ?? null,
          return_date: fo?.return_date ?? null,
          remark: fo?.remark ?? '',
          piece_code: fo?.piece_code ?? null,
        }))
      : [],
  }))
  return JSON.stringify(payload)
}

function resolveDeliverySlipSerial(outboundRows) {
  const fingerprint = buildDeliverySlipSourceFingerprint(outboundRows)
  const state = loadDeliverySlipSerialState()
  if (fingerprint && fingerprint === state.lastFingerprint && state.lastSerial >= 1) {
    return { fingerprint, serial: state.lastSerial, shouldCommit: false }
  }
  return { fingerprint, serial: state.nextSerial, shouldCommit: true }
}

function commitDeliverySlipSerial(fingerprint, serial) {
  const state = loadDeliverySlipSerialState()
  const serialInt = Number.isFinite(Number(serial)) && Number(serial) >= 1 ? Math.trunc(Number(serial)) : 1
  if (fingerprint && fingerprint === state.lastFingerprint && state.lastSerial === serialInt) return
  saveDeliverySlipSerialState({
    nextSerial: Math.max(Number(state.nextSerial) || 1, serialInt + 1),
    lastFingerprint: String(fingerprint ?? ''),
    lastSerial: serialInt,
  })
}

/** @param {Array<{ customer_name?: string }>} rows */
function groupByConsignee(rows) {
  const m = new Map()
  for (const r of rows) {
    const name = String(r.customer_name ?? '').trim() || '—'
    if (!m.has(name)) m.set(name, [])
    m.get(name).push(r)
  }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'))
}

function buildDeliveryColgroup() {
  const widths = ['34%', '10%', '14%', '26%', '16%']
  return `<colgroup>${widths.map((w) => `<col style="width:${w}" />`).join('')}</colgroup>`
}

function buildBlankBodyRow() {
  const cols = 5
  const tds = Array.from({ length: cols }, () => '<td>&nbsp;</td>').join('')
  return `<tr>${tds}</tr>`
}

function buildBlankSheetHtml({ serialDisplay, sheetDateStr }) {
  const colgroup = buildDeliveryColgroup()
  const totalCols = 5
  const rightCols = 2
  const leftCols = totalCols - rightCols
  const blankRow = buildBlankBodyRow()
  const blankRows = Array.from({ length: 12 }, () => blankRow).join('')
  const totalTailColSpan = 2
  return `
<section class="delivery-sheet">
  <div class="company-title">江阴市汇金机械有限公司</div>
  <div class="delivery-huge">送货单</div>
  <table class="delivery-meta-grid" aria-hidden="true">
    ${colgroup}
    <tbody>
      <tr>
        <td colspan="${leftCols}"></td>
        <td colspan="${rightCols}" class="serial-cell"><span class="delivery-serial">${esc(serialDisplay || '')}</span></td>
      </tr>
      <tr>
        <td colspan="${leftCols}" class="consignee-cell">收货单位名称：</td>
        <td colspan="${rightCols}" class="date-cell">${esc(sheetDateStr || '')}</td>
      </tr>
    </tbody>
  </table>
  <table class="delivery-grid">
    ${colgroup}
    <thead>
      <tr>
        <th>成品规格</th>
        <th>支数</th>
        <th>发回重量</th>
        <th>备注</th>
        <th>发回日期</th>
      </tr>
    </thead>
    <tbody>
      ${blankRows}
      <tr class="total-row">
        <td>合计</td>
        <td class="num"></td>
        <td class="num"></td>
        <td colspan="${totalTailColSpan}"></td>
      </tr>
    </tbody>
  </table>
  <div class="delivery-sign">
    <span>收货人签章：</span>
    <span>制单：</span>
  </div>
</section>`
}

function buildOneSheet(consignee, items, sheetDateStr, serialDisplay) {
  let qtySum = 0
  let anyQty = false
  let weightSum = 0
  let anyWeight = false
  const colgroup = buildDeliveryColgroup()
  const totalCols = 5
  const rightCols = 2
  const leftCols = totalCols - rightCols
  const body = items
    .map((it) => {
      const qtyRaw = it.quantity
      const qtyText =
        qtyRaw === null || qtyRaw === undefined || String(qtyRaw).trim() === '' ? '' : String(qtyRaw)
      const qtyNum = Number.parseInt(String(qtyRaw ?? '').trim(), 10)
      if (Number.isFinite(qtyNum)) {
        qtySum += qtyNum
        anyQty = true
      }
      const w = it.weight_return
      const wn = parseFloat(String(w ?? '').replace(/,/g, ''))
      if (Number.isFinite(wn)) {
        weightSum += wn
        anyWeight = true
      }
      const note = it.remark ?? ''
      return `<tr>
      <td>${formatForgingSpecHtml(it.spec || '', '—')}</td>
      <td class="num">${esc(qtyText)}</td>
      <td class="num">${esc(weightCell(it))}</td>
      <td>${esc(note)}</td>
      <td class="num">${esc(returnDateCell(it))}</td>
    </tr>`
    })
    .join('')

  const totalTailColSpan = 2
  const qtyTotalCell = anyQty ? esc(String(qtySum)) : ''
  const weightTotalCell = anyWeight ? esc(String(weightSum)) : ''
  return `
<section class="delivery-sheet">
  <div class="company-title">江阴市汇金机械有限公司</div>
  <div class="delivery-huge">送货单</div>
  <table class="delivery-meta-grid" aria-hidden="true">
    ${colgroup}
    <tbody>
      <tr>
        <td colspan="${leftCols}"></td>
        <td colspan="${rightCols}" class="serial-cell"><span class="delivery-serial">${esc(serialDisplay || '')}</span></td>
      </tr>
      <tr>
        <td colspan="${leftCols}" class="consignee-cell">收货单位名称：${esc(consignee)}</td>
        <td colspan="${rightCols}" class="date-cell">${esc(sheetDateStr)}</td>
      </tr>
    </tbody>
  </table>
  <table class="delivery-grid">
    ${colgroup}
    <thead>
      <tr>
        <th>成品规格</th>
        <th>支数</th>
        <th>发回重量</th>
        <th>备注</th>
        <th>发回日期</th>
      </tr>
    </thead>
    <tbody>
      ${body}
      <tr class="total-row">
        <td>合计</td>
        <td class="num">${qtyTotalCell}</td>
        <td class="num">${weightTotalCell}</td>
        <td colspan="${totalTailColSpan}"></td>
      </tr>
    </tbody>
  </table>
  <div class="delivery-sign">
    <span>收货人签章：</span>
    <span>制单：</span>
  </div>
</section>`
}

export function buildDeliverySlipHtml(rows, options = {}) {
  const serialDisplay =
    options.serialDisplay ??
    (Number.isFinite(Number(options.serialNumber))
      ? padDeliverySlipSerial(options.serialNumber)
      : '')
  const sheetDateStr = options.dateLabel ?? fmtCnDate(options.date ?? new Date())
  if (options.blankTemplate) {
    return buildBlankSheetHtml({ serialDisplay, sheetDateStr })
  }
  const groups = groupByConsignee(rows)
  return groups
    .map(([name, items]) => buildOneSheet(name, items, sheetDateStr, serialDisplay))
    .join('\n')
}

export function buildDeliverySlipDocument(rows, options = {}) {
  const inner = buildDeliverySlipHtml(rows, options)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>送货单</title><style>${slipCss}</style></head><body>${inner}</body></html>`
}

/** 从任务列表行得到可编辑送货单行（按成品展开，一行一件） */
export function normalizeDeliveryDraftRows(orderRows) {
  return expandOrdersToDeliveryLines(orderRows)
}

/** @param {ReturnType<normalizeDeliveryDraftRow>[]} rows */
function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function buildDeliveryCsvLines(
  rows,
  { blank = false, serialDisplay = '', sheetDateStr = '' } = {},
) {
  const headers = [
    '成品规格',
    '支数',
    '发回重量',
    '备注',
    '发回日期',
  ]
  const colN = headers.length
  const makeRow = (cells) => {
    const a = Array.from({ length: colN }, (_, i) => (cells?.[i] ?? ''))
    return a.map(csvEscape).join(',')
  }
  const makeSpanRow = (text) => makeRow([text, ...Array(Math.max(0, colN - 1)).fill('')])
  const lines = []

  const groups = blank ? [['', []]] : groupByConsignee(rows)
  for (let gi = 0; gi < groups.length; gi += 1) {
    const [consignee, items] = groups[gi]
    lines.push(makeSpanRow('江阴市汇金机械有限公司'))
    lines.push(makeSpanRow('送货单'))
    lines.push(makeRow(Array(colN).fill('').map((v, i) => (i === colN - 1 ? serialDisplay : v))))
    lines.push(
      makeRow(
        Array(colN)
          .fill('')
          .map((v, i) => {
            if (i === 0) return consignee ? `收货单位名称：${consignee}` : '收货单位名称：'
            if (i === colN - 1) return sheetDateStr || ''
            return v
          }),
      ),
    )
    lines.push(headers.map(csvEscape).join(','))
    if (!blank) {
      for (const r of items) {
        const w = r.weight_return ?? ''
        lines.push(
          makeRow([
            r.spec ?? '',
            r.quantity ?? '',
            w,
            r.remark ?? '',
            r.return_date ?? '',
          ]),
        )
      }
    }
    if (gi !== groups.length - 1) lines.push('')
  }
  return lines
}

export function exportDeliveryRowsToExcel(rows, options = {}) {
  const html = buildDeliverySlipDocument(rows, {
    showCutHeadCol: false,
    date: options.date,
    dateLabel: options.dateLabel,
    serialNumber: options.serialNumber,
    blankTemplate: Boolean(options.blankTemplate),
  })
  const blob = new Blob(['\ufeff' + html], {
    type: 'application/vnd.ms-excel;charset=utf-8;',
  })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = `${options.blankTemplate ? '送货单空模板' : '送货单'}_${new Date().toISOString().slice(0, 10)}.xls`
  a.click()
  URL.revokeObjectURL(url)
}

export function exportDeliveryRowsToCsv(rows, options = {}) {
  const sheetDateStr = options.dateLabel ?? fmtCnDate(options.date ?? new Date())
  const serialDisplay = Number.isFinite(Number(options.serialNumber))
    ? padDeliverySlipSerial(options.serialNumber)
    : ''
  const lines = buildDeliveryCsvLines(rows, {
    blank: false,
    serialDisplay,
    sheetDateStr,
  })
  const blob = new Blob(['\ufeff' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = `送货单_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function exportDeliveryBlankTemplateCsv() {
  const lines = buildDeliveryCsvLines([], {
    blank: true,
    serialDisplay: '编号',
    sheetDateStr: '日期',
  })
  const blob = new Blob(['\ufeff' + lines.join('\n')], {
    type: 'text/csv;charset=utf-8;',
  })
  const a = document.createElement('a')
  const url = URL.createObjectURL(blob)
  a.href = url
  a.download = `送货单空模板_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const STYLE_ID = 'delivery-slip-modal-styles'

function ensureModalStyles() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
.delivery-print-modal-backdrop { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
.delivery-print-modal { background: #fff; border-radius: 10px; width: min(900px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,.25); overflow: hidden; }
.delivery-print-toolbar { flex: 0 0 auto; padding: 10px 12px; border-bottom: 1px solid var(--border, #ddd); display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; align-items: center; position: relative; padding-left: 2.5rem; }
.delivery-print-toolbar .delivery-print-btn-close { position: absolute; left: 8px; top: 50%; transform: translateY(-50%); }
.delivery-print-toolbar .btn { font: inherit; padding: 0.45rem 0.9rem; border-radius: 8px; border: 1px solid #ccc; background: #f4f4f5; cursor: pointer; }
.delivery-print-toolbar .delivery-print-btn-print { background: #2563eb; color: #fff; border-color: #1d4ed8; }
.delivery-print-toolbar .delivery-print-hint { margin-right: auto; font-size: 13px; color: #555; }
.delivery-edit-scroll { flex: 1 1 auto; overflow: auto; padding: 12px; min-height: 200px; }
.delivery-edit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.delivery-edit-table th, .delivery-edit-table td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: middle; }
.delivery-edit-table th { background: #f5f5f5; text-align: left; white-space: nowrap; }
.delivery-edit-table input, .delivery-edit-table textarea { width: 100%; box-sizing: border-box; font: inherit; border: none; background: transparent; padding: 4px; }
.delivery-edit-table textarea { min-height: 2.5rem; resize: vertical; }
.delivery-edit-actions { flex: 0 0 auto; padding: 8px 12px; border-top: 1px solid var(--border, #ddd); display: flex; justify-content: flex-start; gap: 8px; }
.delivery-edit-table tr.delivery-row-invalid input, .delivery-edit-table tr.delivery-row-invalid textarea { outline: 2px solid #ef4444; outline-offset: -1px; border-radius: 2px; }
.delivery-print-frame { flex: 0 0 auto; width: 100%; height: 0; border: none; visibility: hidden; position: absolute; left: -9999px; }
`
  document.head.appendChild(el)
}

function readDraftFromTable(tbody) {
  const out = []
  for (const tr of tbody.querySelectorAll('tr[data-delivery-row]')) {
    const g = (name) => tr.querySelector(`[name="${name}"]`)?.value ?? ''
    out.push({
      customer_name: g('customer_name'),
      spec: g('spec'),
      quantity: g('quantity') || null,
      weight_return: g('weight_return') || null,
      remark: g('remark'),
      return_date: g('return_date') || null,
    })
  }
  return out
}

function appendDraftRow(tbody, row) {
  const r = row || {}
  const tr = document.createElement('tr')
  tr.dataset.deliveryRow = '1'
  tr.innerHTML = `
    <td><input type="text" name="spec" autocomplete="off" /></td>
    <td><input type="number" name="quantity" min="1" autocomplete="off" /></td>
    <td><input type="text" name="weight_return" autocomplete="off" /></td>
    <td><input type="text" name="remark" autocomplete="off" /></td>
    <td><input type="date" name="return_date" autocomplete="off" /></td>
    <td class="cell-nowrap"><button type="button" class="btn btn-ghost delivery-row-del">删除</button></td>
    <td style="display:none"><input type="hidden" name="customer_name" /></td>
  `
  tr.querySelector('[name="customer_name"]').value = r.customer_name ?? ''
  tr.querySelector('[name="spec"]').value = r.spec ?? ''
  tr.querySelector('[name="quantity"]').value =
    r.quantity === null || r.quantity === undefined ? '' : String(r.quantity)
  tr.querySelector('[name="weight_return"]').value =
    r.weight_return === null || r.weight_return === undefined ? '' : String(r.weight_return)
  tr.querySelector('[name="remark"]').value = r.remark ?? ''
  tr.querySelector('[name="return_date"]').value =
    r.return_date === null || r.return_date === undefined ? '' : String(r.return_date).slice(0, 10)
  tr.querySelector('.delivery-row-del').addEventListener('click', () => {
    tr.remove()
  })
  tbody.appendChild(tr)
  return tr
}

/** @param {Array<object>} outboundRows 出库中明细（任务列表行，含 customer_name） */
export function openDeliverySlipPreview(outboundRows) {
  if (!outboundRows?.length) {
    window.alert('暂无出库中单据')
    return false
  }
  ensureModalStyles()
  const draft = normalizeDeliveryDraftRows(outboundRows)
  const serialSession = resolveDeliverySlipSerial(outboundRows)
  let serialNeedsCommit = serialSession.shouldCommit

  function markSerialCommitted() {
    if (!serialNeedsCommit) return
    commitDeliverySlipSerial(serialSession.fingerprint, serialSession.serial)
    serialNeedsCommit = false
  }

  const backdrop = document.createElement('div')
  backdrop.className = 'delivery-print-modal-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-label', '送货单预览与编辑')
  backdrop.innerHTML =
    '<div class="delivery-print-modal">' +
    '<div class="delivery-print-toolbar">' +
    '<span class="delivery-print-hint">以下为送货单预览数据，可直接修改；修改仅用于本次导出，不会保存到系统。</span>' +
    '<button type="button" class="btn delivery-print-btn-export-xls">导出送货单</button>' +
    '<button type="button" class="btn delivery-print-btn-export-blank">导出空模板</button>' +
    '<button type="button" class="modal-close-x delivery-print-btn-close" aria-label="关闭">×</button>' +
    '</div>' +
    '<div class="delivery-edit-scroll">' +
    '<table class="delivery-edit-table"><thead><tr>' +
    '<th>成品规格</th><th style="width:4rem">支数</th><th style="width:6.5rem">发回重量</th><th>备注</th><th style="width:8.5rem">发回日期</th><th style="width:5rem">操作</th>' +
    '</tr></thead><tbody class="delivery-edit-tbody"></tbody></table>' +
    '</div>' +
    '<div class="delivery-edit-actions"><button type="button" class="btn delivery-edit-btn-add">添加一行</button></div>' +
    '</div>'

  const tbody = backdrop.querySelector('.delivery-edit-tbody')

  for (let i = 0; i < draft.length; i += 1) appendDraftRow(tbody, draft[i])

  const close = () => {
    backdrop.remove()
  }

  backdrop.querySelector('.delivery-print-btn-export-xls').addEventListener('click', () => {
    const rows = readDraftFromTable(tbody)
    exportDeliveryRowsToExcel(rows, { serialNumber: serialSession.serial })
    markSerialCommitted()
  })
  backdrop.querySelector('.delivery-print-btn-export-blank').addEventListener('click', () => {
    exportDeliveryRowsToExcel([], { serialNumber: serialSession.serial, blankTemplate: true })
    markSerialCommitted()
  })
  backdrop.querySelector('.delivery-edit-btn-add').addEventListener('click', () => {
    const firstCustomer = tbody.querySelector('[name="customer_name"]')?.value ?? ''
    appendDraftRow(tbody, { customer_name: firstCustomer })
  })
  backdrop.querySelector('.delivery-print-btn-close').addEventListener('click', close)

  document.body.appendChild(backdrop)
  return true
}
