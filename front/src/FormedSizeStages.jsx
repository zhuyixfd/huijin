function fmtText(v) {
  const s = v === null || v === undefined ? '' : String(v)
  const t = s.trim()
  return t ? t : '—'
}

export function FormedSizeStagesView({ value, variant = 'compact' }) {
  const s = fmtText(value)
  if (variant === 'compact') return <span title={s}>{s}</span>
  return <div className="text-cell">{s}</div>
}

export function FormedSizeStagesEditor({ value, onChange }) {
  return (
    <textarea
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value)}
      rows={2}
      placeholder="可选"
    />
  )
}

