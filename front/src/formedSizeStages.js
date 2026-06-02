/** 成型尺寸：同一成品在锻造/修磨各工序的尺寸记录（存库为英文逗号分隔） */

const SPLIT_RE = /[,，;；\n\r]+/

export function parseFormedSizeStages(raw) {
  if (raw === null || raw === undefined || raw === '') return []
  return String(raw)
    .split(SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean)
}

export function joinFormedSizeStages(stages) {
  const list = (Array.isArray(stages) ? stages : [])
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
  return list.length ? list.join(',') : ''
}

/** 列表、打印等单行展示：φ300 → φ290 → φ288 */
export function formatFormedSizeStagesText(raw) {
  const stages = parseFormedSizeStages(raw)
  if (!stages.length) return ''
  if (stages.length === 1) return stages[0]
  return stages.join(' → ')
}

export function formedSizeStageLabel(index) {
  return `第 ${index + 1} 道`
}

export const FORMED_SIZE_FIELD_LABEL = '成型尺寸（工序）'
