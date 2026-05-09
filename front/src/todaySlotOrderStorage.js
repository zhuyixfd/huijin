/** 今日第1～10排件号排序（按日历日存 localStorage） */

const KEY = 'hj_today_slot_order_v1'

export function todayCalendarKey() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function emptyTen() {
  return Array(10).fill('')
}

function padTen(slots) {
  return Array.from({ length: 10 }, (_, i) => String(slots?.[i] ?? '').trim())
}

export function loadTodaySlotOrder() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return emptyTen()
    const o = JSON.parse(raw)
    if (o.date !== todayCalendarKey()) return emptyTen()
    return padTen(o.slots)
  } catch {
    return emptyTen()
  }
}

export function saveTodaySlotOrder(slots) {
  localStorage.setItem(
    KEY,
    JSON.stringify({ date: todayCalendarKey(), slots: padTen(slots) }),
  )
}
