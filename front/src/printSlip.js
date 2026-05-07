/** 四种单据：来料单、生产单、出库单、发回单（成品交回客户） */

const printCss = `
  * { box-sizing: border-box; }
  body { font-family: system-ui, "Segoe UI", Roboto, sans-serif; padding: 16px; color: #111; }
  h1 { font-size: 18px; margin: 0 0 12px; text-align: center; letter-spacing: 0.05em; }
  .meta { margin-bottom: 12px; font-size: 13px; line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { border: 1px solid #333; padding: 6px 8px; vertical-align: top; }
  th { background: #f3f3f3; width: 22%; }
  .muted { color: #555; }
  @media print {
    body { padding: 0; }
    @page { margin: 12mm; }
  }
`

function esc(s) {
  if (s === null || s === undefined) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function row(label, value) {
  return `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`
}

export function buildSlipHtml(kind, { order, customer, item }) {
  const cname = customer?.name ?? ''
  const ono = order?.order_no ?? ''
  const baseRows = [
    row('订单编号', ono),
    row('客户名称', cname),
    row('来料编号', item?.incoming_no),
    row('材质', item?.material_grade),
    row('生产编号', item?.production_no),
    row('来料规格', item?.spec_incoming),
    row('来料重', item?.weight_incoming),
    row('个数', item?.quantity),
    row('发回重量', item?.weight_return),
    row('成型尺寸', item?.formed_size),
    row('锻造过程要求', item?.forging_requirements),
    row('生产过程', item?.production_process),
    row('备注', item?.remark),
    row('生产状态', item?.production_status),
    row('来料日期', item?.incoming_date),
    row('发回日期', item?.return_date),
    row('下料时间', item?.cutting_time),
  ]

  const titles = {
    incoming: '来料单',
    production: '生产单',
    outbound: '出库单',
    return: '发回单',
  }
  const title = titles[kind] ?? '单据'
  const note =
    kind === 'incoming'
      ? '（材料到厂验收、入库依据）'
      : kind === 'production'
        ? '（车间锻造加工依据）'
        : kind === 'outbound'
          ? '（仓库出库发运依据）'
          : '（成品发回客户交接依据）'

  return `
    <h1>${esc(title)}</h1>
    <p class="meta muted">${esc(note)} · 打印时间 ${esc(new Date().toLocaleString('zh-CN'))}</p>
    <table>
      <tbody>
        ${baseRows.join('')}
      </tbody>
    </table>
  `
}

/** 完整 HTML 文档，用于 iframe 预览或与 openPrint 共用 */
export function buildSlipDocument(kind, payload) {
  const html = buildSlipHtml(kind, payload)
  const titles = { incoming: '来料单', production: '生产单', outbound: '出库单', return: '发回单' }
  const t = titles[kind] ?? '单据'
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(t)}</title><style>${printCss}</style></head><body>${html}</body></html>`
}

export function openPrint(kind, payload) {
  const w = window.open('', '_blank')
  if (!w) {
    window.alert('请允许弹出窗口以打印')
    return
  }
  w.document.write(buildSlipDocument(kind, payload))
  w.document.close()
  setTimeout(() => {
    w.focus()
    w.print()
    w.close()
  }, 200)
}
