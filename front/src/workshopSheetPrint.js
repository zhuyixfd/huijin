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
  .pos-row td.mid { background: #fafafa; }
  .section-gap td { border: none !important; height: 14px; padding: 0 !important; }
  .status-banner td { text-align: center; font-weight: 700; background: #e8f4fc; border-top-width: 2px !important; }
  .toolbar-print { margin-top: 16px; text-align: center; }
  .muted { color: #555; font-size: 12px; margin-top: 12px; }
  @media print {
    body { padding: 0; }
    .toolbar-print { display: none; }
    @page { margin: 12mm; size: A4 landscape; }
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

function buildPositionTemplateRows() {
  let html = ''
  for (let i = 0; i < 7; i += 1) {
    const left = `第${i + 1}排`
    const right = `第${i + 7}排`
    /* 8 列：第 1 列、第 5 列为排号，其余列分区合并 */
    html += `<tr class="pos-row">
      <td>${esc(left)}</td>
      <td colspan="3" class="mid"></td>
      <td>${esc(right)}</td>
      <td colspan="3" class="mid"></td>
    </tr>`
  }
  return html
}

function buildDataRows(rows) {
  return rows
    .map(({ item, pieceLabel }) => {
      const spec = item.spec_incoming ?? ''
      const qty = 1
      return `<tr>
        <td class="num">${esc(pieceLabel)}</td>
        <td>${esc(item.material_grade ?? '')}</td>
        <td>${esc(item.formed_size ?? '')}</td>
        <td>${esc(spec)}</td>
        <td class="num">${qty}</td>
        <td class="num">${esc(fmtWeight(item.weight_incoming))}</td>
        <td class="num"></td>
        <td>${esc(item.remark ?? '')}</td>
      </tr>`
    })
    .join('')
}

export function buildWorkshopProductionSheetHtml(todayQueueRows) {
  const expanded = expandTodayQueueForSheet(todayQueueRows)
  const { forging, byStatus } = splitForgingAndByStatus(expanded)

  const todayStr = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const headerCols = ['件号', '材质', '成型尺寸', '规格', '数量', '重量', '炉号', '备注']

  let body = ''

  body += `<tr><th>${headerCols.map((h) => esc(h)).join('</th><th>')}</th></tr>`
  body += buildPositionTemplateRows()
  body += buildDataRows(forging)

  const otherStatuses = [...byStatus.entries()].sort(([a], [b]) =>
    String(a).localeCompare(String(b), 'zh-CN'),
  )

  for (const [status, pieceRows] of otherStatuses) {
    body += `<tr class="section-gap"><td colspan="8"></td></tr>`
    body += `<tr class="status-banner"><td colspan="8">${esc(status)}</td></tr>`
    body += buildDataRows(pieceRows)
  }

  const extraNote =
    otherStatuses.length > 0
      ? `非「锻造中」工序（${otherStatuses.map(([s]) => s).join('、')}）已列于排位置单下方。`
      : ''
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
    <p class="muted">炉号栏可打印后手写。${extraNote}</p>
    <div class="toolbar-print">
      <button type="button" onclick="window.print()">打印</button>
    </div>
  `
}

export function buildWorkshopProductionSheetDocument(todayQueueRows) {
  const inner = buildWorkshopProductionSheetHtml(todayQueueRows)
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>汇金加工生产单</title><style>${sheetCss}</style></head><body>${inner}</body></html>`
}

/** 打开预览窗口（可打印）；今日处理为空时返回 false */
export function openWorkshopProductionPreview(todayQueueRows) {
  if (!todayQueueRows?.length) {
    window.alert('暂无今日处理订单')
    return false
  }
  const w = window.open('', '_blank')
  if (!w) {
    window.alert('请允许弹出窗口以预览')
    return false
  }
  w.document.write(buildWorkshopProductionSheetDocument(todayQueueRows))
  w.document.close()
  return true
}
