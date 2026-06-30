const DAY_CODE_CYCLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcde'

export function buildProcessingDayColumns(processing_piece_strip) {
  const list = Array.isArray(processing_piece_strip) ? processing_piece_strip : []
  const map = new Map()
  for (const x of list) {
    const letter = x?.letter
    if (typeof letter !== 'string' || !letter.trim()) continue
    const count = Number(x?.count)
    map.set(letter.trim(), Number.isFinite(count) ? count : 0)
  }
  return Array.from(DAY_CODE_CYCLE).map((letter, idx) => ({
    day: idx + 1,
    letter,
    count: map.get(letter) ?? 0,
  }))
}

