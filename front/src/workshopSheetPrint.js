/**
 * 汇金加工生产单：今日处理排产预览 / 打印（快锻机车间）
 */

const sheetCss = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Roboto, "PingFang SC", sans-serif; padding: 16px; color: #111; max-width: 900px; margin: 0 auto; }
  h1.sheet-title { font-size: 20px; margin: 0 0 10px; text-align: center; letter-spacing: 0.08em; font-weight: 700; }
  .sheet-meta { display: flex; justify-content: space-between; align-items: baseline; font-size: 14px; margin-bottom: 10px; padding: 0 2px; }
  .sheet-meta .right { text-align: right; }
  table.sheet { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  table.sheet th, table.sheet td { border: 1px solid #333; padding: 6px 8px; vertical-align: middle; word-break: break-word; }
  table.sheet th { background: #eee; font-weight: 600; text-align: center; }
  table.sheet td.num { text-align: center; }
  table.sheet th.sheet-col-qty,
  table.sheet td.sheet-col-qty {
    width: 2.5rem;
    max-width: 3rem;
    padding: 6px 4px;
    white-space: nowrap;
  }
  table.sheet-pos-only { width: 100%; border-collapse: collapse; font-size: 13px; table-layout: fixed; }
  table.sheet-pos-only th, table.sheet-pos-only td { border: 1px solid #333; padding: 6px 8px; vertical-align: middle; }
  td.sheet-pos-cell { padding: 0 !important; vertical-align: top; }
  .pos-row td.mid { background: #fafafa; }
  .pos-row td.pos-slot-empty { min-height: 1.5rem; vertical-align: middle; }
  .pos-row td.pos-left-placeholder { background: #fafafa; color: transparent; }
  .pos-row td.pos-slot-label { text-align: center; font-weight: 600; vertical-align: middle; }
  .pos-row td.pos-slot-label.mid { background: #fafafa; }
  .status-banner td { vertical-align: middle; background: #e8f4fc; border-top-width: 2px !important; }
  .status-banner .status-banner-label { text-align: left; font-weight: 700; }
  .status-banner .status-banner-fill { border-left: none; }
  .toolbar-print { margin-top: 16px; text-align: center; }
  @media print {
    body { padding: 0; }
    .toolbar-print { display: none; }
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

function fmtWeight(v) {
  if (v === null || v === undefined || v === '') return ''
  return String(v)
}

/** 与 TasksPage 一致：按订单号排序后按件展开 */
export function expandTodayQueueForSheet(todayQueueRows) {
  const sorted = [...todayQueueRows].sort((a, b) => {
    const ao = String(a.order_no ?? '')
    const bo = String(b.order_no ?? '')
    const cmp = ao.localeCompare(bo, 'zh-CN')
    if (cmp !== 0) return cmp
    return a.id - b.id
  })
  const out = []
  for (const it of sorted) {
    const rawQ = Number(it.quantity)
    const units = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 1
    const codes = Array.isArray(it.processing_unit_codes) ? it.processing_unit_codes : []
    for (let u = 0; u < units; u += 1) {
      out.push({
        item: it,
        unitIndex: u,
        pieceLabel: codes[u] ?? '—',
      })
    }
  }
  return out
}

/** 日期：2026.5.4（年月日不补零） */
function fmtSheetDate(d = new Date()) {
  const t = d instanceof Date ? d : new Date(d)
  return `${t.getFullYear()}.${t.getMonth() + 1}.${t.getDate()}`
}

export function splitForgingAndByStatus(expanded) {
  const forging = []
  const byStatus = new Map()
  for (const row of expanded) {
    const st = row.item.production_status || ''
    if (st === '锻造中') {
      forging.push(row)
      continue
    }
    if (!byStatus.has(st)) byStatus.set(st, [])
    byStatus.get(st).push(row)
  }
  return { forging, byStatus }
}

/** 与下方明细表对齐共 9 列：1、5 列为「第x排」；2～4、6～9 列合并为空白/件号区 */
const MID34 = '<td colspan="3" class="mid"></td>'
const MID69 = '<td colspan="4" class="mid"></td>'

/**
 * 排位置嵌套表（9 列）：第 1、5 列显示排号；第 2～4、6～9 列为合并格。
 * 前四行：左 1～4 排、右 7～10 排对齐；第 5～6 行仅左侧 5～6 排，第 5 列为占位，右区合并；
 * 末行占位。
 */
function buildPositionInnerTableRows() {
  const empty5 = '<td class="pos-slot-empty">&nbsp;</td>'
  let html = ''
  for (let r = 0; r < 4; r += 1) {
    html += `<tr class="pos-row">
      <td>${esc(`第${r + 1}排`)}</td>
      ${MID34}
      <td>${esc(`第${r + 7}排`)}</td>
      ${MID69}
    </tr>`
  }
  for (let r = 4; r < 6; r += 1) {
    html += `<tr class="pos-row">
      <td>${esc(`第${r + 1}排`)}</td>
      ${MID34}
      ${empty5}
      ${MID69}
    </tr>`
  }
  html += `<tr class="pos-row">
      <td class="pos-left-placeholder">&nbsp;</td>
      ${MID34}
      ${empty5}
      ${MID69}
    </tr>`
  return html
}

/** 第1～10排件号写入合并格（与 TasksPage 排序一致） */
function buildPositionInnerTableRowsSlotLabels(labels) {
  const empty5 = '<td class="pos-slot-empty">&nbsp;</td>'
  let html = ''
  for (let r = 0; r < 4; r += 1) {
    const rawL = String(labels[r] ?? '').trim()
    const rawR = String(labels[r + 6] ?? '').trim()
    const showL = rawL ? esc(rawL) : '&nbsp;'
    const showR = rawR ? esc(rawR) : '&nbsp;'
    html += `<tr class="pos-row">
      <td>${esc(`第${r + 1}排`)}</td>
      <td colspan="3" class="pos-slot-label mid">${showL}</td>
      <td>${esc(`第${r + 7}排`)}</td>
      <td colspan="4" class="pos-slot-label mid">${showR}</td>
    </tr>`
  }
  for (let r = 4; r < 6; r += 1) {
    const rawL = String(labels[r] ?? '').trim()
    const showL = rawL ? esc(rawL) : '&nbsp;'
    html += `<tr class="pos-row">
      <td>${esc(`第${r + 1}排`)}</td>
      <td colspan="3" class="pos-slot-label mid">${showL}</td>
      ${empty5}
      <td colspan="4" class="mid">&nbsp;</td>
    </tr>`
  }
  html += `<tr class="pos-row">
      <td class="pos-left-placeholder">&nbsp;</td>
      <td colspan="3" class="pos-slot-label mid">&nbsp;</td>
      ${empty5}
      <td colspan="4" class="mid">&nbsp;</td>
    </tr>`
  return html
}

function buildDataRows(rows) {
  return rows
    .map(({ item, pieceLabel }) => {
      const spec = item.spec_incoming ?? ''
      const qty = 1
      return `<tr>
        <td class="num">${esc(pieceLabel)}</td>
        <td>${esc(item.customer_name ?? '')}</td>
        <td>${esc(item.material_grade ?? '')}</td>
        <td>${esc(item.formed_size ?? '')}</td>
        <td>${esc(spec)}</td>
        <td class="num sheet-col-qty">${qty}</td>
        <td class="num">${esc(fmtWeight(item.weight_incoming))}</td>
        <td class="num"></td>
        <td>${esc(item.remark ?? '')}</td>
      </tr>`
    })
    .join('')
}

export function buildWorkshopProductionSheetHtml(todayQueueRows, options = {}) {
  const { toolbar = true, slotLabels } = options
  const expanded = expandTodayQueueForSheet(todayQueueRows)
  const { forging, byStatus } = splitForgingAndByStatus(expanded)

  const todayStr = fmtSheetDate()

  const headerCols = ['件号', '客户名称', '材质', '成型尺寸', '规格', '数量', '重量', '炉号', '备注']

  let body = ''
  /* 排位置：嵌套独立表；slotLabels 长度 10 时用件号排序模板（第1～10排显示已填序号） */
  const posInner =
    Array.isArray(slotLabels) && slotLabels.length === 10
      ? buildPositionInnerTableRowsSlotLabels(slotLabels)
      : buildPositionInnerTableRows()
  body += `<tr class="sheet-pos-wrap"><td colspan="9" class="sheet-pos-cell"><table class="sheet-pos-only"><tbody>${posInner}</tbody></table></td></tr>`
  const qtyColIdx = headerCols.indexOf('数量')
  body += `<tr>${headerCols
    .map((h, i) =>
      i === qtyColIdx
        ? `<th class="sheet-col-qty">${esc(h)}</th>`
        : `<th>${esc(h)}</th>`,
    )
    .join('')}</tr>`
  body += buildDataRows(forging)

  const otherStatuses = [...byStatus.entries()].sort(([a], [b]) =>
    String(a).localeCompare(String(b), 'zh-CN'),
  )

  for (const [status, pieceRows] of otherStatuses) {
    body += `<tr class="status-banner"><td class="status-banner-label">${esc(status)}</td><td colspan="8" class="status-banner-fill"></td></tr>`
    body += buildDataRows(pieceRows)
  }

  return `
    <h1 class="sheet-title">汇金加工生产单</h1>
    <div class="sheet-meta">
      <span>车间：快锻机</span>
      <span class="right">日期：${esc(todayStr)}</span>
    </div>
    <table class="sheet">
      <tbody>
        ${body}
      </tbody>
    </table>
    ${
      toolbar
        ? `<div class="toolbar-print">
      <button type="button" onclick="window.print()">打印</button>
    </div>`
        : ''
    }
  `
}

export function buildWorkshopProductionSheetDocument(todayQueueRows, options = {}) {
  const inner = buildWorkshopProductionSheetHtml(todayQueueRows, options)
  /* 不再用页面标题重复「汇金加工生产单」，正文仅保留一处 h1 */
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title></title><style>${sheetCss}</style></head><body>${inner}</body></html>`
}

const MODAL_STYLE_ID = 'workshop-print-modal-styles'

function ensureModalStyles() {
  if (document.getElementById(MODAL_STYLE_ID)) return
  const el = document.createElement('style')
  el.id = MODAL_STYLE_ID
  el.textContent = `
.workshop-print-modal-backdrop { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
.workshop-print-modal { background: #fff; border-radius: 10px; width: min(920px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,.25); overflow: hidden; }
.workshop-print-toolbar { flex: 0 0 auto; padding: 10px 12px; border-bottom: 1px solid var(--border, #ddd); display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.workshop-print-toolbar .btn { font: inherit; padding: 0.45rem 0.9rem; border-radius: 8px; border: 1px solid #ccc; background: #f4f4f5; cursor: pointer; }
.workshop-print-toolbar .workshop-print-btn-print { background: #2563eb; color: #fff; border-color: #1d4ed8; }
.workshop-print-frame { flex: 1 1 auto; width: 100%; min-height: 280px; height: min(78vh, 880px); border: none; background: #fff; }
`
  document.head.appendChild(el)
}

/** 页内 iframe 预览（地址栏不再出现 blob URL）；打印仍走浏览器对话框（页眉/页脚须手动取消，网页无法改默认） */
export function openWorkshopProductionPreview(todayQueueRows, previewOptions = {}) {
  if (!todayQueueRows?.length) {
    window.alert('暂无今日处理订单')
    return false
  }
  ensureModalStyles()
  const docHtml = buildWorkshopProductionSheetDocument(todayQueueRows, {
    toolbar: false,
    ...previewOptions,
  })

  const backdrop = document.createElement('div')
  backdrop.className = 'workshop-print-modal-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute(
    'aria-label',
    Array.isArray(previewOptions.slotLabels)
      ? '加工生产单预览（件号排序）'
      : '加工生产单预览',
  )
  backdrop.innerHTML =
    '<div class="workshop-print-modal">' +
    '<div class="workshop-print-toolbar">' +
    '<button type="button" class="btn workshop-print-btn-print">打印</button>' +
    '<button type="button" class="btn workshop-print-btn-close">关闭</button>' +
    '</div>' +
    '<iframe class="workshop-print-frame" title="汇金加工生产单"></iframe>' +
    '</div>'

  const iframe = backdrop.querySelector('iframe')

  const close = () => {
    backdrop.remove()
  }

  backdrop.querySelector('.workshop-print-btn-print').addEventListener('click', () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
  })
  backdrop.querySelector('.workshop-print-btn-close').addEventListener('click', close)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })

  /* 必须先挂到文档树，否则 iframe.contentDocument / contentWindow 常为 null */
  document.body.appendChild(backdrop)

  const doc = iframe.contentDocument || iframe.contentWindow?.document
  if (!doc) {
    backdrop.remove()
    window.alert('预览无法打开，请刷新页面后重试')
    return false
  }
  doc.open()
  doc.write(docHtml)
  doc.close()

  return true
}
