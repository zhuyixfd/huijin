/** 与 backend processing_codes.DAY_CODE_CYCLE 一致：每月按日序 1→A … 31→e */
export const DAY_CODE_CYCLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcde'

/** 指定日期（默认今天）的新排产件号首字母 */
export function dayCodeCharForDate(d = new Date()) {
  const day = d.getDate()
  const idx = Math.max(1, Math.min(day, DAY_CODE_CYCLE.length)) - 1
  return DAY_CODE_CYCLE[idx]
}

/** 1～31 日对应字母及在制件数（用于处理中页件号条） */
export function buildProcessingDayColumns(strip = []) {
  const counts = new Map()
  for (const row of strip) {
    if (!row || row.letter == null) continue
    counts.set(String(row.letter), Number(row.count) || 0)
  }
  return [...DAY_CODE_CYCLE].map((letter, i) => ({
    day: i + 1,
    letter,
    count: counts.get(letter) ?? 0,
  }))
}
