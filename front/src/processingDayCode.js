/** 与 backend processing_codes.DAY_CODE_CYCLE 一致：每月按日序 1→A … 31→e */
export const DAY_CODE_CYCLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcde'

/** 指定日期（默认今天）的新排产件号首字母 */
export function dayCodeCharForDate(d = new Date()) {
  const day = d.getDate()
  const idx = Math.max(1, Math.min(day, DAY_CODE_CYCLE.length)) - 1
  return DAY_CODE_CYCLE[idx]
}
