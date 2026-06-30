import { formatForgingSpecHtml } from './finishedOutputs.js'

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

function fmtText(v) {
  const s = v === null || v === undefined ? '' : String(v)
  const t = s.trim()
  return t ? t : '—'
}

export function FinishedOutputsView({ outputs, variant = 'compact', unitCodes, emptyText = '—' }) {
  const rows = Array.isArray(outputs) ? outputs : []
  const hasAnyMissingPieces = rows.some((r) => {
    const v = r?.pieces
    return v === null || v === undefined || String(v) === ''
  })
  const codes =
    !hasAnyMissingPieces && Array.isArray(unitCodes)
      ? unitCodes.map((x) => String(x ?? '').trim()).filter(Boolean)
      : null
  const specs = []
  for (const r of rows) {
    const s = r?.spec === null || r?.spec === undefined ? '' : String(r.spec).trim()
    if (s) specs.push(s)
  }
  const compact = specs.length ? specs.join(' / ') : String(emptyText ?? '—')
  const compactHtml = specs.length
    ? specs.map((x) => formatForgingSpecHtml(x, '')).join(' / ')
    : formatForgingSpecHtml(compact, '')

  if (variant !== 'table') {
    return <span title={compact} dangerouslySetInnerHTML={{ __html: compactHtml }} />
  }

  let codeCursor = 0
  return (
    <div className="data-table-wrap">
      <table className="data-table finished-outputs-editor-table">
        <thead>
          <tr>
            <th style={{ width: '3.5rem' }}>序号</th>
            <th style={{ width: '7rem' }}>件号</th>
            <th>锻造规格</th>
            <th style={{ width: '5.5rem' }}>支数</th>
            <th style={{ width: '8rem' }}>发回重量</th>
            <th style={{ width: '8.5rem' }}>发回日期</th>
            <th>分支备注</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={7} className="muted">
                暂无锻造规格
              </td>
            </tr>
          ) : (
            rows.map((r, idx) => {
              const rawPieces = r?.pieces
              const n = Math.max(1, Number.parseInt(String(rawPieces ?? 1), 10) || 1)
              const piecesProvided = !(rawPieces === null || rawPieces === undefined || String(rawPieces) === '')
              const seg = codes && piecesProvided ? codes.slice(codeCursor, codeCursor + n) : []
              if (codes && piecesProvided) codeCursor += n
              const pieceText = seg.length ? seg.join('，') : fmtText(r?.piece_code)
              return (
                <tr key={r?.id ?? `${idx}`}>
                  <td className="cell-nowrap">{idx + 1}</td>
                  <td className="cell-nowrap">{pieceText}</td>
                  <td
                    className="text-cell"
                    dangerouslySetInnerHTML={{ __html: formatForgingSpecHtml(fmtText(r?.spec), '—') }}
                  />
                  <td className="cell-nowrap">{fmtNum(rawPieces)}</td>
                  <td className="cell-nowrap">{fmtNum(r?.weight_return)}</td>
                  <td className="cell-nowrap">{fmtText(r?.return_date)}</td>
                  <td className="text-cell">{fmtText(r?.remark)}</td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
    </div>
  )
}

export function FinishedOutputsEditor({
  rows,
  onChange,
  defaultPieces = 1,
  allowAddRow = true,
  showWeightReturn = true,
  showReturnDate = true,
  showRemark = true,
}) {
  const list = Array.isArray(rows) ? rows : []
  const dp = defaultPieces === null || defaultPieces === undefined ? 1 : defaultPieces

  function setPieceCode(nextPieceCode) {
    const v = nextPieceCode === null || nextPieceCode === undefined ? '' : String(nextPieceCode)
    onChange(list.map((r) => ({ ...r, piece_code: v })))
  }

  function updateRow(i, patch) {
    const next = list.map((r, idx) => (idx === i ? { ...r, ...patch } : r))
    onChange(next)
  }

  function addRow() {
    const pc = String(list?.[0]?.piece_code ?? '')
    onChange([...list, { piece_code: pc, spec: '', pieces: dp, weight_return: '', return_date: '', remark: '' }])
  }

  function removeRow(i) {
    const next = list.filter((_, idx) => idx !== i)
    const pc = String(list?.[0]?.piece_code ?? '')
    onChange(
      next.length
        ? next
        : [{ piece_code: pc, spec: '', pieces: dp, weight_return: '', return_date: '', remark: '' }],
    )
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: '5.5rem' }}>件号</th>
            <th>锻造规格</th>
            <th style={{ width: '4.25rem' }}>支数</th>
            {showWeightReturn ? <th style={{ width: '6.5rem' }}>发回重量</th> : null}
            {showReturnDate ? <th style={{ width: '7.25rem' }}>发回日期</th> : null}
            {showRemark ? <th>分支备注</th> : null}
            <th style={{ width: '5rem' }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r, idx) => (
            <tr key={`${idx}`}>
              <td>
                <input
                  value={r?.piece_code ?? ''}
                  onChange={(e) => setPieceCode(e.target.value)}
                  placeholder="如：A1"
                />
              </td>
              <td>
                <input
                  value={r?.spec ?? ''}
                  onChange={(e) => updateRow(idx, { spec: e.target.value })}
                  placeholder="如：φ20×30"
                  className="finished-outputs-editor-spec-input"
                />
                {(() => {
                  const raw = String(r?.spec ?? '')
                  const html = formatForgingSpecHtml(raw, '')
                  if (!String(raw).includes('^') && !String(raw).includes('(')) return null
                  return (
                    <div
                      className="muted"
                      style={{ fontSize: '0.9em', marginTop: '0.25rem' }}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  )
                })()}
              </td>
              <td>
                <input
                  type="number"
                  min={1}
                  value={r?.pieces ?? dp}
                  onChange={(e) => updateRow(idx, { pieces: e.target.value })}
                />
              </td>
              {showWeightReturn ? (
                <td>
                  <input
                    value={r?.weight_return ?? ''}
                    onChange={(e) => updateRow(idx, { weight_return: e.target.value })}
                    placeholder="如：12.345"
                    inputMode="decimal"
                  />
                </td>
              ) : null}
              {showReturnDate ? (
                <td>
                  <input
                    type="date"
                    value={r?.return_date ?? ''}
                    onChange={(e) => updateRow(idx, { return_date: e.target.value })}
                  />
                </td>
              ) : null}
              {showRemark ? (
                <td>
                  <input
                    value={r?.remark ?? ''}
                    onChange={(e) => updateRow(idx, { remark: e.target.value })}
                    placeholder="可选"
                  />
                </td>
              ) : null}
              <td className="cell-nowrap">
                <button type="button" className="btn btn-ghost" onClick={() => removeRow(idx)}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {allowAddRow ? (
        <div className="toolbar" style={{ paddingTop: '0.5rem' }}>
          <button type="button" className="btn" onClick={addRow}>
            添加一行
          </button>
        </div>
      ) : null}
    </div>
  )
}
