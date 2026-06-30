export const FORMED_SIZE_FIELD_LABEL = '成型尺寸'

export function formatFormedSizeStagesText(value) {
  if (value === null || value === undefined) return ''
  const s = String(value).trim()
  return s
}
