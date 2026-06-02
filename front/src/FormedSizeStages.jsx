import { useEffect, useMemo, useState } from 'react'
import {
  FORMED_SIZE_FIELD_LABEL,
  formatFormedSizeStagesText,
  formedSizeStageLabel,
  joinFormedSizeStages,
  parseFormedSizeStages,
} from './formedSizeStages.js'

/** 只读：工序尺寸流程（compact 用于表格，block 用于详情） */
export function FormedSizeStagesView({ value, variant = 'compact', empty = '—' }) {
  const stages = useMemo(() => parseFormedSizeStages(value), [value])
  if (!stages.length) {
    return <span className="muted formed-size-stages-empty">{empty}</span>
  }

  if (variant === 'block') {
    return (
      <div className="formed-size-stages-view formed-size-stages-view--block">
        <ol className="formed-size-stages-timeline">
          {stages.map((s, i) => (
            <li key={`${i}-${s}`} className="formed-size-stages-timeline__item">
              <span className="formed-size-stages-timeline__badge">{formedSizeStageLabel(i)}</span>
              <span className="formed-size-stage-chip formed-size-stage-chip--lg">{s}</span>
              {i < stages.length - 1 ? (
                <span className="formed-size-stages-timeline__connector" aria-hidden>
                  →
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        <p className="muted formed-size-stages-flow-hint">
          流程：{formatFormedSizeStagesText(value)}
        </p>
      </div>
    )
  }

  return (
    <span className="formed-size-stages-view formed-size-stages-view--compact" title={formatFormedSizeStagesText(value)}>
      {stages.map((s, i) => (
        <span key={`${i}-${s}`} className="formed-size-stages-view__group">
          {i > 0 ? (
            <span className="formed-size-stages-view__arrow" aria-hidden>
              →
            </span>
          ) : null}
          <span className="formed-size-stage-chip" title={formedSizeStageLabel(i)}>
            <span className="formed-size-stage-chip__idx">{i + 1}</span>
            {s}
          </span>
        </span>
      ))}
    </span>
  )
}

/** 多行编辑，保存为逗号分隔的 formed_size */
export function FormedSizeStagesEditor({ value, onChange, className = '' }) {
  const [rows, setRows] = useState(() => {
    const p = parseFormedSizeStages(value)
    return p.length ? p : ['']
  })

  useEffect(() => {
    const p = parseFormedSizeStages(value)
    setRows(p.length ? p : [''])
  }, [value])

  function commit(next) {
    setRows(next)
    onChange?.(joinFormedSizeStages(next))
  }

  function updateAt(i, text) {
    const next = [...rows]
    next[i] = text
    commit(next)
  }

  function addRow() {
    commit([...rows, ''])
  }

  function removeAt(i) {
    if (rows.length <= 1) {
      commit([''])
      return
    }
    commit(rows.filter((_, j) => j !== i))
  }

  const joinedPreview = joinFormedSizeStages(rows)

  return (
    <div className={`formed-size-stages-editor ${className}`.trim()}>
      <p className="muted formed-size-stages-editor__hint">
        同一来料、同一成品：按锻造/修磨顺序填写各道工序后的尺寸（如 φ300 → φ290 → φ288）。
      </p>
      <ul className="formed-size-stages-editor__list">
        {rows.map((v, idx) => (
          <li key={idx} className="formed-size-stages-editor__row">
            <span className="formed-size-stages-editor__label">{formedSizeStageLabel(idx)}</span>
            <input
              type="text"
              value={v}
              placeholder={idx === 0 ? '如 φ300（锻前/来料后）' : idx === 1 ? '如 φ290（锻后）' : '如 φ288（修后）'}
              onChange={(e) => updateAt(idx, e.target.value)}
              aria-label={`${FORMED_SIZE_FIELD_LABEL} ${formedSizeStageLabel(idx)}`}
            />
            <button
              type="button"
              className="btn btn-ghost formed-size-stages-editor__remove"
              aria-label={`删除${formedSizeStageLabel(idx)}`}
              disabled={rows.length <= 1 && !String(v).trim()}
              onClick={() => removeAt(idx)}
            >
              删除
            </button>
          </li>
        ))}
      </ul>
      <div className="formed-size-stages-editor__actions">
        <button type="button" className="btn btn-ghost" onClick={addRow}>
          + 添加工序尺寸
        </button>
      </div>
      {joinedPreview ? (
        <div className="formed-size-stages-editor__preview" aria-live="polite">
          <span className="muted">预览：</span>
          <FormedSizeStagesView value={joinedPreview} variant="compact" empty="" />
        </div>
      ) : null}
    </div>
  )
}

export { FORMED_SIZE_FIELD_LABEL }
