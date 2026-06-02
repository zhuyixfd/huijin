import { formatFormedSizeStagesText } from './formedSizeStages.js'
import { emptyFinishedOutput, formatPieceCodeLabel, sumFinishedOutputWeights } from './finishedOutputs.js'

function pieceCodeCell(code) {
  const label = formatPieceCodeLabel(code)
  const pending = !code || !String(code).trim()
  return <span className={pending ? 'muted' : ''}>{label}</span>
}

export function FinishedOutputsView({ outputs, variant = 'compact', empty = '—' }) {
  const rows = Array.isArray(outputs) ? outputs : []
  if (!rows.length) {
    return <span className="muted">{empty}</span>
  }

  if (variant === 'table') {
    return (
      <table className="data-table finished-outputs-mini-table">
        <thead>
          <tr>
            <th>件号</th>
            <th>成品规格</th>
            <th>成品成型尺寸</th>
            <th>发回重量</th>
            <th>备注</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o, i) => (
            <tr key={o.id ?? i}>
              <td>{pieceCodeCell(o.piece_code)}</td>
              <td className="text-cell">{o.spec || '—'}</td>
              <td className="text-cell">
                {formatFormedSizeStagesText(o.formed_size) || o.formed_size || '—'}
              </td>
              <td>{o.weight_return ?? '—'}</td>
              <td className="text-cell">{o.remark || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }

  return (
    <div className="finished-outputs-view finished-outputs-view--compact">
      {rows.map((o, i) => (
        <div key={o.id ?? i} className="finished-outputs-view__card">
          <span className="finished-outputs-view__title">成品 {i + 1}</span>
          <dl className="finished-outputs-view__dl">
            <div>
              <dt>件号</dt>
              <dd>{pieceCodeCell(o.piece_code)}</dd>
            </div>
            <div>
              <dt>规格</dt>
              <dd>{o.spec || '—'}</dd>
            </div>
            <div>
              <dt>成型</dt>
              <dd>{formatFormedSizeStagesText(o.formed_size) || o.formed_size || '—'}</dd>
            </div>
            <div>
              <dt>重量</dt>
              <dd>{o.weight_return ?? '—'}</dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  )
}

export function FinishedOutputsEditor({ rows, onChange, className = '' }) {
  const list = Array.isArray(rows) && rows.length > 0 ? rows : [emptyFinishedOutput()]
  const totalW = sumFinishedOutputWeights(list)

  function updateAt(i, field, value) {
    const next = list.map((r, j) => (j === i ? { ...r, [field]: value } : r))
    onChange?.(next)
  }

  function addRow() {
    onChange?.([...list, emptyFinishedOutput()])
  }

  function removeAt(i) {
    if (list.length <= 1) {
      onChange?.([emptyFinishedOutput()])
      return
    }
    onChange?.(list.filter((_, j) => j !== i))
  }

  return (
    <div className={`finished-outputs-editor ${className}`.trim()}>
      <p className="muted finished-outputs-editor__hint">
        同一来料可登记多个成品：填写规格、成品成型尺寸与发回重量。
        <strong>件号不在此填写</strong>，订单进入处理并排生产单后，系统按「成品 1、2、3…」顺序自动生成件号（与处理中件号列一致）。
      </p>
      <div className="finished-outputs-editor__list">
        {list.map((row, i) => (
          <fieldset key={i} className="finished-outputs-editor__card">
            <legend>成品 {i + 1}</legend>
            <div className="finished-outputs-editor__grid">
              <label>
                成品规格
                <input
                  value={row.spec}
                  placeholder="成品规格"
                  onChange={(e) => updateAt(i, 'spec', e.target.value)}
                />
              </label>
              <label>
                成品成型尺寸
                <input
                  value={row.formed_size}
                  placeholder="该件成品尺寸"
                  onChange={(e) => updateAt(i, 'formed_size', e.target.value)}
                />
              </label>
              <label>
                发回重量
                <input
                  value={row.weight_return}
                  placeholder="kg"
                  onChange={(e) => updateAt(i, 'weight_return', e.target.value)}
                />
              </label>
              <label className="full">
                备注
                <input
                  value={row.remark}
                  onChange={(e) => updateAt(i, 'remark', e.target.value)}
                />
              </label>
            </div>
            <button type="button" className="btn btn-ghost" onClick={() => removeAt(i)}>
              删除该成品
            </button>
          </fieldset>
        ))}
      </div>
      <div className="finished-outputs-editor__actions">
        <button type="button" className="btn btn-ghost" onClick={addRow}>
          + 添加成品
        </button>
        {totalW != null ? (
          <span className="muted finished-outputs-editor__sum">发回重量合计：{totalW}</span>
        ) : null}
      </div>
    </div>
  )
}
