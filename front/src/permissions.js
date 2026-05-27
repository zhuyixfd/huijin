/** 与后端 app.permissions 一致 */
export const PERM = {
  ORDER_CREATE: 'order_create',
  ORDER_PROCESS: 'order_process',
  ORDER_OUTBOUND: 'order_outbound',
  ORDER_CONFIRM_SHIP: 'order_confirm_ship',
}

export const PERM_LABELS = {
  [PERM.ORDER_CREATE]: '新建订单',
  [PERM.ORDER_PROCESS]: '处理订单',
  [PERM.ORDER_OUTBOUND]: '出库订单',
  [PERM.ORDER_CONFIRM_SHIP]: '确认出库',
}

/** 管理员或未配置权限的员工：视为具备全部业务权限 */
export function can(user, code) {
  if (!user) return false
  if (user.role === 'admin') return true
  const raw = user.permission_codes
  if (!Array.isArray(raw) || raw.length === 0) return true
  return raw.includes(code)
}

export function canAnyOrderNav(user) {
  return (
    can(user, PERM.ORDER_CREATE) ||
    can(user, PERM.ORDER_PROCESS) ||
    can(user, PERM.ORDER_OUTBOUND) ||
    can(user, PERM.ORDER_CONFIRM_SHIP)
  )
}

export function canNavPending(user) {
  return can(user, PERM.ORDER_CREATE) || can(user, PERM.ORDER_PROCESS)
}

export function canNavProcessing(user) {
  return can(user, PERM.ORDER_PROCESS)
}

export function canNavReadyOutbound(user) {
  return can(user, PERM.ORDER_OUTBOUND) || can(user, PERM.ORDER_CONFIRM_SHIP)
}

export function canNavDone(user) {
  return can(user, PERM.ORDER_OUTBOUND) || can(user, PERM.ORDER_CONFIRM_SHIP)
}

/** 帐号管理里勾选顺序 */
export const PERM_OPTIONS = [
  [PERM.ORDER_CREATE, PERM_LABELS[PERM.ORDER_CREATE]],
  [PERM.ORDER_PROCESS, PERM_LABELS[PERM.ORDER_PROCESS]],
  [PERM.ORDER_OUTBOUND, PERM_LABELS[PERM.ORDER_OUTBOUND]],
  [PERM.ORDER_CONFIRM_SHIP, PERM_LABELS[PERM.ORDER_CONFIRM_SHIP]],
]
