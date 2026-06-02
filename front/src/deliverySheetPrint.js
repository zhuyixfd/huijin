/**
 * 出库送货单：按收货单位（客户名称）拆分多页；模态框内可编辑后打印（不写入数据库）；支持导出 CSV（Excel 可打开）。
 */

import { expandOrdersToDeliveryLines } from './finishedOutputs.js'
import { formatFormedSizeStagesText } from './formedSizeStages.js'

const slipCss = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Roboto, "PingFang SC", sans-serif; padding: 16px; color: #111; background: #fff; }
  .delivery-sheet { page-break-after: always; max-width: 900px; margin: 0 auto; }
  .delivery-sheet:last-child { page-break-after: auto; }
  .company-title { font-size: 18px; font-weight: 700; text-align: center; letter-spacing: 0.12em; margin: 0 0 6px; }
  .delivery-huge { font-size: 32px; font-weight: 800; text-align: center; letter-spacing: 0.35em; margin: 6px 0 18px; }
  .delivery-meta { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; margin-bottom: 12px; padding: 0 4px; }
  .delivery-meta .consignee { flex: 1; }
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

function cutHeadWeightCell(it) {
  const w = it.cut_head_weight
  if (w === null || w === undefined || w === '') return '—'
  return String(w)
}

function hasCutHeadWeight(it) {
  const w = it?.cut_head_weight
  return !(w === null || w === undefined || w === '')
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

function buildOneSheet(consignee, items, sheetDateStr, showCutHeadCol) {
  let qtySum = 0
  let weightSum = 0
  let anyWeight = false
  const body = items
    .map((it) => {
      qtySum += 1
      const w = it.weight_return
      const wn = parseFloat(String(w ?? '').replace(/,/g, ''))
      if (Number.isFinite(wn)) {
        weightSum += wn
        anyWeight = true
      }
      const forgeReq = it.forging_requirements ?? ''
      const note = it.remark ?? ''
      const formed = formatFormedSizeStagesText(it.formed_size) || it.formed_size || ''
      return `<tr>
      <td>${esc(it.material_grade)}</td>
      <td>${esc(it.spec_incoming)}</td>
      <td class="num">${esc(it.piece_code || '—')}</td>
      <td>${esc(it.spec || '—')}</td>
      <td>${esc(formed)}</td>
      <td class="num">1</td>
      <td class="num">${esc(weightCell(it))}</td>
      ${showCutHeadCol ? `<td class="num">${esc(cutHeadWeightCell(it))}</td>` : ''}
      <td>${esc(forgeReq)}</td>
      <td>${esc(note)}</td>
    </tr>`
    })
    .join('')

  const totalTailColSpan = showCutHeadCol ? 3 : 2
  const weightTotalCell = anyWeight ? esc(String(weightSum)) : ''
  return `
<section class="delivery-sheet">
  <div class="company-title">江阴市汇金机械有限公司</div>
  <div class="delivery-huge">送货单</div>
  <div class="delivery-meta">
    <span class="consignee">收货单位名称：${esc(consignee)}</span>
    <span>${esc(sheetDateStr)}</span>
  </div>
  <table class="delivery-grid">
    <thead>
      <tr>
        <th>材质</th>
        <th>来料规格</th>
        <th>件号</th>
        <th>成品规格</th>
        <th>成品成型尺寸</th>
        <th>数量</th>
        <th>发回重量</th>
        ${showCutHeadCol ? '<th>切头重量</th>' : ''}
        <th>锻造要求</th>
        <th>备注</th>
      </tr>
    </thead>
    <tbody>
      ${body}
      <tr class="total-row">
        <td colspan="5">合计</td>
        <td class="num">${qtySum}</td>
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
  const sheetDateStr = options.dateLabel ?? fmtCnDate(options.date ?? new Date())
  const showCutHeadCol =
    options.showCutHeadCol ?? (Array.isArray(rows) ? rows.some((r) => hasCutHeadWeight(r)) : false)
  const groups = groupByConsignee(rows)
  return groups
    .map(([name, items]) => buildOneSheet(name, items, sheetDateStr, showCutHeadCol))
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

function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** @param {ReturnType<normalizeDeliveryDraftRow>[]} rows */
export function exportDeliveryRowsToExcelCsv(rows, options = {}) {
  const showCutHeadCol =
    options.showCutHeadCol ?? (Array.isArray(rows) ? rows.some((r) => hasCutHeadWeight(r)) : false)
  const headers = [
    '收货单位',
    '材质',
    '来料规格',
    '件号',
    '成品规格',
    '成品成型尺寸',
    '数量',
    '发回重量',
    ...(showCutHeadCol ? ['切头重量'] : []),
    '锻造要求',
    '备注',
  ]
  const lines = [headers.join(',')]
  for (const r of rows) {
    const w = r.weight_return ?? r.weight_incoming ?? ''
    const formed = formatFormedSizeStagesText(r.formed_size) || r.formed_size || ''
    const base = [
      csvEscape(r.customer_name),
      csvEscape(r.material_grade),
      csvEscape(r.spec_incoming),
      csvEscape(r.piece_code),
      csvEscape(r.spec),
      csvEscape(formed),
      csvEscape(r.quantity),
      csvEscape(w),
    ]
    lines.push(
      [
        ...base,
        ...(showCutHeadCol ? [csvEscape(r.cut_head_weight ?? '')] : []),
        csvEscape(r.forging_requirements),
        csvEscape(r.remark),
      ].join(','),
    )
  }
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

const STYLE_ID = 'delivery-slip-modal-styles'

function ensureModalStyles() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
.delivery-print-modal-backdrop { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
.delivery-print-modal { background: #fff; border-radius: 10px; width: min(1100px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,.25); overflow: hidden; }
.delivery-print-toolbar { flex: 0 0 auto; padding: 10px 12px; border-bottom: 1px solid var(--border, #ddd); display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; align-items: center; }
.delivery-print-toolbar .btn { font: inherit; padding: 0.45rem 0.9rem; border-radius: 8px; border: 1px solid #ccc; background: #f4f4f5; cursor: pointer; }
.delivery-print-toolbar .delivery-print-btn-print { background: #2563eb; color: #fff; border-color: #1d4ed8; }
.delivery-print-toolbar .delivery-print-hint { margin-right: auto; font-size: 13px; color: #555; }
.delivery-edit-scroll { flex: 1 1 auto; overflow: auto; padding: 12px; min-height: 200px; }
.delivery-edit-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.delivery-edit-table th, .delivery-edit-table td { border: 1px solid #ccc; padding: 4px 6px; vertical-align: middle; }
.delivery-edit-table th { background: #f5f5f5; text-align: left; white-space: nowrap; }
.delivery-edit-table input, .delivery-edit-table textarea { width: 100%; box-sizing: border-box; font: inherit; border: none; background: transparent; padding: 4px; }
.delivery-edit-table textarea { min-height: 2.5rem; resize: vertical; }
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
      material_grade: g('material_grade'),
      spec_incoming: g('spec_incoming'),
      piece_code: g('piece_code'),
      spec: g('spec'),
      formed_size: g('formed_size'),
      quantity: 1,
      weight_return: g('weight_return') || null,
      weight_incoming: null,
      cut_head_weight: tr.querySelector('[name="cut_head_weight"]') ? g('cut_head_weight') || null : null,
      forging_requirements: g('forging_requirements'),
      remark: g('remark'),
    })
  }
  return out
}

/** @param {Array<object>} outboundRows 出库中明细（任务列表行，含 customer_name） */
export function openDeliverySlipPreview(outboundRows) {
  if (!outboundRows?.length) {
    window.alert('暂无出库中单据')
    return false
  }
  ensureModalStyles()
  const showCutHeadCol = outboundRows.some((r) => hasCutHeadWeight(r))
  const draft = normalizeDeliveryDraftRows(outboundRows)

  const backdrop = document.createElement('div')
  backdrop.className = 'delivery-print-modal-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-label', '送货单预览与编辑')
  const headCut = showCutHeadCol ? '<th style="width:6rem">切头重量</th>' : ''
  backdrop.innerHTML =
    '<div class="delivery-print-modal">' +
    '<div class="delivery-print-toolbar">' +
    '<span class="delivery-print-hint">以下为打印预览数据，可直接修改；修改仅用于本次打印与导出，不会保存到系统。</span>' +
    '<button type="button" class="btn delivery-print-btn-export">导出 Excel</button>' +
    '<button type="button" class="btn delivery-print-btn-print">打印</button>' +
    '<button type="button" class="btn delivery-print-btn-close">关闭</button>' +
    '</div>' +
    '<div class="delivery-edit-scroll">' +
    '<table class="delivery-edit-table"><thead><tr>' +
    '<th>收货单位</th><th>材质</th><th>来料规格</th><th>件号</th><th>成品规格</th><th>成品成型</th><th style="width:3rem">数</th><th style="width:5rem">发回重量</th>' +
    headCut +
    '<th>锻造要求</th><th>备注</th>' +
    '</tr></thead><tbody class="delivery-edit-tbody"></tbody></table>' +
    '</div>' +
    '<iframe class="delivery-print-frame" title="送货单打印"></iframe>' +
    '</div>'

  const tbody = backdrop.querySelector('.delivery-edit-tbody')
  const iframe = backdrop.querySelector('iframe')

  for (let i = 0; i < draft.length; i += 1) {
    const r = draft[i]
    const tr = document.createElement('tr')
    tr.dataset.deliveryRow = '1'
    tr.innerHTML = `
      <td><input type="text" name="customer_name" autocomplete="off" /></td>
      <td><input type="text" name="material_grade" autocomplete="off" /></td>
      <td><input type="text" name="spec_incoming" autocomplete="off" /></td>
      <td><input type="text" name="piece_code" autocomplete="off" /></td>
      <td><input type="text" name="spec" autocomplete="off" /></td>
      <td><input type="text" name="formed_size" autocomplete="off" /></td>
      <td><input type="hidden" name="quantity" value="1" />
      <td><input type="text" name="weight_return" autocomplete="off" /></td>
      ${showCutHeadCol ? '<td><input type="text" name="cut_head_weight" autocomplete="off" /></td>' : ''}
      <td><textarea name="forging_requirements" rows="2"></textarea></td>
      <td><textarea name="remark" rows="2"></textarea></td>
    `
    tr.querySelector('[name="customer_name"]').value = r.customer_name
    tr.querySelector('[name="material_grade"]').value = r.material_grade
    tr.querySelector('[name="spec_incoming"]').value = r.spec_incoming
    tr.querySelector('[name="piece_code"]').value = r.piece_code ?? ''
    tr.querySelector('[name="spec"]').value = r.spec ?? ''
    tr.querySelector('[name="formed_size"]').value = r.formed_size ?? ''
    tr.querySelector('[name="weight_return"]').value =
      r.weight_return === null || r.weight_return === undefined ? '' : String(r.weight_return)
    if (showCutHeadCol) {
      tr.querySelector('[name="cut_head_weight"]').value =
        r.cut_head_weight === null || r.cut_head_weight === undefined ? '' : String(r.cut_head_weight)
    }
    tr.querySelector('[name="forging_requirements"]').value = r.forging_requirements
    tr.querySelector('[name="remark"]').value = r.remark ?? ''
    tbody.appendChild(tr)
  }

  const close = () => {
    backdrop.remove()
  }

  function printFromDraft() {
    const rows = readDraftFromTable(tbody)
    const docHtml = buildDeliverySlipDocument(rows, { showCutHeadCol })
    const doc = iframe.contentDocument || iframe.contentWindow?.document
    if (!doc) {
      window.alert('打印窗口无法打开')
      return
    }
    doc.open()
    doc.write(docHtml)
    doc.close()
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
  }

  backdrop.querySelector('.delivery-print-btn-print').addEventListener('click', () => {
    printFromDraft()
  })
  backdrop.querySelector('.delivery-print-btn-export').addEventListener('click', () => {
    const rows = readDraftFromTable(tbody)
    exportDeliveryRowsToExcelCsv(rows, { showCutHeadCol })
  })
  backdrop.querySelector('.delivery-print-btn-close').addEventListener('click', close)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })

  document.body.appendChild(backdrop)
  return true
}
