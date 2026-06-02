/** 成品明细：同一来料 → 多个成品 */

export function emptyFinishedOutput() {
  return {
    piece_code: '',
    spec: '',
    formed_size: '',
    weight_return: '',
    remark: '',
  }
}

export function parseFinishedOutputsFromItem(it) {
  if (Array.isArray(it?.finished_outputs) && it.finished_outputs.length > 0) {
    return it.finished_outputs.map((o) => ({
      piece_code: o.piece_code ?? '',
      spec: o.spec ?? '',
      formed_size: o.formed_size ?? '',
      weight_return:
        o.weight_return === null || o.weight_return === undefined ? '' : String(o.weight_return),
      remark: o.remark ?? '',
    }))
  }
  return [
    {
      piece_code: '',
      spec: it?.spec_incoming ?? '',
      formed_size: it?.formed_size ?? '',
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
      piece_code: String(o.piece_code ?? '').trim() || null,
      spec: String(o.spec ?? '').trim() || null,
      formed_size: String(o.formed_size ?? '').trim() || null,
      weight_return: o.weight_return === '' || o.weight_return === null ? null : String(o.weight_return),
      remark: String(o.remark ?? '').trim() || null,
    }))
    .filter(
      (o) =>
        o.piece_code ||
        o.spec ||
        o.formed_size ||
        o.weight_return != null ||
        o.remark,
    )
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
        piece_code: '',
        spec: r.spec_incoming ?? '',
        formed_size: r.formed_size ?? '',
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
        piece_code: o.piece_code ?? '',
        spec: o.spec ?? '',
        formed_size: o.formed_size ?? '',
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
