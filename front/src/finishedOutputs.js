/** 成品明细：同一来料 → 多个成品 */

export function emptyFinishedOutput() {
  return {
    spec: '',
    weight_return: '',
    remark: '',
  }
}

/** 件号由排产/处理中自动生成 */
export function formatPieceCodeLabel(code) {
  const s = code === null || code === undefined ? '' : String(code).trim()
  return s || '待排产生成'
}

export function parseFinishedOutputsFromItem(it) {
  if (Array.isArray(it?.finished_outputs) && it.finished_outputs.length > 0) {
    return it.finished_outputs.map((o) => ({
      spec: o.spec ?? '',
      weight_return:
        o.weight_return === null || o.weight_return === undefined ? '' : String(o.weight_return),
      remark: o.remark ?? '',
    }))
  }
  return [
    {
      spec: it?.spec_incoming ?? '',
      weight_return:
        it?.weight_return === null || it?.weight_return === undefined
          ? ''
          : String(it.weight_return),
      remark: '',
    },
  ]
}

export function normalizeFinishedOutputsForApi(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((o) => ({
      spec: String(o.spec ?? '').trim() || null,
      weight_return: o.weight_return === '' || o.weight_return === null ? null : String(o.weight_return),
      remark: String(o.remark ?? '').trim() || null,
    }))
    .filter((o) => o.spec || o.weight_return != null || o.remark)
}

export function sumFinishedOutputWeights(rows) {
  let sum = 0
  let any = false
  for (const o of Array.isArray(rows) ? rows : []) {
    const w = parseFloat(String(o.weight_return ?? '').replace(/,/g, ''))
    if (Number.isFinite(w)) {
      sum += w
      any = true
    }
  }
  return any ? sum : null
}

/** 送货单：每个成品一行 */
export function expandOrdersToDeliveryLines(rows) {
  const lines = []
  for (const r of rows || []) {
    const outputs =
      Array.isArray(r.finished_outputs) && r.finished_outputs.length > 0
        ? r.finished_outputs
        : null
    const baseRemark =
      (r.delivery_remark ?? '').trim() ||
      (r.remark ?? '').trim() ||
      (r.order_remark ?? '').trim() ||
      ''
    if (!outputs) {
      lines.push({
        customer_name: r.customer_name ?? '',
        material_grade: r.material_grade ?? '',
        spec_incoming: r.spec_incoming ?? '',
        spec: r.spec_incoming ?? '',
        quantity: 1,
        weight_return: r.weight_return ?? r.weight_incoming ?? '',
        weight_incoming: r.weight_incoming,
        cut_head_weight: r.cut_head_weight ?? '',
        forging_requirements: r.forging_requirements ?? '',
        remark: baseRemark,
        order_no: r.order_no ?? '',
      })
      continue
    }
    for (const o of outputs) {
      const lineRemark = (o.remark ?? '').trim() || baseRemark
      lines.push({
        customer_name: r.customer_name ?? '',
        material_grade: r.material_grade ?? '',
        spec_incoming: r.spec_incoming ?? '',
        piece_code: o.piece_code ?? null,
        spec: o.spec ?? '',
        quantity: 1,
        weight_return:
          o.weight_return === null || o.weight_return === undefined ? '' : String(o.weight_return),
        weight_incoming: r.weight_incoming,
        cut_head_weight: r.cut_head_weight ?? '',
        forging_requirements: r.forging_requirements ?? '',
        remark: lineRemark,
        order_no: r.order_no ?? '',
      })
    }
  }
  return lines
}
