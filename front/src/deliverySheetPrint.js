/**
 * 出库送货单：按收货单位（客户名称）拆分多页；页内预览 + 打印。
 */

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

function buildOneSheet(consignee, items, sheetDateStr) {
  let qtySum = 0
  const body = items
    .map((it) => {
      const q = Number(it.quantity)
      const n = Number.isFinite(q) && q >= 1 ? Math.floor(q) : 1
      qtySum += n
      return `<tr>
      <td>${esc(it.material_grade)}</td>
      <td>${esc(it.spec_incoming)}</td>
      <td>${esc(it.formed_size)}</td>
      <td class="num">${n}</td>
      <td class="num">${esc(weightCell(it))}</td>
      <td>${esc(it.remark)}</td>
    </tr>`
    })
    .join('')

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
        <th>锻造规格</th>
        <th>数量</th>
        <th>重量</th>
        <th>备注</th>
      </tr>
    </thead>
    <tbody>
      ${body}
      <tr class="total-row">
        <td colspan="3">合计</td>
        <td class="num">${qtySum}</td>
        <td colspan="2"></td>
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
  const groups = groupByConsignee(rows)
  return groups.map(([name, items]) => buildOneSheet(name, items, sheetDateStr)).join('\n')
}

export function buildDeliverySlipDocument(rows, options = {}) {
  const inner = buildDeliverySlipHtml(rows, options)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>送货单</title><style>${slipCss}</style></head><body>${inner}</body></html>`
}

const STYLE_ID = 'delivery-slip-modal-styles'

function ensureModalStyles() {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = `
.delivery-print-modal-backdrop { position: fixed; inset: 0; z-index: 10000; background: rgba(0,0,0,.5); display: flex; align-items: center; justify-content: center; padding: 12px; box-sizing: border-box; }
.delivery-print-modal { background: #fff; border-radius: 10px; width: min(920px, 100%); max-height: 92vh; display: flex; flex-direction: column; box-shadow: 0 8px 32px rgba(0,0,0,.25); overflow: hidden; }
.delivery-print-toolbar { flex: 0 0 auto; padding: 10px 12px; border-bottom: 1px solid var(--border, #ddd); display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
.delivery-print-toolbar .btn { font: inherit; padding: 0.45rem 0.9rem; border-radius: 8px; border: 1px solid #ccc; background: #f4f4f5; cursor: pointer; }
.delivery-print-toolbar .delivery-print-btn-print { background: #2563eb; color: #fff; border-color: #1d4ed8; }
.delivery-print-frame { flex: 1 1 auto; width: 100%; min-height: 280px; height: min(78vh, 880px); border: none; background: #fff; }
`
  document.head.appendChild(el)
}

/** @param {Array<object>} outboundRows 出库中明细（任务列表行，含 customer_name） */
export function openDeliverySlipPreview(outboundRows) {
  if (!outboundRows?.length) {
    window.alert('暂无出库中单据')
    return false
  }
  ensureModalStyles()
  const docHtml = buildDeliverySlipDocument(outboundRows)

  const backdrop = document.createElement('div')
  backdrop.className = 'delivery-print-modal-backdrop'
  backdrop.setAttribute('role', 'dialog')
  backdrop.setAttribute('aria-label', '送货单预览（按收货单位分页）')
  backdrop.innerHTML =
    '<div class="delivery-print-modal">' +
    '<div class="delivery-print-toolbar">' +
    '<button type="button" class="btn delivery-print-btn-print">打印</button>' +
    '<button type="button" class="btn delivery-print-btn-close">关闭</button>' +
    '</div>' +
    '<iframe class="delivery-print-frame" title="送货单"></iframe>' +
    '</div>'

  const iframe = backdrop.querySelector('iframe')
  const close = () => {
    backdrop.remove()
  }

  backdrop.querySelector('.delivery-print-btn-print').addEventListener('click', () => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
  })
  backdrop.querySelector('.delivery-print-btn-close').addEventListener('click', close)
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close()
  })

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
