import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './Pages.css'
import { deleteReq, getJson, patchJson, postFormData, postJson, putFormData, putJson } from './api.js'
import { openPrint } from './printSlip.js'
import {
  formatSlotPiecesDisplay,
  joinSlotPieces,
  loadTodaySlotOrder,
  parseSlotPieces,
  saveTodaySlotOrder,
} from './todaySlotOrderStorage.js'
import { openDeliverySlipPreview } from './deliverySheetPrint.js'
import { openWorkshopProductionPreview } from './workshopSheetPrint.js'
import { apiUrl } from './config.js'
import Modal from './Modal.jsx'
import { FinishedOutputsEditor, FinishedOutputsView } from './FinishedOutputs.jsx'
import {
  emptyFinishedOutput,
  formatForgingSpecCsv,
  formatForgingSpecHtml,
  normalizeFinishedOutputsForApi,
  parseFinishedOutputsFromItem,
} from './finishedOutputs.js'
import { buildProcessingDayColumns } from './processingDayCode.js'
import { can, PERM } from './permissions.js'
import CaseStudyEditorModal from './CaseStudyEditorModal.jsx'

function todayDateISO() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function todayDatetimeLocal() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

function preventModalFormEnterSubmit(e) {
  if (e.key !== 'Enter') return
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
  const tag = e.target?.tagName
  if (tag === 'TEXTAREA') return
  e.preventDefault()
}

function DragDropFileButton({ accept, multiple, disabled, label, meta, onFiles }) {
  const inputRef = useRef(null)
  const [dragOver, setDragOver] = useState(false)
  const pick = useCallback(() => {
    if (disabled) return
    inputRef.current?.click()
  }, [disabled])
  return (
    <div
      className={['file-drop-zone', dragOver ? 'is-dragover' : '', disabled ? 'is-disabled' : '']
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onClick={pick}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        pick()
      }}
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (disabled) return
        const files = Array.from(e.dataTransfer?.files || [])
        if (!files.length) return
        onFiles(files)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        className="file-drop-input"
        onChange={(e) => {
          const files = Array.from(e.target.files || [])
          e.target.value = ''
          if (!files.length) return
          onFiles(files)
        }}
      />
      <span className="file-drop-label">{label}</span>
      {meta ? <span className="file-drop-meta muted">{meta}</span> : null}
    </div>
  )
}

const emptyItemForm = () => ({
  incoming_no: '',
  material_grade: '',
  spec_incoming: '',
  weight_incoming: '',
  incoming_quantity: '',
  quantity: '',
  forging_requirements: '',
  remark: '',
  remark_images: [],
  incoming_sheet_images: [],
  production_status: '在库中',
  incoming_date: todayDateISO(),
  cutting_time: todayDatetimeLocal(),
})

const emptyWorkOrderForm = () => ({
  customer_id: '',
  order_remark: '',
  ...emptyItemForm(),
})

function fmtDateTime(iso) {
  if (!iso) return '—'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return String(iso)
  return t.toLocaleString('zh-CN', { hour12: false })
}

function fmtDate(v) {
  if (!v) return '—'
  const s = String(v)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const t = new Date(s)
  return Number.isNaN(t.getTime()) ? s : t.toLocaleDateString('zh-CN')
}

function fmtCuttingDate(v) {
  if (!v) return '—'
  const t = new Date(v)
  if (Number.isNaN(t.getTime())) return String(v).slice(0, 16)
  return t.toLocaleDateString('zh-CN')
}

function fmtNum(v) {
  if (v === null || v === undefined || v === '') return '—'
  return String(v)
}

function compareOrderNo(a, b) {
  const sa = String(a ?? '')
  const sb = String(b ?? '')
  const pa = sa.match(/^(.*?)-(\d+)$/)
  const pb = sb.match(/^(.*?)-(\d+)$/)
  const ba = pa ? pa[1] : sa
  const bb = pb ? pb[1] : sb
  const baseCmp = ba.localeCompare(bb, 'zh-CN')
  if (baseCmp !== 0) return baseCmp
  if (pa && pb) return Number(pa[2]) - Number(pb[2])
  return sa.localeCompare(sb, 'zh-CN')
}

/** 列表行「案例」徽标：折叠摘要看整单条数；展开按件看 case_study_by_unit */
function caseStudyBadgeCount(it, todayExpand) {
  if (todayExpand?.groupSummary) {
    return Number(it.case_study_count) || 0
  }
  if (todayExpand && typeof todayExpand.unitIndex === 'number') {
    const m = it.case_study_by_unit ?? {}
    return Number(m[String(todayExpand.unitIndex)]) || 0
  }
  return Number(it.case_study_count) || 0
}

function itemUnitCount(it) {
  const qty = Number(it?.quantity)
  if (!Number.isFinite(qty) || qty < 1) return 0
  return Math.floor(qty)
}

function itemQuantityOrNull(it) {
  const qty = Number(it?.quantity)
  if (!Number.isFinite(qty) || qty < 1) return null
  return Math.floor(qty)
}

function finishedOutputsQuantityOrNull(rows) {
  const list = Array.isArray(rows) ? rows : []
  let total = 0
  let any = false
  for (const row of list) {
    const pieces = Number(row?.pieces)
    if (!Number.isFinite(pieces) || pieces < 1) continue
    total += Math.floor(pieces)
    any = true
  }
  return any ? total : null
}

function isMultiUnitItem(it) {
  return itemUnitCount(it) > 1
}

function stripUnitCodeSuffix(code) {
  const s = String(code ?? '').trim()
  const m = s.match(/^(.*?)-(\d+)$/)
  return m ? m[1] : s
}

function inferPieceCodePrefixFromUnitCodes(unitCodes) {
  const codes = Array.isArray(unitCodes)
    ? unitCodes.map((x) => String(x ?? '').trim()).filter(Boolean)
    : []
  if (codes.length === 0) return ''
  const prefixes = codes.map(stripUnitCodeSuffix).filter(Boolean)
  if (prefixes.length === 0) return ''
  const first = prefixes[0]
  const allSame = prefixes.every((p) => p === first)
  return allSame ? first : first
}

function buildUnitCodesFromPrefix(prefix, qty) {
  const raw = String(prefix ?? '').trim()
  const base = stripUnitCodeSuffix(raw)
  const n = Number(qty)
  const count = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1
  if (!base) return Array.from({ length: count }, () => '')
  if (count === 1) return [base]
  return Array.from({ length: count }, (_, i) => `${base}-${i + 1}`)
}

function isValidPiecePrefix(prefix) {
  const s = String(prefix ?? '').trim()
  if (!s) return false
  return /^([A-Z]|[a-e])\d+$/.test(s)
}

function isMultiSpecFamilyChild(it) {
  return (
    Boolean(it?.split_base_order_no) &&
    !it?.split_group_id &&
    it?.split_seq !== null &&
    it?.split_seq !== undefined &&
    Number(it?.split_seq) > 0
  )
}

function statusOptionsForRow(it, tasksPreset, statuses) {
  const base = Array.isArray(statuses) ? statuses : []
  if (!isMultiSpecFamilyChild(it)) return base
  return base
}

function buildUnitStatuses(it, qtyOverride = null) {
  const qty = qtyOverride ?? itemUnitCount(it)
  if (!Number.isFinite(qty) || qty < 1) return []
  const fallback = String(it?.production_status ?? '').trim() || '在库中'
  const raw = Array.isArray(it?.unit_production_statuses) ? it.unit_production_statuses : null
  if (raw && raw.length === qty) return [...raw]
  const base = raw
    ? raw.map((s) => {
      const t = String(s ?? '').trim()
      return t || fallback
    })
    : []
  while (base.length < qty) base.push(fallback)
  return base.slice(0, qty)
}

/** 今日处理展开后：用于排序弹窗的件号池（与列表件号列一致） */
function buildTodaySlotPiecePool(expandedBands) {
  return expandedBands.map((row) => {
    const it = row.it
    const label = String(row.unitLabel ?? '').trim() || '—'
    const key = `${it.id}-${row.unitIndex}`
    const orderNo = String(it.order_no ?? '').trim()
    return {
      key,
      label,
      orderNo,
      detailId: it.id,
      unitIndex: row.unitIndex,
    }
  })
}

/** 件号首字母筛选（区分大小写：A 与 a 不同） */
function pieceLabelMatchesLetterFilter(unitLabel, letterKey) {
  if (!letterKey) return true
  const label = String(unitLabel ?? '').trim()
  if (!label || label === '—') return false
  return label[0] === letterKey
}

/** 今日处理折叠行：件号显示首件 + 省略，如 A1… */
function todayClusterPieceLabelShort(clusterBands) {
  const codes = clusterBands
    .map((r) => r.unitLabel)
    .filter((x) => x && x !== '—')
  if (codes.length === 0) return '—'
  if (codes.length === 1) return codes[0]
  return `${codes[0]}…`
}

async function ensureProcessingCodesForItems(itemIds, dayOfMonth = null) {
  const ids = Array.isArray(itemIds) ? itemIds.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0) : []
  if (ids.length === 0) return false
  const day = Number(dayOfMonth)
  const fallbackDay = new Date().getDate()
  const dom = Number.isFinite(day) && day >= 1 && day <= 31 ? day : fallbackDay
  try {
    await postJson('/api/order-items/batch-processing-codes', {
      item_ids: ids,
      day_of_month: dom,
    })
    return true
  } catch {
    return false
  }
}

function normalizeItemPayload(form) {
  const incomingQ = parseInt(String(form.incoming_quantity), 10)
  const q = parseInt(String(form.quantity), 10)
  let cutting = null
  if (form.cutting_time) {
    cutting =
      form.cutting_time.length === 16 ? `${form.cutting_time}:00` : form.cutting_time
  }
  return {
    incoming_no: form.incoming_no || null,
    material_grade: form.material_grade || null,
    spec_incoming: form.spec_incoming || null,
    weight_incoming: form.weight_incoming === '' ? null : String(form.weight_incoming),
    incoming_quantity: Number.isFinite(incomingQ) && incomingQ >= 1 ? incomingQ : 1,
    quantity: Number.isFinite(q) && q >= 1 ? q : null,
    forging_requirements: form.forging_requirements || null,
    remark: form.remark || null,
    remark_images:
      Array.isArray(form.remark_images) && form.remark_images.length > 0
        ? form.remark_images
        : null,
    incoming_sheet_images:
      Array.isArray(form.incoming_sheet_images) && form.incoming_sheet_images.length > 0
        ? form.incoming_sheet_images
        : null,
    production_status: form.production_status || '在库中',
    incoming_date: form.incoming_date || null,
    cutting_time: cutting,
  }
}

function taskToPrintPayload(it) {
  return {
    order: { id: it.id, order_no: it.order_no, remark: it.order_remark },
    customer: { name: it.customer_name },
    item: it,
  }
}

function dtLocal(val) {
  if (!val) return ''
  const s = String(val)
  if (s.includes('T')) return s.slice(0, 16)
  return s
}

const GS = 'task-col-group-start'
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

const MEGA_COL_VIS_STORAGE_KEY = 'tasks.mega_cols_visibility.v1'
const UI_PREF_KEY_MEGA_COL_ORDER = 'tasks.mega_cols_order.v1'
const UI_PREF_KEY_DETAIL_INCOMING_COL_ORDER = 'tasks.detail_incoming_cols_order.v1'
const UI_PREF_KEY_DETAIL_LOG_COL_ORDER = 'tasks.detail_log_cols_order.v1'
const UI_PREF_KEY_MEGA_COL_WIDTHS = 'tasks.mega_cols_widths.v1'
const UI_PREF_KEY_DETAIL_INCOMING_COL_WIDTHS = 'tasks.detail_incoming_cols_widths.v1'
const UI_PREF_KEY_DETAIL_LOG_COL_WIDTHS = 'tasks.detail_log_cols_widths.v1'
const MEGA_COL_DEFAULTS = {
  id: true,
  incoming_date: true,
  processing_unit: true,
  order_no: true,
  customer: true,
  material_grade: true,
  spec_incoming: true,
  weight_incoming: true,
  quantity: true,
  order_created_at: true,
  order_status: true,
  order_remark: true,
  incoming_no: true,
  weight_return: true,
  cut_head_weight: true,
  finished_outputs: true,
  finished_outputs_remark: true,
  forging_requirements: true,
  remark: true,
  cutting_time: true,
  return_date: true,
  production_status: true,
  task_actions: true,
  ready_outbound_actions: true,
}

const PENDING_ONLY_COLS = new Set([
  'customer',
  'material_grade',
  'quantity',
  'weight_incoming',
  'order_created_at',
  'order_status',
  'finished_outputs',
  'finished_outputs_remark',
  'remark',
  'production_status',
])

const MEGA_COL_DEFAULT_ORDER = [
  'id',
  'production_status',
  'incoming_date',
  'processing_unit',
  'order_no',
  'customer',
  'material_grade',
  'spec_incoming',
  'weight_incoming',
  'quantity',
  'order_created_at',
  'order_status',
  'order_remark',
  'incoming_no',
  'weight_return',
  'cut_head_weight',
  'finished_outputs',
  'finished_outputs_remark',
  'forging_requirements',
  'remark',
  'cutting_time',
  'return_date',
  'ready_outbound_actions',
  'task_actions',
]

const DETAIL_INCOMING_DEFAULT_ORDER = [
  'incoming_no',
  'material_grade',
  'spec_incoming',
  'weight_incoming',
  'incoming_quantity',
  'quantity',
  'actions',
]

const DETAIL_LOG_DEFAULT_ORDER = ['created_at', 'order_no', 'incoming_no', 'note']
const COLLAPSED_COL_WIDTH_PX = 22
const BULK_SELECT_COL_WIDTH_PX = 44
const EXTRA_TAIL_COL_WIDTH_PX = 84
const DEFAULT_MEGA_COL_WIDTH = 120
const MEGA_COL_RESIZE_RULES = {
  id: { defaultWidth: 92, ellipsisAt: 88 },
  production_status: { defaultWidth: 120, ellipsisAt: 112 },
  incoming_date: { defaultWidth: 112, ellipsisAt: 104 },
  processing_unit: { defaultWidth: 96, ellipsisAt: 92 },
  order_no: { defaultWidth: 118, ellipsisAt: 112 },
  customer: { defaultWidth: 138, ellipsisAt: 132 },
  material_grade: { defaultWidth: 96, ellipsisAt: 92 },
  spec_incoming: { defaultWidth: 150, ellipsisAt: 144 },
  weight_incoming: { defaultWidth: 102, ellipsisAt: 96 },
  quantity: { defaultWidth: 80, ellipsisAt: 76 },
  order_created_at: { defaultWidth: 134, ellipsisAt: 126 },
  order_status: { defaultWidth: 108, ellipsisAt: 102 },
  order_remark: { defaultWidth: 160, ellipsisAt: 152 },
  incoming_no: { defaultWidth: 118, ellipsisAt: 112 },
  weight_return: { defaultWidth: 102, ellipsisAt: 96 },
  cut_head_weight: { defaultWidth: 102, ellipsisAt: 96 },
  finished_outputs: { defaultWidth: 190, ellipsisAt: 182 },
  finished_outputs_remark: { defaultWidth: 154, ellipsisAt: 146 },
  forging_requirements: { defaultWidth: 190, ellipsisAt: 182 },
  remark: { defaultWidth: 160, ellipsisAt: 152 },
  cutting_time: { defaultWidth: 130, ellipsisAt: 122 },
  return_date: { defaultWidth: 120, ellipsisAt: 114 },
  ready_outbound_actions: { defaultWidth: 176, ellipsisAt: 9999 },
  task_actions: { defaultWidth: 276, ellipsisAt: 9999 },
}

function normalizeColOrder(saved, defaults) {
  const base = Array.isArray(defaults) ? defaults : []
  const raw = Array.isArray(saved) ? saved : []
  const out = []
  const seen = new Set()
  for (const k of raw) {
    const key = String(k ?? '').trim()
    if (!key) continue
    if (!base.includes(key)) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(key)
  }
  for (const k of base) {
    if (!seen.has(k)) out.push(k)
  }
  return out
}

function insertBefore(list, activeKey, beforeKey) {
  const active = String(activeKey ?? '').trim()
  const before = String(beforeKey ?? '').trim()
  if (!active || !before || active === before) return Array.isArray(list) ? list : []
  const base = Array.isArray(list) ? list : []
  const without = base.filter((k) => k !== active)
  const idx = without.indexOf(before)
  if (idx < 0) return base
  const next = [...without]
  next.splice(idx, 0, active)
  return next
}

function loadMegaColVisibility() {
  try {
    if (typeof window === 'undefined') return { ...MEGA_COL_DEFAULTS }
    const raw = window.localStorage.getItem(MEGA_COL_VIS_STORAGE_KEY)
    if (!raw) return { ...MEGA_COL_DEFAULTS }
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...MEGA_COL_DEFAULTS }
    return { ...MEGA_COL_DEFAULTS, ...parsed }
  } catch {
    return { ...MEGA_COL_DEFAULTS }
  }
}

function saveMegaColVisibility(next) {
  try {
    if (typeof window === 'undefined') return
    window.localStorage.setItem(MEGA_COL_VIS_STORAGE_KEY, JSON.stringify(next ?? {}))
  } catch {
    return
  }
}

function listPageTitle(preset) {
  switch (preset) {
    case 'all':
      return '全部订单'
    case 'pending':
      return '未处理'
    case 'processing':
      return '处理中'
    case 'ready_outbound':
      return '待出库'
    case 'done':
      return '已完成'
    case 'cut_head':
      return '切头'
    case 'split_merge_logs':
      return '拆分/合并日志'
    default:
      return '全部订单'
  }
}

/** 与侧栏预设同步传给 API 的 status_category；勿用异步 effect 写单独 state，否则切换预设时首轮请求仍沿用上一次 category，列表会串页（例如待出库短暂显示已完成）。 */
function statusCategoryFromPreset(preset) {
  switch (preset) {
    case 'pending':
      return 'waiting_inbound'
    case 'processing':
      return 'in_progress'
    case 'ready_outbound':
      return 'ready_outbound'
    case 'done':
      return 'completed'
    case 'cut_head':
      return 'all'
    case 'split_merge_logs':
      return 'all'
    case 'all':
    default:
      return 'all'
  }
}

function useLongPressColumnReorder({ getOrder, setOrder, onPersist, holdDelay = 280 }) {
  const [draggingKey, setDraggingKey] = useState(null)
  const [overKey, setOverKey] = useState(null)
  const ctxRef = useRef({
    timer: null,
    key: null,
    pointerId: null,
    startX: 0,
    startY: 0,
    dragging: false,
    overKey: null,
    originOrder: null,
  })
  const didDragRef = useRef(false)

  const sameOrder = (a, b) => {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false
    }
    return true
  }

  const cleanup = useCallback(() => {
    const ctx = ctxRef.current
    if (ctx.timer) window.clearTimeout(ctx.timer)
    ctx.timer = null
    ctx.key = null
    ctx.pointerId = null
    ctx.dragging = false
    ctx.overKey = null
    ctx.originOrder = null
    document.body.style.userSelect = ''
    setDraggingKey(null)
    setOverKey(null)
  }, [])

  const getThProps = useCallback(
    (key, opts = {}) => {
      const baseOnClick = typeof opts.onClick === 'function' ? opts.onClick : null
      const disabled = Boolean(opts.disabled)
      const label = opts.labelText ? String(opts.labelText) : ''
      const dataKey = String(key ?? '').trim()
      return {
        'data-col-key': dataKey,
        'aria-label': label || undefined,
        onClick: (e) => {
          if (didDragRef.current) {
            didDragRef.current = false
            e.preventDefault()
            e.stopPropagation()
            return
          }
          if (baseOnClick) baseOnClick(e)
        },
        onPointerDown: (e) => {
          if (disabled) return
          if (e.pointerType === 'mouse' && e.button !== 0) return
          if (!dataKey) return
          const ctx = ctxRef.current
          if (ctx.timer) window.clearTimeout(ctx.timer)
          ctx.key = dataKey
          ctx.pointerId = e.pointerId
          ctx.startX = e.clientX
          ctx.startY = e.clientY
          ctx.dragging = false
          ctx.overKey = null
          ctx.originOrder = null
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            return
          }
          ctx.timer = window.setTimeout(() => {
            const ctx2 = ctxRef.current
            if (!ctx2.key) return
            ctx2.dragging = true
            ctx2.originOrder = Array.isArray(getOrder?.()) ? [...getOrder()] : []
            ctx2.overKey = ctx2.key
            document.body.style.userSelect = 'none'
            setDraggingKey(ctx2.key)
            setOverKey(ctx2.key)
          }, holdDelay)
        },
        onPointerMove: (e) => {
          const ctx = ctxRef.current
          if (!ctx.key) return
          const dx = Math.abs(e.clientX - ctx.startX)
          const dy = Math.abs(e.clientY - ctx.startY)
          if (!ctx.dragging) {
            if (dx + dy > 8) {
              if (ctx.timer) window.clearTimeout(ctx.timer)
              ctx.timer = null
              ctx.key = null
              ctx.pointerId = null
            }
            return
          }
          e.preventDefault()
          const el = document.elementFromPoint(e.clientX, e.clientY)
          const th = el?.closest?.('th[data-col-key]')
          const nextOver = th?.getAttribute?.('data-col-key') || null
          if (!nextOver) return
          if (ctx.overKey === nextOver) return
          ctx.overKey = nextOver
          setOverKey(nextOver)
          const base = Array.isArray(ctx.originOrder) ? ctx.originOrder : []
          const preview = insertBefore(base, ctx.key, nextOver)
          setOrder(preview)
        },
        onPointerUp: () => {
          const ctx = ctxRef.current
          if (!ctx.key) {
            cleanup()
            return
          }
          const active = ctx.key
          const isDragging = Boolean(ctx.dragging)
          const over = ctx.overKey || overKey
          if (ctx.timer) window.clearTimeout(ctx.timer)
          ctx.timer = null
          ctx.key = null
          ctx.pointerId = null
          ctx.dragging = false
          document.body.style.userSelect = ''
          if (isDragging) {
            didDragRef.current = true
            const base = Array.isArray(ctx.originOrder) ? ctx.originOrder : []
            const preview = over ? insertBefore(base, active, over) : base
            const changed = over && active && active !== over && !sameOrder(base, preview)
            setOrder(preview)
            if (changed && onPersist) onPersist(preview)
          }
          setDraggingKey(null)
          setOverKey(null)
          ctx.overKey = null
          ctx.originOrder = null
        },
        onPointerCancel: () => {
          const ctx = ctxRef.current
          if (ctx.dragging) {
            const base = Array.isArray(ctx.originOrder) ? ctx.originOrder : []
            setOrder(base)
            didDragRef.current = true
          }
          cleanup()
        },
      }
    },
    [cleanup, getOrder, holdDelay, onPersist, overKey, setOrder],
  )

  return { draggingKey, overKey, getThProps }
}

function sanitizeColWidths(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    const n = typeof v === 'string' ? Number.parseFloat(v) : v
    if (!Number.isFinite(n)) continue
    const w = Math.round(n)
    if (w <= 0) continue
    out[String(k)] = w
  }
  return out
}

function measureTheadColWidths(tableEl) {
  const el = tableEl
  if (!el) return {}
  const ths = Array.from(el.querySelectorAll('thead th[data-col-key]'))
  if (ths.length === 0) return {}
  const out = {}
  for (const th of ths) {
    const key = String(th.getAttribute('data-col-key') || '').trim()
    if (!key) continue
    const w = Math.round(th.getBoundingClientRect().width)
    if (!Number.isFinite(w) || w <= 0) continue
    out[key] = w
  }
  return out
}

function getMegaColResizeRule(key) {
  const k = String(key ?? '').trim()
  const rule = MEGA_COL_RESIZE_RULES[k] || {}
  const defaultWidth = Number(rule.defaultWidth) || DEFAULT_MEGA_COL_WIDTH
  const collapseAt = COLLAPSED_COL_WIDTH_PX
  const ellipsisAt = Number(rule.ellipsisAt) || defaultWidth
  return {
    defaultWidth,
    collapseAt,
    ellipsisAt,
  }
}

export function NewWorkOrderPopup({ user = null }) {
  const [customers, setCustomers] = useState([])
  const [statuses, setStatuses] = useState([])
  const [err, setErr] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const [newWork, setNewWork] = useState(() => emptyWorkOrderForm())
  const [newWorkCustomerQ, setNewWorkCustomerQ] = useState('')
  const [newWorkFinishedOutputs, setNewWorkFinishedOutputs] = useState([
    { ...emptyFinishedOutput(), pieces: '' },
  ])
  const [newWorkRemarkFiles, setNewWorkRemarkFiles] = useState([])
  const [newWorkIncomingSheetFiles, setNewWorkIncomingSheetFiles] = useState([])
  const [newWorkRemarkPreviews, setNewWorkRemarkPreviews] = useState([])
  const [newWorkIncomingSheetPreviews, setNewWorkIncomingSheetPreviews] = useState([])
  const [newWorkRemarkPreviewOpen, setNewWorkRemarkPreviewOpen] = useState(null)
  const [newWorkIncomingSheetPreviewOpen, setNewWorkIncomingSheetPreviewOpen] = useState(null)

  useEffect(() => {
    const doc = document.documentElement
    const body = document.body
    doc.classList.add('popup-mode')
    body.classList.add('popup-mode')
    return () => {
      doc.classList.remove('popup-mode')
      body.classList.remove('popup-mode')
    }
  }, [])

  useEffect(() => {
    getJson('/api/meta/production-statuses')
      .then((d) => setStatuses(d.statuses ?? []))
      .catch(() => setStatuses([]))
    getJson('/api/customers')
      .then(setCustomers)
      .catch(() => setCustomers([]))
  }, [])

  useEffect(() => {
    let alive = true
    const files = Array.isArray(newWorkRemarkFiles) ? newWorkRemarkFiles : []
    if (files.length === 0) {
      queueMicrotask(() => setNewWorkRemarkPreviews([]))
      return () => {
        alive = false
      }
    }
    const readOne = (file) =>
      new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => resolve('')
        r.readAsDataURL(file)
      })
    ;(async () => {
      const next = []
      for (const f of files) {
        const src = await readOne(f)
        if (!src) continue
        next.push({ src, name: f?.name ?? '' })
      }
      if (!alive) return
      setNewWorkRemarkPreviews(next)
    })()
    return () => {
      alive = false
    }
  }, [newWorkRemarkFiles])

  useEffect(() => {
    let alive = true
    const files = Array.isArray(newWorkIncomingSheetFiles) ? newWorkIncomingSheetFiles : []
    if (files.length === 0) {
      queueMicrotask(() => setNewWorkIncomingSheetPreviews([]))
      return () => {
        alive = false
      }
    }
    const readOne = (file) =>
      new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => resolve('')
        r.readAsDataURL(file)
      })
    ;(async () => {
      const next = []
      for (const f of files) {
        const src = await readOne(f)
        if (!src) continue
        next.push({ src, name: f?.name ?? '' })
      }
      if (!alive) return
      setNewWorkIncomingSheetPreviews(next)
    })()
    return () => {
      alive = false
    }
  }, [newWorkIncomingSheetFiles])

  async function uploadRemarkImagesForItem(itemId, fileList) {
    if (!itemId || !fileList?.length) return []
    const fd = new FormData()
    for (const f of fileList) fd.append('files', f)
    const urls = await postFormData(`/api/order-items/${itemId}/remark-images`, fd)
    return Array.isArray(urls) ? urls : []
  }

  async function uploadIncomingSheetImagesForItem(itemId, fileList) {
    if (!itemId || !fileList?.length) return []
    const fd = new FormData()
    for (const f of fileList) fd.append('files', f)
    const urls = await postFormData(`/api/order-items/${itemId}/incoming-sheet-images`, fd)
    return Array.isArray(urls) ? urls : []
  }

  async function submitWorkOrderPopup(e) {
    e.preventDefault()
    setErr(null)
    setSubmitting(true)
    try {
      const typed = String(newWorkCustomerQ || '').trim()
      const picked = customers.find((c) => String(c?.name ?? '').trim() === typed)
      const custId = Number(newWork.customer_id) || (picked ? Number(picked.id) : 0)
      if (!custId) throw new Error('请选择客户')
      const normalizedOutputs = normalizeFinishedOutputsForApi(newWorkFinishedOutputs)
      const payload = {
        customer_id: custId,
        order_remark: newWork.order_remark || null,
        ...normalizeItemPayload(newWork),
        finished_outputs: normalizedOutputs,
      }
      const created = await postJson('/api/tasks/work-orders', payload)
      const createdItems = Array.isArray(created?.items)
        ? created.items
        : created?.id
          ? [created]
          : []
      if (!createdItems.length) throw new Error('创建失败：服务端未返回订单')
      for (const it of createdItems) {
        const itemId = it.id
        let mergedRemarkImages = Array.isArray(newWork.remark_images) ? [...newWork.remark_images] : []
        if (newWorkRemarkFiles.length > 0) {
          const up = await uploadRemarkImagesForItem(itemId, newWorkRemarkFiles)
          mergedRemarkImages = [...mergedRemarkImages, ...up]
        }
        let mergedIncomingSheetImages = Array.isArray(newWork.incoming_sheet_images)
          ? [...newWork.incoming_sheet_images]
          : []
        if (newWorkIncomingSheetFiles.length > 0) {
          const up = await uploadIncomingSheetImagesForItem(itemId, newWorkIncomingSheetFiles)
          mergedIncomingSheetImages = [...mergedIncomingSheetImages, ...up]
        }
        const patchPayload = {}
        if (mergedRemarkImages.length > 0) patchPayload.remark_images = mergedRemarkImages
        if (mergedIncomingSheetImages.length > 0) {
          patchPayload.incoming_sheet_images = mergedIncomingSheetImages
        }
        if (Object.keys(patchPayload).length > 0) {
          await patchJson(`/api/order-items/${itemId}`, patchPayload)
        }
      }
      if (window.opener && !window.opener.closed) {
        window.opener.postMessage(
          { type: 'huijin:workorder_created', item_id: createdItems[0].id },
          window.location.origin,
        )
        window.opener.focus?.()
      }
      window.close()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败')
    } finally {
      setSubmitting(false)
    }
  }

  if (user && !can(user, PERM.ORDER_PROCESS)) {
    return (
      <div className="popup-shell">
        <div className="card">
          <p className="err">无权限新建来料订单</p>
        </div>
      </div>
    )
  }

  return (
    <div className="popup-shell">
      <div className="modal-card wide modal-workorder popup-workorder-card" role="main" aria-label="新建来料订单">
        <div className="modal-card-head">
          <h2 className="modal-card-title">新建来料订单</h2>
          <button type="button" className="modal-close-x" aria-label="关闭" onClick={() => window.close()}>
            ×
          </button>
        </div>
        <div className="modal-card-body">
          <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
            一单一条来料；订单号由服务端按 hj + 该客户的「客户缩写」+ 日期 + 流水 自动生成。
          </p>
          <form className="form-grid" onSubmit={submitWorkOrderPopup} onKeyDown={preventModalFormEnterSubmit}>
            <div className="workorder-row workorder-row--2">
              <label>
                客户 *
                <input
                  list="workorder-customer-options"
                  value={newWorkCustomerQ}
                  onChange={(e) => {
                    const v = e.target.value
                    setNewWorkCustomerQ(v)
                    const picked = customers.find(
                      (c) => String(c?.name ?? '').trim() === String(v ?? '').trim(),
                    )
                    setNewWork((o) => ({ ...o, customer_id: picked ? String(picked.id) : '' }))
                  }}
                  placeholder="输入客户名称（可下拉选择）"
                  required
                />
                <datalist id="workorder-customer-options">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </label>
              <label>
                来料单
                <DragDropFileButton
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  disabled={false}
                  label="拖入/选择来料单图片"
                  meta="支持多选"
                  onFiles={(files) => setNewWorkIncomingSheetFiles((prev) => [...prev, ...files])}
                />
                {newWorkIncomingSheetFiles.length > 0 ? (
                  <p className="muted" style={{ marginTop: '0.35rem' }}>
                    已选 {newWorkIncomingSheetFiles.length} 个文件 ·{' '}
                    <button type="button" className="btn btn-ghost" onClick={() => setNewWorkIncomingSheetFiles([])}>
                      清除
                    </button>
                  </p>
                ) : null}
                {newWorkIncomingSheetPreviews.length > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                      marginTop: '0.5rem',
                    }}
                  >
                    {newWorkIncomingSheetPreviews.map((p) => (
                      <button
                        key={p.src}
                        type="button"
                        title={p.name}
                        onClick={() => setNewWorkIncomingSheetPreviewOpen(p)}
                        style={{
                          padding: 0,
                          border: 'none',
                          background: 'transparent',
                          cursor: 'zoom-in',
                        }}
                      >
                        <img
                          src={p.src}
                          alt=""
                          style={{
                            maxHeight: 120,
                            display: 'block',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                          }}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}
              </label>
            </div>

            <div className="workorder-row workorder-row--5">
              <label>
                材质
                <input
                  value={newWork.material_grade}
                  onChange={(e) => setNewWork((o) => ({ ...o, material_grade: e.target.value }))}
                />
              </label>
              <label>
                来料个数
                <input
                  type="number"
                  min={1}
                  value={newWork.incoming_quantity}
                  onChange={(e) => setNewWork((o) => ({ ...o, incoming_quantity: e.target.value }))}
                />
              </label>
              <label>
                来料规格
                <input
                  value={newWork.spec_incoming}
                  onChange={(e) => setNewWork((o) => ({ ...o, spec_incoming: e.target.value }))}
                />
              </label>
              <label>
                来料重量
                <input
                  value={newWork.weight_incoming}
                  onChange={(e) => setNewWork((o) => ({ ...o, weight_incoming: e.target.value }))}
                />
              </label>
              <label>
                来料炉号
                <input
                  value={newWork.incoming_no}
                  onChange={(e) => setNewWork((o) => ({ ...o, incoming_no: e.target.value }))}
                />
              </label>
            </div>

            <div>
              <span className="form-field-label">成品</span>
              <FinishedOutputsEditor
                rows={newWorkFinishedOutputs}
                onChange={setNewWorkFinishedOutputs}
                defaultPieces=""
                showWeightReturn
                showReturnDate
                showRemark
              />
            </div>

            <div className="workorder-row workorder-row--2">
              <label>
                锻造要求
                <textarea
                  value={newWork.forging_requirements}
                  onChange={(e) => setNewWork((o) => ({ ...o, forging_requirements: e.target.value }))}
                />
              </label>
              <label>
                锻造备注
                <textarea
                  value={newWork.remark}
                  onChange={(e) => setNewWork((o) => ({ ...o, remark: e.target.value }))}
                />
              </label>
            </div>

            <label>
              锻造备注配图（保存订单后上传）
              <DragDropFileButton
                accept="image/jpeg,image/png,image/webp,image/gif"
                multiple
                disabled={false}
                label="拖入/选择图片"
                meta="支持多选"
                onFiles={(files) => setNewWorkRemarkFiles((prev) => [...prev, ...files])}
              />
              {newWorkRemarkFiles.length > 0 ? (
                <p className="muted" style={{ marginTop: '0.35rem' }}>
                  已选 {newWorkRemarkFiles.length} 个文件 ·{' '}
                  <button type="button" className="btn btn-ghost" onClick={() => setNewWorkRemarkFiles([])}>
                    清除
                  </button>
                </p>
              ) : null}
              {newWorkRemarkPreviews.length > 0 ? (
                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '0.5rem',
                    marginTop: '0.5rem',
                  }}
                >
                  {newWorkRemarkPreviews.map((p) => (
                    <button
                      key={p.src}
                      type="button"
                      title={p.name}
                      onClick={() => setNewWorkRemarkPreviewOpen(p)}
                      style={{
                        padding: 0,
                        border: 'none',
                        background: 'transparent',
                        cursor: 'zoom-in',
                      }}
                    >
                      <img
                        src={p.src}
                        alt=""
                        style={{
                          maxHeight: 120,
                          display: 'block',
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                        }}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </label>

            <div className="workorder-row workorder-row--2">
              <label>
                生产状态
                <select
                  value={newWork.production_status}
                  onChange={(e) => setNewWork((o) => ({ ...o, production_status: e.target.value }))}
                >
                  {statuses.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                来料日期
                <input
                  type="date"
                  value={newWork.incoming_date}
                  onChange={(e) => setNewWork((o) => ({ ...o, incoming_date: e.target.value }))}
                />
              </label>
            </div>

            <label>
              下料/锻造时间
              <input
                type="datetime-local"
                value={dtLocal(newWork.cutting_time)}
                onChange={(e) => setNewWork((o) => ({ ...o, cutting_time: e.target.value }))}
              />
            </label>

            {err ? <p className="err">{err}</p> : null}
            <div className="form-actions">
              <button type="button" className="btn" onClick={() => window.close()} disabled={submitting}>
                取消
              </button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? '保存中…' : '保存'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {newWorkRemarkPreviewOpen ? (
        <Modal
          open
          wide
          zIndex={60}
          title={newWorkRemarkPreviewOpen.name || '图片预览'}
          onClose={() => setNewWorkRemarkPreviewOpen(null)}
        >
          <img
            src={newWorkRemarkPreviewOpen.src}
            alt=""
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#fff',
            }}
          />
        </Modal>
      ) : null}

      {newWorkIncomingSheetPreviewOpen ? (
        <Modal
          open
          wide
          zIndex={60}
          title={newWorkIncomingSheetPreviewOpen.name || '图片预览'}
          onClose={() => setNewWorkIncomingSheetPreviewOpen(null)}
        >
          <img
            src={newWorkIncomingSheetPreviewOpen.src}
            alt=""
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#fff',
            }}
          />
        </Modal>
      ) : null}
    </div>
  )
}

function WorkOrderCreateTab({
  tabId,
  customers,
  statuses,
  uploadRemarkImagesForItem,
  uploadIncomingSheetImagesForItem,
  onCreated,
  onRequestClose,
}) {
  const [err, setErr] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const aliveRef = useRef(true)

  const [newWork, setNewWork] = useState(() => emptyWorkOrderForm())
  const [newWorkCustomerQ, setNewWorkCustomerQ] = useState('')
  const [newWorkFinishedOutputs, setNewWorkFinishedOutputs] = useState([
    { ...emptyFinishedOutput(), pieces: '' },
  ])
  const [newWorkRemarkFiles, setNewWorkRemarkFiles] = useState([])
  const [newWorkIncomingSheetFiles, setNewWorkIncomingSheetFiles] = useState([])
  const [newWorkRemarkPreviews, setNewWorkRemarkPreviews] = useState([])
  const [newWorkIncomingSheetPreviews, setNewWorkIncomingSheetPreviews] = useState([])
  const [newWorkRemarkPreviewOpen, setNewWorkRemarkPreviewOpen] = useState(null)
  const [newWorkIncomingSheetPreviewOpen, setNewWorkIncomingSheetPreviewOpen] = useState(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    const files = Array.isArray(newWorkRemarkFiles) ? newWorkRemarkFiles : []
    if (files.length === 0) {
      queueMicrotask(() => setNewWorkRemarkPreviews([]))
      return () => {
        alive = false
      }
    }
    const readOne = (file) =>
      new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => resolve('')
        r.readAsDataURL(file)
      })
    ;(async () => {
      const next = []
      for (const f of files) {
        const src = await readOne(f)
        if (!src) continue
        next.push({ src, name: f?.name ?? '' })
      }
      if (!alive) return
      setNewWorkRemarkPreviews(next)
    })()
    return () => {
      alive = false
    }
  }, [newWorkRemarkFiles])

  useEffect(() => {
    let alive = true
    const files = Array.isArray(newWorkIncomingSheetFiles) ? newWorkIncomingSheetFiles : []
    if (files.length === 0) {
      queueMicrotask(() => setNewWorkIncomingSheetPreviews([]))
      return () => {
        alive = false
      }
    }
    const readOne = (file) =>
      new Promise((resolve) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result || ''))
        r.onerror = () => resolve('')
        r.readAsDataURL(file)
      })
    ;(async () => {
      const next = []
      for (const f of files) {
        const src = await readOne(f)
        if (!src) continue
        next.push({ src, name: f?.name ?? '' })
      }
      if (!alive) return
      setNewWorkIncomingSheetPreviews(next)
    })()
    return () => {
      alive = false
    }
  }, [newWorkIncomingSheetFiles])

  const submit = useCallback(
    async (e) => {
      e.preventDefault()
      setErr(null)
      setSubmitting(true)
      try {
        const typed = String(newWorkCustomerQ || '').trim()
        const picked = customers.find((c) => String(c?.name ?? '').trim() === typed)
        const custId = Number(newWork.customer_id) || (picked ? Number(picked.id) : 0)
        if (!custId) throw new Error('请选择客户')
        const normalizedOutputs = normalizeFinishedOutputsForApi(newWorkFinishedOutputs)
        const payload = {
          customer_id: custId,
          order_remark: newWork.order_remark || null,
          ...normalizeItemPayload(newWork),
          finished_outputs: normalizedOutputs,
        }
        const created = await postJson('/api/tasks/work-orders', payload)
        const createdItems = Array.isArray(created?.items) ? created.items : created?.id ? [created] : []
        if (!createdItems.length) throw new Error('创建失败：服务端未返回订单')
        for (const it of createdItems) {
          const itemId = it.id
          let mergedRemarkImages = Array.isArray(newWork.remark_images) ? [...newWork.remark_images] : []
          if (newWorkRemarkFiles.length > 0) {
            const up = await uploadRemarkImagesForItem(itemId, newWorkRemarkFiles)
            mergedRemarkImages = [...mergedRemarkImages, ...up]
          }
          let mergedIncomingSheetImages = Array.isArray(newWork.incoming_sheet_images)
            ? [...newWork.incoming_sheet_images]
            : []
          if (newWorkIncomingSheetFiles.length > 0) {
            const up = await uploadIncomingSheetImagesForItem(itemId, newWorkIncomingSheetFiles)
            mergedIncomingSheetImages = [...mergedIncomingSheetImages, ...up]
          }
          const patchPayload = {}
          if (mergedRemarkImages.length > 0) patchPayload.remark_images = mergedRemarkImages
          if (mergedIncomingSheetImages.length > 0) {
            patchPayload.incoming_sheet_images = mergedIncomingSheetImages
          }
          if (Object.keys(patchPayload).length > 0) {
            await patchJson(`/api/order-items/${itemId}`, patchPayload)
          }
        }
        const st = String(newWork?.production_status ?? '').trim()
        if (st && st !== '在库中' && st !== '已发回') {
          const ids = createdItems.map((x) => x?.id).filter(Boolean)
          await ensureProcessingCodesForItems(ids)
        }
        await onCreated?.(createdItems[0]?.id)
        onRequestClose?.()
      } catch (e2) {
        if (aliveRef.current) {
          setErr(e2 instanceof Error ? e2.message : '创建失败')
        }
      } finally {
        if (aliveRef.current) {
          setSubmitting(false)
        }
      }
    },
    [
      customers,
      newWork,
      newWorkCustomerQ,
      newWorkFinishedOutputs,
      newWorkRemarkFiles,
      newWorkIncomingSheetFiles,
      uploadRemarkImagesForItem,
      uploadIncomingSheetImagesForItem,
      onCreated,
      onRequestClose,
    ],
  )

  const customerOptionsId = `workorder-customer-options-${tabId}`

  return (
    <>
      <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
        一单一条来料；订单号由服务端按 hj + 该客户的「客户缩写」+ 日期 + 流水 自动生成。
      </p>
      <form className="form-grid" onSubmit={submit} onKeyDown={preventModalFormEnterSubmit}>
        <div className="workorder-row workorder-row--2">
          <label>
            客户 *
            <input
              list={customerOptionsId}
              value={newWorkCustomerQ}
              onChange={(e) => {
                const v = e.target.value
                setNewWorkCustomerQ(v)
                const picked = customers.find(
                  (c) => String(c?.name ?? '').trim() === String(v ?? '').trim(),
                )
                setNewWork((o) => ({ ...o, customer_id: picked ? String(picked.id) : '' }))
              }}
              placeholder="输入客户名称（可下拉选择）"
              required
            />
            <datalist id={customerOptionsId}>
              {customers.map((c) => (
                <option key={c.id} value={c.name} />
              ))}
            </datalist>
          </label>
          <label>
            来料单
            <DragDropFileButton
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              disabled={false}
              label="拖入/选择来料单图片"
              meta="支持多选"
              onFiles={(files) => setNewWorkIncomingSheetFiles((prev) => [...prev, ...files])}
            />
            {newWorkIncomingSheetFiles.length > 0 ? (
              <p className="muted" style={{ marginTop: '0.35rem' }}>
                已选 {newWorkIncomingSheetFiles.length} 个文件 ·{' '}
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setNewWorkIncomingSheetFiles([])}
                >
                  清除
                </button>
              </p>
            ) : null}
            {newWorkIncomingSheetPreviews.length > 0 ? (
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginTop: '0.5rem',
                }}
              >
                {newWorkIncomingSheetPreviews.map((p) => (
                  <button
                    key={p.src}
                    type="button"
                    title={p.name}
                    onClick={() => setNewWorkIncomingSheetPreviewOpen(p)}
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'zoom-in',
                    }}
                  >
                    <img
                      src={p.src}
                      alt=""
                      style={{
                        maxHeight: 120,
                        display: 'block',
                        borderRadius: 8,
                        border: '1px solid var(--border)',
                      }}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </label>
        </div>

        <div className="workorder-row workorder-row--5">
          <label>
            材质
            <input
              value={newWork.material_grade}
              onChange={(e) => setNewWork((o) => ({ ...o, material_grade: e.target.value }))}
            />
          </label>
          <label>
            来料个数
            <input
              type="number"
              min={1}
              value={newWork.incoming_quantity}
              onChange={(e) => setNewWork((o) => ({ ...o, incoming_quantity: e.target.value }))}
            />
          </label>
          <label>
            来料规格
            <input
              value={newWork.spec_incoming}
              onChange={(e) => setNewWork((o) => ({ ...o, spec_incoming: e.target.value }))}
            />
          </label>
          <label>
            来料重量
            <input
              value={newWork.weight_incoming}
              onChange={(e) => setNewWork((o) => ({ ...o, weight_incoming: e.target.value }))}
            />
          </label>
          <label>
            来料炉号
            <input
              value={newWork.incoming_no}
              onChange={(e) => setNewWork((o) => ({ ...o, incoming_no: e.target.value }))}
            />
          </label>
        </div>

        <div>
          <span className="form-field-label">成品</span>
          <FinishedOutputsEditor
            rows={newWorkFinishedOutputs}
            onChange={setNewWorkFinishedOutputs}
            defaultPieces=""
            showWeightReturn
            showReturnDate
            showRemark
          />
        </div>

        <div className="workorder-row workorder-row--2">
          <label>
            锻造要求
            <textarea
              value={newWork.forging_requirements}
              onChange={(e) => setNewWork((o) => ({ ...o, forging_requirements: e.target.value }))}
            />
          </label>
          <label>
            锻造备注
            <textarea
              value={newWork.remark}
              onChange={(e) => setNewWork((o) => ({ ...o, remark: e.target.value }))}
            />
          </label>
        </div>

        <label>
          锻造备注配图（保存订单后上传）
          <DragDropFileButton
            accept="image/jpeg,image/png,image/webp,image/gif"
            multiple
            disabled={false}
            label="拖入/选择图片"
            meta="支持多选"
            onFiles={(files) => setNewWorkRemarkFiles((prev) => [...prev, ...files])}
          />
          {newWorkRemarkFiles.length > 0 ? (
            <p className="muted" style={{ marginTop: '0.35rem' }}>
              已选 {newWorkRemarkFiles.length} 个文件 ·{' '}
              <button type="button" className="btn btn-ghost" onClick={() => setNewWorkRemarkFiles([])}>
                清除
              </button>
            </p>
          ) : null}
          {newWorkRemarkPreviews.length > 0 ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginTop: '0.5rem',
              }}
            >
              {newWorkRemarkPreviews.map((p) => (
                <button
                  key={p.src}
                  type="button"
                  title={p.name}
                  onClick={() => setNewWorkRemarkPreviewOpen(p)}
                  style={{
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    cursor: 'zoom-in',
                  }}
                >
                  <img
                    src={p.src}
                    alt=""
                    style={{
                      maxHeight: 120,
                      display: 'block',
                      borderRadius: 8,
                      border: '1px solid var(--border)',
                    }}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </label>

        <div className="workorder-row workorder-row--2">
          <label>
            生产状态
            <select
              value={newWork.production_status}
              onChange={(e) => setNewWork((o) => ({ ...o, production_status: e.target.value }))}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label>
            来料日期
            <input
              type="date"
              value={newWork.incoming_date}
              onChange={(e) => setNewWork((o) => ({ ...o, incoming_date: e.target.value }))}
            />
          </label>
        </div>

        <label>
          下料/锻造时间
          <input
            type="datetime-local"
            value={dtLocal(newWork.cutting_time)}
            onChange={(e) => setNewWork((o) => ({ ...o, cutting_time: e.target.value }))}
          />
        </label>

        {err ? <p className="err">{err}</p> : null}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '创建中…' : '创建'}
          </button>
          <button type="button" className="btn" disabled={submitting} onClick={() => onRequestClose?.()}>
            关闭
          </button>
        </div>
      </form>

      {newWorkRemarkPreviewOpen ? (
        <Modal
          open
          wide
          zIndex={60}
          title={newWorkRemarkPreviewOpen.name || '图片预览'}
          onClose={() => setNewWorkRemarkPreviewOpen(null)}
        >
          <img
            src={newWorkRemarkPreviewOpen.src}
            alt=""
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#fff',
            }}
          />
        </Modal>
      ) : null}

      {newWorkIncomingSheetPreviewOpen ? (
        <Modal
          open
          wide
          zIndex={60}
          title={newWorkIncomingSheetPreviewOpen.name || '图片预览'}
          onClose={() => setNewWorkIncomingSheetPreviewOpen(null)}
        >
          <img
            src={newWorkIncomingSheetPreviewOpen.src}
            alt=""
            style={{
              width: '100%',
              height: 'auto',
              display: 'block',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: '#fff',
            }}
          />
        </Modal>
      ) : null}
    </>
  )
}

function ForgingSpecSection({ it0, tasksPreset, statuses, user, patchStatus, patchUnitStatus }) {
  const outputs = Array.isArray(it0?.finished_outputs) ? it0.finished_outputs : []
  const codes = Array.isArray(it0?.processing_unit_codes)
    ? it0.processing_unit_codes.map((x) => String(x ?? '').trim())
    : []
  const rawUnitStatuses = Array.isArray(it0?.unit_production_statuses) ? it0.unit_production_statuses : null

  const unitRows = []
  let unitCursor = 0
  for (const fo of outputs) {
    const rawPieces = Number(fo?.pieces)
    const pieces = Number.isFinite(rawPieces) && rawPieces >= 1 ? Math.floor(rawPieces) : 0
    for (let i = 0; i < pieces; i += 1) {
      const piece = codes[unitCursor] || '—'
      const status = rawUnitStatuses?.[unitCursor] ?? ''
      unitRows.push({ unitIndex: unitCursor, piece, status, spec: fo?.spec ?? '' })
      unitCursor += 1
    }
  }
  const canEdit = can(user, PERM.ORDER_PROCESS)
  const opts = statusOptionsForRow(it0, tasksPreset, statuses)

  return (
    <section className="card order-section">
      <h2 className="order-section-title">锻造规格</h2>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: '3.5rem' }}>序号</th>
              <th style={{ width: '7rem' }}>件号</th>
              <th style={{ width: '8rem' }}>状态</th>
              <th>锻造规格</th>
            </tr>
          </thead>
          <tbody>
            {unitRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="muted">
                  {outputs.length === 0 ? '暂无锻造规格' : '支数未填写，暂不展示单支状态'}
                </td>
              </tr>
            ) : (
              unitRows.map((r, idx) => (
                <tr key={`${r.unitIndex}-${idx}`}>
                  <td className="cell-nowrap">{idx + 1}</td>
                  <td className="cell-nowrap">{r.piece || '—'}</td>
                  <td className="cell-nowrap">
                    {canEdit ? (
                      <select
                        value={r.status || it0.production_status}
                        onChange={(e) =>
                          isMultiUnitItem(it0)
                            ? patchUnitStatus(it0, r.unitIndex, e.target.value)
                            : patchStatus(it0, e.target.value)
                        }
                      >
                        {opts.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="tag">{r.status || it0.production_status}</span>
                    )}
                  </td>
                  <td
                    className="text-cell forging-spec-cell"
                    dangerouslySetInnerHTML={{
                      __html: formatForgingSpecHtml(r.spec, '—'),
                    }}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function TasksPage({
  tasksPreset = 'all',
  onTasksMutated,
  taskNavCounts,
  user = null,
}) {
  const isCutHead = tasksPreset === 'cut_head'
  const isSplitMergeLogs = tasksPreset === 'split_merge_logs'
  const listDashEmpty = tasksPreset === 'all' || tasksPreset === 'pending'
  const emptyCell = listDashEmpty ? '-' : '—'
  const [customers, setCustomers] = useState([])
  const [statuses, setStatuses] = useState([])

  const [statusFilter, setStatusFilter] = useState('')
  const [searchCol, setSearchCol] = useState('order_no')
  const [searchValue, setSearchValue] = useState('')
  const [q, setQ] = useState('')

  const [rows, setRows] = useState([])
  const [listTotal, setListTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => (tasksPreset === 'all' ? 10 : 20))
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const [view, setView] = useState('list')
  const [detail, setDetail] = useState(null)
  const [grindLogs, setGrindLogs] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [incomingSheetSubmitting, setIncomingSheetSubmitting] = useState(false)
  const [grindItem, setGrindItem] = useState(null)
  const [grindNote, setGrindNote] = useState('')
  const [grindUnitIndex, setGrindUnitIndex] = useState(null)

  const [workOrderTabs, setWorkOrderTabs] = useState([])
  const [activeWorkOrderTabId, setActiveWorkOrderTabId] = useState(null)
  const workOrderTabLabelRef = useRef(1)
  const workOrderTabIdRef = useRef(1)

  const [itemModal, setItemModal] = useState(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)
  const [itemFinishedOutputs, setItemFinishedOutputs] = useState(() => [
    { ...emptyFinishedOutput(), pieces: '' },
  ])

  const [cutHeadModalOpen, setCutHeadModalOpen] = useState(false)
  const [cutHeadPickQ, setCutHeadPickQ] = useState('')
  const [cutHeadPickRows, setCutHeadPickRows] = useState([])
  const [cutHeadPickLoading, setCutHeadPickLoading] = useState(false)
  const [cutHeadPickId, setCutHeadPickId] = useState('')
  const [cutHeadWeight, setCutHeadWeight] = useState('')
  const [cutHeadRows, setCutHeadRows] = useState([])
  const [cutHeadListLoading, setCutHeadListLoading] = useState(false)
  const [splitMergeRows, setSplitMergeRows] = useState([])
  const [splitMergeLoading, setSplitMergeLoading] = useState(false)

  const [megaColVisibility, setMegaColVisibility] = useState(loadMegaColVisibility)
  const [megaColOrder, setMegaColOrder] = useState(() => [...MEGA_COL_DEFAULT_ORDER])
  const [detailIncomingColOrder, setDetailIncomingColOrder] = useState(() => [...DETAIL_INCOMING_DEFAULT_ORDER])
  const [detailLogColOrder, setDetailLogColOrder] = useState(() => [...DETAIL_LOG_DEFAULT_ORDER])
  const megaColOrderRef = useRef(megaColOrder)
  const detailIncomingColOrderRef = useRef(detailIncomingColOrder)
  const detailLogColOrderRef = useRef(detailLogColOrder)

  const [megaColWidths, setMegaColWidths] = useState({})
  const [detailIncomingColWidths, setDetailIncomingColWidths] = useState({})
  const [detailLogColWidths, setDetailLogColWidths] = useState({})
  const megaColWidthsRef = useRef(megaColWidths)
  const detailIncomingColWidthsRef = useRef(detailIncomingColWidths)
  const detailLogColWidthsRef = useRef(detailLogColWidths)
  const [megaColWidthsLoaded, setMegaColWidthsLoaded] = useState(false)
  const [detailIncomingColWidthsLoaded, setDetailIncomingColWidthsLoaded] = useState(false)
  const [detailLogColWidthsLoaded, setDetailLogColWidthsLoaded] = useState(false)
  const [megaColWidthsHasServerValue, setMegaColWidthsHasServerValue] = useState(false)
  const [detailIncomingColWidthsHasServerValue, setDetailIncomingColWidthsHasServerValue] = useState(false)
  const [detailLogColWidthsHasServerValue, setDetailLogColWidthsHasServerValue] = useState(false)
  const [megaTableEl, setMegaTableEl] = useState(null)
  const [detailIncomingTableEl, setDetailIncomingTableEl] = useState(null)
  const [detailLogTableEl, setDetailLogTableEl] = useState(null)
  const setMegaTableRef = useCallback((el) => {
    if (!el) return
    setMegaTableEl(el)
  }, [])
  const setDetailIncomingTableRef = useCallback((el) => {
    if (!el) return
    setDetailIncomingTableEl(el)
  }, [])
  const setDetailLogTableRef = useCallback((el) => {
    if (!el) return
    setDetailLogTableEl(el)
  }, [])
  const resizeCtxRef = useRef({ raf: 0, kind: null, key: null, startX: 0, startW: 0 })

  const [selectedIds, setSelectedIds] = useState([])
  const [bulkSelectColumnVisible, setBulkSelectColumnVisible] = useState(false)
  const [batchProductionExpanded, setBatchProductionExpanded] = useState(false)
  const [batchTargetStatus, setBatchTargetStatus] = useState('')
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [batchPieceDay, setBatchPieceDay] = useState(() => String(new Date().getDate()))
  const [batchPieceSubmitting, setBatchPieceSubmitting] = useState(false)
  const [lastBatchUndo, setLastBatchUndo] = useState(null)
  /** 今日处理：同一订单号多件「聚合」为单行（按订单编号，不是隐藏表格） */
  const [collapsedTodayOrderNos, setCollapsedTodayOrderNos] = useState(() => new Set())
  /** 待完成：同订单号多件聚合（与今日处理一致） */
  const [collapsedRestOrderNos, setCollapsedRestOrderNos] = useState(() => new Set())
  const [caseModal, setCaseModal] = useState(null)
  const [caseNote, setCaseNote] = useState('')
  const [caseFiles, setCaseFiles] = useState([])
  const [caseFilePreviews, setCaseFilePreviews] = useState([])
  const [caseExistingImages, setCaseExistingImages] = useState([])
  const [caseSubmitting, setCaseSubmitting] = useState(false)
  const [caseListModal, setCaseListModal] = useState(null)
  const [caseListRows, setCaseListRows] = useState([])
  const [caseListLoading, setCaseListLoading] = useState(false)
  const [caseListErr, setCaseListErr] = useState(null)
  /** 今日第1～10排件号排序（与加工单预览排位置同结构） */
  const [todaySlotOrder, setTodaySlotOrder] = useState(() => loadTodaySlotOrder())
  const [slotOrderModalOpen, setSlotOrderModalOpen] = useState(false)
  const [slotOrderDraft, setSlotOrderDraft] = useState(() => Array(10).fill(''))
  /** 编辑排序：当前选中的排（0～9），点击件号填入该排 */
  const [slotOrderActiveSlot, setSlotOrderActiveSlot] = useState(0)
  const [processingPieceLetter, setProcessingPieceLetter] = useState('')
  const [exportModalOpen, setExportModalOpen] = useState(false)
  const [exportCustomerQ, setExportCustomerQ] = useState('')
  const [exportIncomingFrom, setExportIncomingFrom] = useState('')
  const [exportIncomingTo, setExportIncomingTo] = useState('')
  const [exportReturnFrom, setExportReturnFrom] = useState('')
  const [exportReturnTo, setExportReturnTo] = useState('')
  const [exportGroupKey, setExportGroupKey] = useState('')
  const [exportErr, setExportErr] = useState(null)
  const headerSelectRef = useRef(null)

  const [unitStatusModal, setUnitStatusModal] = useState(null)
  const [unitStatusDraft, setUnitStatusDraft] = useState([])
  const [unitCodePrefixDraft, setUnitCodePrefixDraft] = useState('')
  const [unitStatusSetAll, setUnitStatusSetAll] = useState('')
  const [unitStatusSubmitting, setUnitStatusSubmitting] = useState(false)
  const taskTableWrapRef = useRef(null)

  const [todaySplitModal, setTodaySplitModal] = useState(null)
  const [todaySplitLeftIndexes, setTodaySplitLeftIndexes] = useState([])
  const [todaySplitRightIndexes, setTodaySplitRightIndexes] = useState([])
  const [todaySplitSubmitting, setTodaySplitSubmitting] = useState(false)
  const [todaySplitEdit, setTodaySplitEdit] = useState(null)
  const lastListScrollRef = useRef({ left: 0, top: 0 })
  const lastPageScrollRef = useRef({ left: 0, top: 0 })
  const setTaskTableWrap = useCallback((el) => {
    if (!el) return
    taskTableWrapRef.current = el
  }, [])
  const captureListScroll = useCallback(() => {
    const el = taskTableWrapRef.current
    if (!el) return { ...lastListScrollRef.current }
    const pos = { left: el.scrollLeft || 0, top: el.scrollTop || 0 }
    lastListScrollRef.current = pos
    return pos
  }, [])
  const restoreListScroll = useCallback((pos) => {
    const el = taskTableWrapRef.current
    if (!el) return
    const left = Number(pos?.left) || 0
    const top = Number(pos?.top) || 0
    requestAnimationFrame(() => {
      const el2 = taskTableWrapRef.current
      if (!el2) return
      el2.scrollLeft = left
      el2.scrollTop = top
      requestAnimationFrame(() => {
        const el3 = taskTableWrapRef.current
        if (!el3) return
        el3.scrollLeft = left
        el3.scrollTop = top
      })
    })
  }, [])
  const capturePageScroll = useCallback(() => {
    if (typeof window === 'undefined') return { ...lastPageScrollRef.current }
    const pos = { left: window.scrollX || 0, top: window.scrollY || 0 }
    lastPageScrollRef.current = pos
    return pos
  }, [])
  const restorePageScroll = useCallback((pos) => {
    if (typeof window === 'undefined') return
    const left = Number(pos?.left) || 0
    const top = Number(pos?.top) || 0
    requestAnimationFrame(() => {
      window.scrollTo(left, top)
      requestAnimationFrame(() => window.scrollTo(left, top))
    })
  }, [])

  useEffect(() => {
    saveMegaColVisibility(megaColVisibility)
  }, [megaColVisibility])

  useEffect(() => {
    megaColOrderRef.current = megaColOrder
  }, [megaColOrder])

  useEffect(() => {
    detailIncomingColOrderRef.current = detailIncomingColOrder
  }, [detailIncomingColOrder])

  useEffect(() => {
    detailLogColOrderRef.current = detailLogColOrder
  }, [detailLogColOrder])

  useEffect(() => {
    megaColWidthsRef.current = megaColWidths
  }, [megaColWidths])

  useEffect(() => {
    detailIncomingColWidthsRef.current = detailIncomingColWidths
  }, [detailIncomingColWidths])

  useEffect(() => {
    detailLogColWidthsRef.current = detailLogColWidths
  }, [detailLogColWidths])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await getJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_MEGA_COL_ORDER)}`)
        if (!alive) return
        setMegaColOrder(normalizeColOrder(r?.value, MEGA_COL_DEFAULT_ORDER))
      } catch {
        return
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await getJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_INCOMING_COL_ORDER)}`)
        if (!alive) return
        setDetailIncomingColOrder(normalizeColOrder(r?.value, DETAIL_INCOMING_DEFAULT_ORDER))
      } catch {
        return
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await getJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_LOG_COL_ORDER)}`)
        if (!alive) return
        setDetailLogColOrder(normalizeColOrder(r?.value, DETAIL_LOG_DEFAULT_ORDER))
      } catch {
        return
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await getJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_MEGA_COL_WIDTHS)}`)
        if (!alive) return
        const next = sanitizeColWidths(r?.value)
        setMegaColWidths(next)
        setMegaColWidthsHasServerValue(Object.keys(next).length > 0)
        setMegaColWidthsLoaded(true)
      } catch {
        if (!alive) return
        setMegaColWidthsLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await getJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_INCOMING_COL_WIDTHS)}`)
        if (!alive) return
        const next = sanitizeColWidths(r?.value)
        setDetailIncomingColWidths(next)
        setDetailIncomingColWidthsHasServerValue(Object.keys(next).length > 0)
        setDetailIncomingColWidthsLoaded(true)
      } catch {
        if (!alive) return
        setDetailIncomingColWidthsLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await getJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_LOG_COL_WIDTHS)}`)
        if (!alive) return
        const next = sanitizeColWidths(r?.value)
        setDetailLogColWidths(next)
        setDetailLogColWidthsHasServerValue(Object.keys(next).length > 0)
        setDetailLogColWidthsLoaded(true)
      } catch {
        if (!alive) return
        setDetailLogColWidthsLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const persistMegaColOrder = useCallback(async (nextOrder) => {
    try {
      await putJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_MEGA_COL_ORDER)}`, {
        value: nextOrder,
      })
    } catch {
      return
    }
  }, [])

  const persistDetailIncomingColOrder = useCallback(async (nextOrder) => {
    try {
      await putJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_INCOMING_COL_ORDER)}`, {
        value: nextOrder,
      })
    } catch {
      return
    }
  }, [])

  const persistDetailLogColOrder = useCallback(async (nextOrder) => {
    try {
      await putJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_LOG_COL_ORDER)}`, {
        value: nextOrder,
      })
    } catch {
      return
    }
  }, [])

  const persistMegaColWidths = useCallback(async (nextWidths) => {
    try {
      await putJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_MEGA_COL_WIDTHS)}`, {
        value: nextWidths,
      })
    } catch {
      return
    }
  }, [])

  const persistDetailIncomingColWidths = useCallback(async (nextWidths) => {
    try {
      await putJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_INCOMING_COL_WIDTHS)}`, {
        value: nextWidths,
      })
    } catch {
      return
    }
  }, [])

  const persistDetailLogColWidths = useCallback(async (nextWidths) => {
    try {
      await putJson(`/api/users/me/ui-prefs/${encodeURIComponent(UI_PREF_KEY_DETAIL_LOG_COL_WIDTHS)}`, {
        value: nextWidths,
      })
    } catch {
      return
    }
  }, [])

  const megaColDnD = useLongPressColumnReorder({
    getOrder: () => megaColOrderRef.current,
    setOrder: setMegaColOrder,
    onPersist: persistMegaColOrder,
  })
  const detailIncomingDnD = useLongPressColumnReorder({
    getOrder: () => detailIncomingColOrderRef.current,
    setOrder: setDetailIncomingColOrder,
    onPersist: persistDetailIncomingColOrder,
  })
  const detailLogDnD = useLongPressColumnReorder({
    getOrder: () => detailLogColOrderRef.current,
    setOrder: setDetailLogColOrder,
    onPersist: persistDetailLogColOrder,
  })

  useEffect(() => {
    if (tasksPreset !== 'all') return
    queueMicrotask(() => {
      setPage(1)
      setPageSize(10)
    })
  }, [tasksPreset])

  const colOn = useCallback(
    (key) => {
      if (tasksPreset === 'pending') return PENDING_ONLY_COLS.has(key)
      if (tasksPreset === 'processing' && key === 'order_remark') return false
      if (key === 'formed_size') return false
      return true
    },
    [tasksPreset],
  )
  const colCollapsed = useCallback((key) => megaColVisibility?.[key] === false, [megaColVisibility])

  const setMegaColCollapsed = useCallback((key, collapsed) => {
    const k = String(key ?? '').trim()
    if (!k) return
    setMegaColVisibility((prev) => {
      const cur = prev && typeof prev === 'object' ? prev : {}
      const alreadyCollapsed = cur[k] === false
      if (collapsed && alreadyCollapsed) return cur
      if (!collapsed && !alreadyCollapsed) return cur
      const next = { ...cur }
      if (collapsed) next[k] = false
      else delete next[k]
      return next
    })
    if (!collapsed) {
      const rule = getMegaColResizeRule(k)
      setMegaColWidths((prev) => {
        const cur = prev && typeof prev === 'object' ? prev : {}
        const existing = Number(cur[k])
        const nextWidth =
          Number.isFinite(existing) && existing > rule.collapseAt ? Math.round(existing) : rule.defaultWidth
        if (existing === nextWidth) return cur
        return { ...cur, [k]: nextWidth }
      })
    }
  }, [])

  const toggleColCollapsedAlways = useCallback(
    (key) => {
      setMegaColCollapsed(key, !colCollapsed(key))
    },
    [colCollapsed, setMegaColCollapsed],
  )

  const listStatusCategory = useMemo(
    () => statusCategoryFromPreset(tasksPreset),
    [tasksPreset],
  )

  const fmtNumCell = useCallback(
    (v) => {
      if (v === null || v === undefined || v === '') return emptyCell
      return String(v)
    },
    [emptyCell],
  )

  const fmtDateCell = useCallback(
    (v) => {
      if (!v) return emptyCell
      return fmtDate(v)
    },
    [emptyCell],
  )

  const fmtDateTimeCell = useCallback(
    (v) => {
      if (!v) return emptyCell
      return fmtDateTime(v)
    },
    [emptyCell],
  )

  const fmtCuttingDateCell = useCallback(
    (v) => {
      if (!v) return emptyCell
      return fmtCuttingDate(v)
    },
    [emptyCell],
  )

  /* 侧栏切换预设时清空「按生产状态筛选」，避免与新区间的列表条件叠加 */
  useEffect(() => {
    queueMicrotask(() => setStatusFilter(''))
  }, [tasksPreset])

  function toggleTodayOrderCollapse(orderNo) {
    const key = String(orderNo ?? '')
    setCollapsedTodayOrderNos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function toggleRestOrderCollapse(orderNo) {
    const key = String(orderNo ?? '')
    setCollapsedRestOrderNos((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  useEffect(() => {
    queueMicrotask(() => {
      setBulkSelectColumnVisible(false)
      setBatchProductionExpanded(false)
      setCollapsedTodayOrderNos(new Set())
      setCollapsedRestOrderNos(new Set())
      setProcessingPieceLetter('')
    })
  }, [tasksPreset])

  useEffect(() => {
    queueMicrotask(() => setPage(1))
  }, [
    tasksPreset,
    statusFilter,
    listStatusCategory,
    q,
    searchCol,
    searchValue,
    processingPieceLetter,
    pageSize,
  ])

  useEffect(() => {
    const tp = Math.max(1, Math.ceil(listTotal / pageSize))
    if (page > tp) queueMicrotask(() => setPage(tp))
  }, [listTotal, pageSize, page])

  useEffect(() => {
    if (!bulkSelectColumnVisible) {
      queueMicrotask(() => setSelectedIds([]))
    }
  }, [bulkSelectColumnVisible])

  const showBulkCheckboxCol =
    (tasksPreset === 'processing' && can(user, PERM.ORDER_PROCESS)) ||
    (tasksPreset === 'pending' && can(user, PERM.ORDER_PROCESS)) ||
    (tasksPreset === 'ready_outbound' &&
      (can(user, PERM.ORDER_OUTBOUND) || can(user, PERM.ORDER_CONFIRM_SHIP)))

  useEffect(() => {
    if (!showBulkCheckboxCol) {
      queueMicrotask(() => setSelectedIds([]))
    }
  }, [showBulkCheckboxCol])

  useEffect(() => {
    const el = headerSelectRef.current
    if (!el || !showBulkCheckboxCol || !bulkSelectColumnVisible) return
    const onPage = rows.map((r) => r.id)
    const nSel = onPage.filter((id) => selectedIds.includes(id)).length
    el.indeterminate = onPage.length > 0 && nSel > 0 && nSel < onPage.length
  }, [showBulkCheckboxCol, bulkSelectColumnVisible, rows, selectedIds])

  async function uploadRemarkImagesForItem(itemId, fileList) {
    if (!itemId || !fileList?.length) return []
    const fd = new FormData()
    for (const f of fileList) fd.append('files', f)
    const urls = await postFormData(`/api/order-items/${itemId}/remark-images`, fd)
    return Array.isArray(urls) ? urls : []
  }

  async function uploadIncomingSheetImagesForItem(itemId, fileList) {
    if (!itemId || !fileList?.length) return []
    const fd = new FormData()
    for (const f of fileList) fd.append('files', f)
    const urls = await postFormData(`/api/order-items/${itemId}/incoming-sheet-images`, fd)
    return Array.isArray(urls) ? urls : []
  }

  const loadMeta = useCallback(() => {
    getJson('/api/meta/production-statuses').then((d) => setStatuses(d.statuses ?? []))
    getJson('/api/customers').then(setCustomers)
  }, [])

  const loadTasks = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (statusFilter) p.set('status', statusFilter)
    const sv = String(searchValue ?? '').trim()
    if (sv) {
      p.set('search_col', String(searchCol ?? '').trim() || 'order_no')
      p.set('search_value', sv)
    }
    if (tasksPreset === 'all' && statusFilter) {
      p.set('status_category', 'all')
    } else if (listStatusCategory && listStatusCategory !== 'all') {
      p.set('status_category', listStatusCategory)
    }
    if (tasksPreset === 'all') {
      if (!statusFilter || statusFilter !== '已发回') {
        p.set('exclude_completed', 'true')
      }
    }
    if (tasksPreset === 'processing') {
      const s = String(processingPieceLetter ?? '').trim()
      if (s) p.set('piece_letter', s[0])
    }
    p.set('skip', String((page - 1) * pageSize))
    p.set('limit', String(pageSize))
    const qs = p.toString()
    return getJson(`/api/tasks/items?${qs}`)
      .then((d) => {
        setErr(null)
        setRows(d.items)
        setListTotal(typeof d.total === 'number' ? d.total : 0)
        onTasksMutated?.()
      })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [
    statusFilter,
    searchCol,
    searchValue,
    listStatusCategory,
    processingPieceLetter,
    page,
    pageSize,
    tasksPreset,
    onTasksMutated,
  ])

  const loadCutHeadLogs = useCallback(() => {
    setLoading(false)
    setCutHeadListLoading(true)
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    p.set('skip', String((page - 1) * pageSize))
    p.set('limit', String(pageSize))
    getJson(`/api/tasks/cut-head-logs?${p.toString()}`)
      .then((d) => {
        setErr(null)
        setCutHeadRows(Array.isArray(d.items) ? d.items : [])
        const tt = typeof d.total === 'number' ? d.total : 0
        setListTotal(tt)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setCutHeadListLoading(false))
  }, [q, page, pageSize])

  const loadSplitMergeLogs = useCallback(() => {
    setLoading(false)
    setSplitMergeLoading(true)
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    p.set('skip', String((page - 1) * pageSize))
    p.set('limit', String(pageSize))
    getJson(`/api/tasks/split-merge-logs?${p.toString()}`)
      .then((d) => {
        setErr(null)
        setSplitMergeRows(Array.isArray(d.items) ? d.items : [])
        const tt = typeof d.total === 'number' ? d.total : 0
        setListTotal(tt)
      })
      .catch((e) => setErr(e.message))
      .finally(() => setSplitMergeLoading(false))
  }, [q, page, pageSize])

  useEffect(() => {
    queueMicrotask(() => loadMeta())
  }, [loadMeta])

  useEffect(() => {
    if (isSplitMergeLogs) {
      queueMicrotask(() => loadSplitMergeLogs())
    } else if (isCutHead) {
      queueMicrotask(() => loadCutHeadLogs())
    } else {
      queueMicrotask(() => loadTasks())
    }
  }, [isSplitMergeLogs, isCutHead, loadTasks, loadCutHeadLogs, loadSplitMergeLogs])

  useEffect(() => {
    if (!cutHeadModalOpen) return
    let alive = true
    const tid = window.setTimeout(() => {
      setCutHeadPickLoading(true)
      const p = new URLSearchParams()
      p.set('status_category', 'in_progress')
      p.set('skip', '0')
      p.set('limit', '200')
      if (cutHeadPickQ.trim()) p.set('q', cutHeadPickQ.trim())
      getJson(`/api/tasks/items?${p.toString()}`)
        .then((d) => {
          if (!alive) return
          const items = Array.isArray(d.items) ? d.items : []
          setCutHeadPickRows(items)
          if (!cutHeadPickId && items[0]?.id) {
            setCutHeadPickId(String(items[0].id))
          }
        })
        .catch(() => {
          if (!alive) return
          setCutHeadPickRows([])
        })
        .finally(() => {
          if (!alive) return
          setCutHeadPickLoading(false)
        })
    }, 200)
    return () => {
      alive = false
      window.clearTimeout(tid)
    }
  }, [cutHeadModalOpen, cutHeadPickQ, cutHeadPickId])

  async function refreshDetail(orderId) {
    const [d, logs] = await Promise.all([
      getJson(`/api/orders/${orderId}`),
      getJson(`/api/orders/${orderId}/grind-logs`).catch(() => []),
    ])
    setDetail(d)
    setGrindLogs(Array.isArray(logs) ? logs : [])
  }

  async function enterDetail(row) {
    setErr(null)
    setView('detail')
    setDetail(null)
    setGrindLogs([])
    setDetailLoading(true)
    try {
      await refreshDetail(row.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载订单失败')
      setView('list')
    } finally {
      setDetailLoading(false)
    }
  }

  function backToList() {
    setView('list')
    setDetail(null)
    setGrindLogs([])
    loadTasks()
  }

  async function patchStatus(it, nextStatus, opts = {}) {
    const scrollPos = captureListScroll()
    const pagePos = capturePageScroll()
    setErr(null)
    try {
      const unitCount = itemUnitCount(it)
      const prevCodes = Array.isArray(it?.processing_unit_codes)
        ? it.processing_unit_codes.map((x) => String(x ?? '').trim()).filter(Boolean)
        : []
      const shouldAssignCodes =
        unitCount >= 1 &&
        prevCodes.length < unitCount &&
        String(nextStatus ?? '').trim() !== '在库中' &&
        String(nextStatus ?? '').trim() !== '已发回'
      if (opts?.set_all_units) {
        await patchJson(`/api/order-items/${it.id}/unit-production-statuses`, { set_all: nextStatus })
      } else {
        await patchJson(`/api/order-items/${it.id}`, { production_status: nextStatus })
      }
      if (shouldAssignCodes) {
        await ensureProcessingCodesForItems([it.id])
      }
      await loadTasks()
      restoreListScroll(scrollPos)
      restorePageScroll(pagePos)
      if (detail?.items?.some((row) => row.id === it.id)) await refreshDetail(detail.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新失败'
      setErr(msg)
      if (msg.includes('同批订单未全部待发回')) window.alert(msg)
    }
  }

  async function patchUnitStatus(it, unitIndex, nextStatus) {
    const idx = Number(unitIndex)
    if (!Number.isFinite(idx) || idx < 0) return
    const scrollPos = captureListScroll()
    const pagePos = capturePageScroll()
    setErr(null)
    try {
      const base = buildUnitStatuses(it)
      if (idx >= base.length) return
      base[idx] = nextStatus
      await patchJson(`/api/order-items/${it.id}/unit-production-statuses`, { unit_statuses: base })
      await loadTasks()
      restoreListScroll(scrollPos)
      restorePageScroll(pagePos)
      if (detail?.items?.some((row) => row.id === it.id)) await refreshDetail(detail.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '更新失败'
      setErr(msg)
      if (msg.includes('同批订单未全部待发回')) window.alert(msg)
    }
  }

  function openUnitStatusEditor(it) {
    const qty = itemUnitCount(it)
    const base = buildUnitStatuses(it)
    setUnitStatusDraft(base)
    const rawCodes = Array.isArray(it?.processing_unit_codes) ? it.processing_unit_codes : []
    setUnitCodePrefixDraft(inferPieceCodePrefixFromUnitCodes(rawCodes))
    setUnitStatusSetAll('')
    setUnitStatusModal({
      itemId: it.id,
      orderNo: it.order_no ?? '',
      qty,
      unitCodes: Array.isArray(it?.processing_unit_codes) ? it.processing_unit_codes : [],
      split_base_order_no: it?.split_base_order_no ?? null,
      split_seq: it?.split_seq ?? null,
      split_group_id: it?.split_group_id ?? null,
    })
  }

  async function saveUnitStatuses(e) {
    e?.preventDefault?.()
    if (!unitStatusModal) return
    const scrollPos = captureListScroll()
    const pagePos = capturePageScroll()
    setErr(null)
    setUnitStatusSubmitting(true)
    try {
      const anyProcessing = unitStatusDraft.some((s) => s !== '在库中' && s !== '已发回')
      const prefix = String(unitCodePrefixDraft ?? '').trim()
      const payload = { unit_statuses: unitStatusDraft }
      if (anyProcessing && prefix) {
        if (!isValidPiecePrefix(prefix)) {
          setErr('件号格式必须为：1 个字母 + 数字；字母仅允许 A-Z 或 a-e')
          return
        }
        payload.unit_codes = buildUnitCodesFromPrefix(prefix, unitStatusModal.qty)
      }
      await patchJson(`/api/order-items/${unitStatusModal.itemId}/unit-production-statuses`, payload)
      setUnitStatusModal(null)
      await loadTasks()
      restoreListScroll(scrollPos)
      restorePageScroll(pagePos)
      if (detail?.items?.some((row) => row.id === unitStatusModal.itemId)) {
        await refreshDetail(detail.id)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '保存失败'
      setErr(msg)
      if (msg.includes('同批订单未全部待发回')) window.alert(msg)
    } finally {
      setUnitStatusSubmitting(false)
    }
  }

  async function submitCutHead(e) {
    e.preventDefault()
    if (!cutHeadPickId) return
    if (!String(cutHeadWeight ?? '').trim()) return
    setErr(null)
    try {
      await postJson(`/api/tasks/cut-head-logs`, {
        order_item_id: Number(cutHeadPickId),
        weight: String(cutHeadWeight).trim(),
      })
      setCutHeadModalOpen(false)
      setCutHeadPickQ('')
      setCutHeadPickRows([])
      setCutHeadPickId('')
      setCutHeadWeight('')
      if (isCutHead) loadCutHeadLogs()
      else loadTasks()
      if (detail && String(detail.id) === String(cutHeadPickId)) {
        await refreshDetail(detail.id)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : '切头重量保存失败')
    }
  }

  function captureUndoSnapshot(ids) {
    const out = []
    for (const id of ids) {
      const r = rows.find((x) => x.id === id)
      if (r) {
        out.push({
          id,
          production_status: r.production_status,
          in_today_queue: Boolean(r.in_today_queue),
          in_tomorrow_queue: Boolean(r.in_tomorrow_queue),
        })
      }
    }
    return out
  }

  async function undoLastBatch() {
    if (!lastBatchUndo?.length) return
    setErr(null)
    setBatchSubmitting(true)
    try {
      for (const u of lastBatchUndo) {
        await patchJson(`/api/order-items/${u.id}`, {
          production_status: u.production_status,
          in_today_queue: u.in_today_queue,
          in_tomorrow_queue: u.in_tomorrow_queue,
        })
      }
      setLastBatchUndo(null)
      setSelectedIds([])
      loadTasks()
      if (view === 'detail' && detail?.id) {
        await refreshDetail(detail.id)
      }
    } catch (err) {
      setErr(err instanceof Error ? err.message : '撤回失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  async function submitStartProcessingToday() {
    const ids = selectedIds.filter((id) => {
      const st = rows.find((r) => r.id === id)?.production_status
      return st === '在库中'
    })
    if (ids.length === 0) return
    setErr(null)
    setBatchSubmitting(true)
    const snap = captureUndoSnapshot(ids)
    try {
      await postJson('/api/order-items/batch-production-status', {
        item_ids: ids,
        production_status: '锻造中',
        in_today_queue: true,
      })
      await ensureProcessingCodesForItems(ids)
      setLastBatchUndo(snap)
      setSelectedIds([])
      loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  async function submitGrind(e) {
    e.preventDefault()
    if (!grindItem) return
    setErr(null)
    try {
      await postJson(`/api/order-items/${grindItem.id}/grind-logs`, {
        note: grindNote || null,
        unit_index: grindUnitIndex,
      })
      setGrindItem(null)
      setGrindNote('')
      setGrindUnitIndex(null)
      loadTasks()
      if (detail?.items?.some((row) => row.id === grindItem.id)) await refreshDetail(detail.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '记录失败')
    }
  }

  function openEditItem(it) {
    const inferredPrefix = inferPieceCodePrefixFromUnitCodes(it?.processing_unit_codes)
    const parsedOutputs = parseFinishedOutputsFromItem(it).map((r) => {
      const pcRaw = String(r?.piece_code ?? '').trim()
      const pc = pcRaw ? stripUnitCodeSuffix(pcRaw) : ''
      if (pc) return { ...r, piece_code: pc }
      if (!inferredPrefix) return { ...r, piece_code: '' }
      return { ...r, piece_code: stripUnitCodeSuffix(inferredPrefix) }
    })
    setItemForm({
      incoming_no: it.incoming_no ?? '',
      material_grade: it.material_grade ?? '',
      spec_incoming: it.spec_incoming ?? '',
      weight_incoming: it.weight_incoming ?? '',
      incoming_quantity: it.incoming_quantity ?? 1,
      quantity: it.quantity ?? '',
      forging_requirements: it.forging_requirements ?? '',
      remark: it.remark ?? '',
      remark_images: Array.isArray(it.remark_images) ? [...it.remark_images] : [],
      incoming_sheet_images: Array.isArray(it.incoming_sheet_images) ? [...it.incoming_sheet_images] : [],
      production_status: it.production_status ?? '在库中',
      incoming_date: it.incoming_date ? String(it.incoming_date).slice(0, 10) : todayDateISO(),
      cutting_time: it.cutting_time
        ? String(it.cutting_time).slice(0, 16).replace('T', 'T')
        : todayDatetimeLocal(),
    })
    setItemFinishedOutputs(parsedOutputs)
    setItemModal({
      itemId: it.id,
      split_base_order_no: it?.split_base_order_no ?? null,
      split_group_id: it?.split_group_id ?? null,
      split_seq: it?.split_seq ?? null,
    })
  }

  async function submitItem(e) {
    e.preventDefault()
    if (!detail || !itemModal) return
    setErr(null)
    const nextStatus = String(itemForm?.production_status ?? '').trim()
    const normalizedFinishedOutputs = normalizeFinishedOutputsForApi(itemFinishedOutputs)
    const fullPayload = {
      ...normalizeItemPayload(itemForm),
      finished_outputs: normalizedFinishedOutputs,
    }
    try {
      const cur = (detail.items ?? []).find((x) => x && String(x.id) === String(itemModal.itemId))
      const desiredPrefix = String(
        itemFinishedOutputs?.find((r) => String(r?.piece_code ?? '').trim())?.piece_code ?? '',
      ).trim()
      if (desiredPrefix && !isValidPiecePrefix(desiredPrefix)) {
        setErr('件号格式必须为：1 个字母 + 数字；字母仅允许 A-Z 或 a-e')
        return
      }
      let savedItem = cur ?? null
      const isGrouped =
        Boolean(cur?.split_group_id) ||
        (Boolean(cur?.split_base_order_no) && (cur?.split_group_id === null || cur?.split_group_id === undefined))
      if (isGrouped) {
        const commonKeys = [
          'incoming_no',
          'material_grade',
          'spec_incoming',
          'weight_incoming',
          'incoming_quantity',
          'formed_size',
          'forging_requirements',
          'remark',
          'remark_images',
          'incoming_sheet_images',
          'incoming_date',
          'cutting_time',
        ]
        const commonPayload = {}
        for (const k of commonKeys) {
          if (k in fullPayload) commonPayload[k] = fullPayload[k]
        }
        const perItemPayload = { ...fullPayload }
        for (const k of commonKeys) delete perItemPayload[k]
        await patchJson(`/api/order-items/${itemModal.itemId}/sync-common`, commonPayload)
        if (Object.keys(perItemPayload).length > 0) {
          savedItem = await patchJson(`/api/order-items/${itemModal.itemId}`, perItemPayload)
        }
      } else {
        savedItem = await patchJson(`/api/order-items/${itemModal.itemId}`, fullPayload)
      }
      const persistedItem = savedItem && typeof savedItem === 'object' ? savedItem : cur
      const persistedStatus = String(persistedItem?.production_status ?? nextStatus).trim()
      const persistedQuantity =
        itemQuantityOrNull(persistedItem) ??
        finishedOutputsQuantityOrNull(persistedItem?.finished_outputs)
      if (persistedItem) {
        const unitCount = persistedQuantity ?? 0
        const prevCodes = Array.isArray(persistedItem?.processing_unit_codes)
          ? persistedItem.processing_unit_codes.map((x) => String(x ?? '').trim()).filter(Boolean)
          : []
        const shouldAssignCodes =
          unitCount >= 1 &&
          prevCodes.length < unitCount &&
          persistedStatus &&
          persistedStatus !== '在库中' &&
          persistedStatus !== '已发回'
        if (shouldAssignCodes) {
          await ensureProcessingCodesForItems([itemModal.itemId])
        }
      }
      if (persistedItem && desiredPrefix && persistedQuantity !== null) {
        const qty = persistedQuantity
        const nextCodes = buildUnitCodesFromPrefix(desiredPrefix, qty)
        const prevCodes = Array.isArray(persistedItem?.processing_unit_codes)
          ? persistedItem.processing_unit_codes.map((x) => String(x ?? '').trim())
          : []
        const changed =
          nextCodes.length !== prevCodes.length ||
          nextCodes.some((c, i) => String(c ?? '').trim() !== String(prevCodes[i] ?? '').trim())
        if (changed) {
          await patchJson(`/api/order-items/${itemModal.itemId}/unit-production-statuses`, {
            unit_statuses: buildUnitStatuses(persistedItem, qty),
            unit_codes: nextCodes,
          })
        }
      }
      setItemModal(null)
      await refreshDetail(detail.id)
      loadTasks()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    }
  }

  async function uploadDetailIncomingSheetFiles(files) {
    if (!Array.isArray(files) || files.length === 0 || !detail?.items?.[0]) return
    const it0 = detail.items[0]
    const itemId = it0.id
    setErr(null)
    setIncomingSheetSubmitting(true)
    try {
      const urls = await uploadIncomingSheetImagesForItem(itemId, files)
      const prev = Array.isArray(it0.incoming_sheet_images) ? it0.incoming_sheet_images
        : []
      const merged = [...prev, ...urls]
      const isGrouped =
        Boolean(it0?.split_group_id) ||
        (Boolean(it0?.split_base_order_no) && (it0?.split_group_id === null || it0?.split_group_id === undefined))
      if (isGrouped) {
        await patchJson(`/api/order-items/${itemId}/sync-common`, { incoming_sheet_images: merged })
      } else {
        await patchJson(`/api/order-items/${itemId}`, { incoming_sheet_images: merged })
      }
      await refreshDetail(detail.id)
      loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '图片上传失败')
    } finally {
      setIncomingSheetSubmitting(false)
    }
  }

  async function removeDetailIncomingSheetImage(src) {
    if (!src || !detail?.items?.[0]) return
    const it0 = detail.items[0]
    const itemId = it0.id
    const prev = Array.isArray(it0.incoming_sheet_images)
      ? it0.incoming_sheet_images
      : []
    const next = prev.filter((x) => x !== src)
    setErr(null)
    setIncomingSheetSubmitting(true)
    try {
      const isGrouped =
        Boolean(it0?.split_group_id) ||
        (Boolean(it0?.split_base_order_no) && (it0?.split_group_id === null || it0?.split_group_id === undefined))
      if (isGrouped) {
        await patchJson(`/api/order-items/${itemId}/sync-common`, { incoming_sheet_images: next.length > 0 ? next : null })
      } else {
        await patchJson(`/api/order-items/${itemId}`, { incoming_sheet_images: next.length > 0 ? next : null })
      }
      await refreshDetail(detail.id)
      loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '保存失败')
    } finally {
      setIncomingSheetSubmitting(false)
    }
  }

  async function onItemRemarkFilesSelected(e) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (!files.length || !itemModal?.itemId) return
    setErr(null)
    try {
      const urls = await uploadRemarkImagesForItem(itemModal.itemId, files)
      setItemForm((f) => ({
        ...f,
        remark_images: [...(Array.isArray(f.remark_images) ? f.remark_images : []), ...urls],
      }))
    } catch (err) {
      setErr(err instanceof Error ? err.message : '图片上传失败')
    }
  }

  const showProductionStatusFilter = !isCutHead && !isSplitMergeLogs
  const showNewWorkOrder =
    (tasksPreset === 'all' || tasksPreset === 'pending') && can(user, PERM.ORDER_CREATE)
  const openNewWorkOrderWindow = useCallback(() => {
    setErr(null)
    const tabLabel = workOrderTabLabelRef.current
    workOrderTabLabelRef.current += 1
    const id = workOrderTabIdRef.current
    workOrderTabIdRef.current += 1
    setWorkOrderTabs((prev) => [...prev, { id, label: tabLabel }])
    setActiveWorkOrderTabId(id)
  }, [])
  const closeAllWorkOrderTabs = useCallback(() => {
    setWorkOrderTabs([])
    setActiveWorkOrderTabId(null)
    workOrderTabLabelRef.current = 1
  }, [])
  const closeWorkOrderTab = useCallback(
    (id) => {
      setWorkOrderTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id)
        const next = prev.filter((t) => t.id !== id)
        if (next.length === 0) {
          workOrderTabLabelRef.current = 1
          setActiveWorkOrderTabId(null)
          return next
        }
        if (activeWorkOrderTabId === id) {
          const pickIdx = Math.max(0, Math.min(next.length - 1, idx - 1))
          setActiveWorkOrderTabId(next[pickIdx].id)
        }
        return next
      })
    },
    [activeWorkOrderTabId],
  )
  const handleWorkOrderCreated = useCallback(
    async () => {
      await loadTasks()
      if (view === 'detail' && detail?.id) {
        await refreshDetail(detail.id)
      }
    },
    [loadTasks, view, detail],
  )
  const showBulkSelectCol = showBulkCheckboxCol && bulkSelectColumnVisible
  const showReadyOutboundActionsCol = false
  const customerColLabel = tasksPreset === 'ready_outbound' ? '收货单位' : '客户'
  const weightIncomingColLabel = tasksPreset === 'pending' ? '重量' : '来料重量'
  const finishedOutputsColLabel = '锻造规格'
  const returnDateColLabel = tasksPreset === 'done' ? '实际发回时间' : '理论发回日期'
  const showCutHeadWeightColInList = false
  /** 列表 mega 表列显隐（进入详情改状态；部分预设去掉列减轻干扰） */
  const showTaskActionsCol = tasksPreset === 'all' && !isCutHead && !isSplitMergeLogs
  const showCuttingReturnDateCols = tasksPreset !== 'pending' && !isCutHead
  const showProductionStatusCol = tasksPreset !== 'done' && !isCutHead
  const showProcessingUnitCol = tasksPreset === 'processing'

  useEffect(() => {
    function onMessage(e) {
      if (!e || e.origin !== window.location.origin) return
      const d = e.data
      if (!d || typeof d !== 'object') return
      if (d.type !== 'huijin:workorder_created') return
      loadTasks()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [loadTasks])
  const dataColCount =
    (colOn('id') ? 1 : 0) +
    (colOn('incoming_date') ? 1 : 0) +
    (showProcessingUnitCol && colOn('processing_unit') ? 1 : 0) +
    (colOn('order_no') ? 1 : 0) +
    (colOn('customer') ? 1 : 0) +
    (colOn('material_grade') ? 1 : 0) +
    (colOn('spec_incoming') ? 1 : 0) +
    (colOn('weight_incoming') ? 1 : 0) +
    (colOn('quantity') ? 1 : 0) +
    (colOn('order_created_at') ? 1 : 0) +
    (colOn('order_status') ? 1 : 0) +
    (colOn('order_remark') ? 1 : 0) +
    (colOn('incoming_no') ? 1 : 0) +
    (colOn('weight_return') ? 1 : 0) +
    (showCutHeadWeightColInList && colOn('cut_head_weight') ? 1 : 0) +
    (colOn('finished_outputs') ? 1 : 0) +
    (colOn('finished_outputs_remark') ? 1 : 0) +
    (colOn('forging_requirements') ? 1 : 0) +
    (colOn('remark') ? 1 : 0) +
    (showCuttingReturnDateCols && colOn('cutting_time') ? 1 : 0) +
    (showCuttingReturnDateCols && colOn('return_date') ? 1 : 0) +
    (showProductionStatusCol && colOn('production_status') ? 1 : 0) +
    (showTaskActionsCol && colOn('task_actions') ? 1 : 0) +
    (showReadyOutboundActionsCol && colOn('ready_outbound_actions') ? 1 : 0)
  const finishedOutputsRemarkCompact = useCallback((outputs) => {
    const rows = Array.isArray(outputs) ? outputs : []
    const remarks = rows.map((r) => String(r?.remark ?? '').trim()).filter(Boolean)
    return remarks.length ? remarks.join(' / ') : emptyCell
  }, [emptyCell])
  const listColSpan = Math.max(1, dataColCount + (showBulkSelectCol ? 1 : 0))
  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize))

  const { todayQueueRows, tomorrowQueueRows, restProcessingRows } = useMemo(() => {
    if (tasksPreset !== 'processing') {
      return { todayQueueRows: [], tomorrowQueueRows: [], restProcessingRows: [] }
    }
    const t = []
    const m = []
    const r = []
    for (const row of rows) {
      if (row.in_today_queue) t.push(row)
      else if (row.in_tomorrow_queue) m.push(row)
      else r.push(row)
    }
    return { todayQueueRows: t, tomorrowQueueRows: m, restProcessingRows: r }
  }, [rows, tasksPreset])

  const exportGroupKeyForItem = useCallback((it) => {
    const base = String(it?.split_base_order_no ?? '').trim()
    return base || String(it?.order_no ?? '').trim()
  }, [])

  const exportCandidates = useMemo(() => {
    if (tasksPreset !== 'processing') return []
    const inRange = (dateStr, from, to) => {
      const d = String(dateStr ?? '').trim()
      if (!d) return false
      if (from && d < from) return false
      if (to && d > to) return false
      return true
    }
    const collectReturnDates = (it) => {
      const out = []
      const fos = Array.isArray(it?.finished_outputs) ? it.finished_outputs : []
      for (const fo of fos) {
        const d = String(fo?.return_date ?? '').trim()
        if (d) out.push(d)
      }
      const d2 = String(it?.return_date ?? '').trim()
      if (d2) out.push(d2)
      return out
    }
    const q = String(exportCustomerQ ?? '').trim()
    const qLower = q.toLowerCase()
    const customerNameById = new Map(customers.map((c) => [String(c.id), String(c?.name ?? '').trim()]))
    return todayQueueRows.filter((it) => {
      if (q) {
        const cid2 = String(it?.customer_id ?? '').trim()
        const nm2 = String(it?.customer_name ?? '').trim() || customerNameById.get(cid2) || ''
        if (!String(nm2).toLowerCase().includes(qLower)) return false
      }
      if (exportIncomingFrom || exportIncomingTo) {
        const inc = String(it?.incoming_date ?? '').trim()
        if (!inRange(inc, exportIncomingFrom, exportIncomingTo)) return false
      }
      if (exportReturnFrom || exportReturnTo) {
        const ds = collectReturnDates(it)
        if (ds.length === 0) return false
        let ok = false
        for (const d of ds) {
          if (inRange(d, exportReturnFrom, exportReturnTo)) {
            ok = true
            break
          }
        }
        if (!ok) return false
      }
      return true
    })
  }, [
    tasksPreset,
    todayQueueRows,
    exportCustomerQ,
    exportIncomingFrom,
    exportIncomingTo,
    exportReturnFrom,
    exportReturnTo,
    customers,
  ])

  const exportGroups = useMemo(() => {
    const m = new Map()
    for (const it of exportCandidates) {
      const key = exportGroupKeyForItem(it)
      if (!key) continue
      const cur = m.get(key) ?? { key, items: [], orderNos: new Set(), customerName: '' }
      cur.items.push(it)
      cur.orderNos.add(String(it?.order_no ?? '').trim())
      if (!cur.customerName) cur.customerName = String(it?.customer_name ?? '').trim()
      m.set(key, cur)
    }
    const out = []
    for (const g of m.values()) {
      const orderNos = Array.from(g.orderNos).filter(Boolean).sort(compareOrderNo)
      out.push({
        key: g.key,
        items: g.items,
        customerName: g.customerName,
        label: orderNos.length > 1 ? `${g.key}（${orderNos.join('，')}）` : (orderNos[0] || g.key),
      })
    }
    out.sort((a, b) => compareOrderNo(a.label, b.label))
    return out
  }, [exportCandidates, exportGroupKeyForItem])

  useEffect(() => {
    if (!exportModalOpen) return
    queueMicrotask(() => {
      setExportErr(null)
      setExportGroupKey((prev) => {
        const cur = String(prev ?? '').trim()
        if (cur && exportGroups.some((g) => g.key === cur)) return cur
        return exportGroups[0]?.key ?? ''
      })
    })
  }, [exportModalOpen, exportGroups])

  const downloadExcelHtml = useCallback((filename, html) => {
    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  const exportSelectedTodayOrder = useCallback(() => {
    setExportErr(null)
    const key = String(exportGroupKey ?? '').trim()
    if (!key) {
      setExportErr('请选择要导出的订单')
      return
    }
    const g = exportGroups.find((x) => x.key === key)
    if (!g || g.items.length === 0) {
      setExportErr('无可导出数据')
      return
    }
    const escapeHtml = (s) =>
      String(s ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;')

    const expandOutputsByPiece = (it) => {
      const raw = Array.isArray(it?.finished_outputs) && it.finished_outputs.length
        ? it.finished_outputs
        : [{ spec: '', pieces: itemUnitCount(it), weight_return: it?.weight_return ?? null, return_date: it?.return_date ?? null, remark: '' }]
      const out = []
      for (const fo of raw) {
        const rawPieces = Number(fo?.pieces)
        const pieces = Number.isFinite(rawPieces) && rawPieces >= 1 ? Math.floor(rawPieces) : 1
        for (let i = 0; i < pieces; i += 1) {
          out.push({
            spec: String(fo?.spec ?? '').trim(),
            return_date: String(fo?.return_date ?? '').trim(),
            weight_return: fo?.weight_return ?? '',
            remark: String(fo?.remark ?? '').trim(),
          })
        }
      }
      return out
    }

    const expandedRows = []
    const itemsSorted = [...g.items].sort((a, b) => {
      const cmp = compareOrderNo(a.order_no, b.order_no)
      if (cmp !== 0) return cmp
      return Number(a.id) - Number(b.id)
    })
    for (const it of itemsSorted) {
      const units = itemUnitCount(it)
      const codes = Array.isArray(it?.processing_unit_codes) ? it.processing_unit_codes : []
      const unitStatuses = buildUnitStatuses(it)
      const byPiece = expandOutputsByPiece(it)
      for (let u = 0; u < units; u += 1) {
        const fo = byPiece[u] ?? byPiece[byPiece.length - 1] ?? {}
        const unitStatus = String(unitStatuses[u] ?? it.production_status ?? '在库中')
        expandedRows.push([
          String(it?.id ?? '').trim() || '—',
          String(it?.incoming_date ?? '').trim() || '—',
          fmtDateTime(it?.order_created_at),
          String(it?.incoming_no ?? '').trim() || '—',
          String(it?.material_grade ?? '').trim() || '—',
          String(it?.spec_incoming ?? '').trim() || '—',
          String(it?.weight_incoming ?? '').trim() || '—',
          String(codes[u] ?? '').trim() || '—',
          unitStatus || '—',
          String(fo?.spec ?? '').trim() || '—',
          String(fo?.return_date ?? '').trim() || '—',
          String(fo?.weight_return ?? '').trim() || '—',
          String(it?.remark ?? '').trim() || '—',
          String(it?.forging_requirements ?? '').trim() || '—',
          String(fo?.remark ?? '').trim() || '—',
        ])
      }
    }

    if (expandedRows.length === 0) {
      setExportErr('无可导出数据')
      return
    }

    const headers = [
      '明细ID',
      '来料日期',
      '下单时间',
      '炉号',
      '材质',
      '来料规格',
      '来料重量',
      '件号',
      '生产状态',
      '锻造规格',
      '送回日期',
      '送回重量',
      '锻造备注',
      '锻造要求',
      '分支备注',
    ]

    const mergeable = (v) => {
      const s = String(v ?? '').trim()
      if (!s) return false
      if (s === '—' || s === '-') return false
      return true
    }

    const mergeCols = new Set([0, 1, 2, 3, 4, 5, 6, 12, 13])
    const spansByCol = new Map()
    const rowPieceGroups = expandedRows.map((r) => {
      const g = stripUnitCodeSuffix(r?.[7] ?? '')
      if (!g) return ''
      if (g === '—' || g === '-') return ''
      return g
    })
    for (const colIdx of mergeCols) {
      const spans = Array.from({ length: expandedRows.length }, () => 1)
      let i = 0
      while (i < expandedRows.length) {
        const val = expandedRows[i][colIdx]
        const groupKey = rowPieceGroups[i]
        if (!mergeable(val)) {
          i += 1
          continue
        }
        if (!groupKey) {
          i += 1
          continue
        }
        let j = i + 1
        while (
          j < expandedRows.length &&
          expandedRows[j][colIdx] === val &&
          rowPieceGroups[j] === groupKey
        ) {
          j += 1
        }
        const len = j - i
        spans[i] = len
        for (let k = i + 1; k < j; k += 1) spans[k] = 0
        i = j
      }
      spansByCol.set(colIdx, spans)
    }

    const customerName = g.customerName || String(itemsSorted[0]?.customer_name ?? '').trim() || '—'
    const year = new Date().getFullYear()
    const fileBaseOrderNo = String(itemsSorted[0]?.order_no ?? '').trim() || g.key
    const today = new Date()
    const mm = String(today.getMonth() + 1).padStart(2, '0')
    const dd = String(today.getDate()).padStart(2, '0')
    const fileName = `${customerName}-${fileBaseOrderNo}-${year}${mm}${dd}.xls`

    const css = `
      table{border-collapse:collapse;font-family:Arial,"Microsoft YaHei",sans-serif;font-size:12pt}
      td,th{border:1px solid #333;padding:4px 6px;vertical-align:middle}
      th{background:#f3f3f3;font-weight:700;text-align:center;white-space:nowrap}
      .head td{font-weight:700}
      .num{text-align:right}
    `

    const buildRow = (cells, rowIndex) => {
      let tds = ''
      for (let c = 0; c < cells.length; c += 1) {
        const v = cells[c]
        const isNum = c === 6 || c === 11
        const spanArr = spansByCol.get(c)
        if (spanArr) {
          const span = spanArr[rowIndex]
          if (span === 0) continue
          const rs = span > 1 ? ` rowspan="${span}"` : ''
          if (c === 9) {
            tds += `<td${rs}${isNum ? ' class="num"' : ''}>${escapeHtml(formatForgingSpecCsv(v, '—'))}</td>`
          } else {
            tds += `<td${rs}${isNum ? ' class="num"' : ''}>${escapeHtml(v)}</td>`
          }
          continue
        }
        if (c === 9) {
          tds += `<td${isNum ? ' class="num"' : ''}>${escapeHtml(formatForgingSpecCsv(v, '—'))}</td>`
        } else {
          tds += `<td${isNum ? ' class="num"' : ''}>${escapeHtml(v)}</td>`
        }
      }
      return `<tr>${tds}</tr>`
    }

    const head1 = `<tr class="head"><td>客户</td><td colspan="7">${escapeHtml(customerName)}</td><td colspan="4">${escapeHtml(year)}</td><td colspan="3">计量单位:kg</td></tr>`
    const head2 = `<tr>${headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`
    const body = expandedRows.map((r, idx) => buildRow(r, idx)).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body><table>${head1}${head2}${body}</table></body></html>`
    downloadExcelHtml(fileName, html)
    setExportModalOpen(false)
  }, [downloadExcelHtml, exportGroupKey, exportGroups])

  const { waitingOutboundRows, shippingOutboundRows } = useMemo(() => {
    if (tasksPreset !== 'ready_outbound') {
      return { waitingOutboundRows: [], shippingOutboundRows: [] }
    }
    const w = []
    const s = []
    for (const row of rows) {
      if (row.production_status === '待发回') w.push(row)
      else if (row.production_status === '出库中') s.push(row)
    }
    return { waitingOutboundRows: w, shippingOutboundRows: s }
  }, [rows, tasksPreset])

  const outboundShippingSameSourceMeta = useMemo(() => {
    const countByBase = new Map()
    const maxSeqByBase = new Map()
    if (tasksPreset !== 'ready_outbound') return { countByBase, maxSeqByBase }
    for (const it of shippingOutboundRows) {
      if (!isMultiSpecFamilyChild(it)) continue
      const base = String(it?.split_base_order_no ?? '').trim()
      if (!base) continue
      const seq = Number(it?.split_seq)
      if (!Number.isFinite(seq) || seq <= 0) continue
      countByBase.set(base, (countByBase.get(base) ?? 0) + 1)
      const curMax = maxSeqByBase.get(base)
      if (curMax === undefined || seq > curMax) maxSeqByBase.set(base, seq)
    }
    return { countByBase, maxSeqByBase }
  }, [shippingOutboundRows, tasksPreset])

  async function submitAddToTodayFromProcessing() {
    const todayIds = new Set(todayQueueRows.map((r) => r.id))
    const ids = selectedIds.filter((id) => !todayIds.has(id))
    if (ids.length === 0) return
    setErr(null)
    setBatchSubmitting(true)
    const snap = captureUndoSnapshot(ids)
    try {
      for (const id of ids) {
        await patchJson(`/api/order-items/${id}`, {
          in_today_queue: true,
          in_tomorrow_queue: false,
          production_status: '锻造中',
        })
      }
      setLastBatchUndo(snap)
      setSelectedIds([])
      loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  async function submitBatchReassignProcessingCodes() {
    const day = Number(batchPieceDay)
    if (!Number.isFinite(day) || day < 1 || day > 31) {
      setErr('请选择 1～31 日')
      return
    }
    if (selectedIds.length === 0) return
    setErr(null)
    setBatchPieceSubmitting(true)
    try {
      await postJson('/api/order-items/batch-processing-codes', {
        item_ids: selectedIds,
        day_of_month: day,
      })
      await loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '件号重排失败')
    } finally {
      setBatchPieceSubmitting(false)
    }
  }

  async function submitAddToTomorrowFromProcessing() {
    const tomoIds = new Set(tomorrowQueueRows.map((r) => r.id))
    const ids = selectedIds.filter((id) => !tomoIds.has(id))
    if (ids.length === 0) return
    setErr(null)
    setBatchSubmitting(true)
    const snap = captureUndoSnapshot(ids)
    try {
      for (const id of ids) {
        await patchJson(`/api/order-items/${id}`, {
          in_today_queue: false,
          in_tomorrow_queue: true,
        })
      }
      setLastBatchUndo(snap)
      setSelectedIds([])
      loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  async function submitRemoveFromQueues() {
    const queued = new Set([
      ...todayQueueRows.map((r) => r.id),
      ...tomorrowQueueRows.map((r) => r.id),
    ])
    const ids = selectedIds.filter((id) => queued.has(id))
    if (ids.length === 0) return
    setErr(null)
    setBatchSubmitting(true)
    const snap = captureUndoSnapshot(ids)
    try {
      for (const id of ids) {
        await patchJson(`/api/order-items/${id}`, {
          in_today_queue: false,
          in_tomorrow_queue: false,
        })
      }
      setLastBatchUndo(snap)
      setSelectedIds([])
      loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '操作失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  const todayQueueQtySum = useMemo(
    () => todayQueueRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
    [todayQueueRows],
  )

  const tomorrowQueueQtySum = useMemo(
    () => tomorrowQueueRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
    [tomorrowQueueRows],
  )

  const restQueueQtySum = useMemo(
    () => restProcessingRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
    [restProcessingRows],
  )

  /** 今日处理：按订单号排序 → 按个数展开（每件一行）→ 同订单号仅首行显示订单编号 → 组间交替底色 */
  const todayQueueExpandedBands = useMemo(() => {
    const sorted = [...todayQueueRows].sort((a, b) => {
      const cmp = compareOrderNo(a.order_no, b.order_no)
      if (cmp !== 0) return cmp
      return a.id - b.id
    })
    const flat = []
    for (const it of sorted) {
      const rawQ = Number(it.quantity)
      const units = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 0
      if (units === 0) {
        flat.push({ it, unitIndex: 0, unitsTotal: 0 })
        continue
      }
      for (let u = 0; u < units; u += 1) {
        flat.push({ it, unitIndex: u, unitsTotal: units })
      }
    }
    let g = 0
    return flat.map((row, i) => {
      const ono = String(row.it.order_no ?? '')
      const prevOno = i > 0 ? String(flat[i - 1].it.order_no ?? '') : '\x00'
      if (i > 0 && ono !== prevOno) g += 1
      const codes = Array.isArray(row.it.processing_unit_codes)
        ? row.it.processing_unit_codes
        : []
      const unitLabel = codes[row.unitIndex] ?? '—'
      return {
        ...row,
        orderBand: g % 2 === 0 ? 'a' : 'b',
        showOrderNo: i === 0 || ono !== prevOno,
        unitLabel,
      }
    })
  }, [todayQueueRows])

  const todaySlotPiecePool = useMemo(
    () => buildTodaySlotPiecePool(todayQueueExpandedBands),
    [todayQueueExpandedBands],
  )

  const processingPieceLetterFilter =
    tasksPreset === 'processing' ? String(processingPieceLetter ?? '').trim() : ''
  /** 件号首字母筛选（区分大小写：A 与 a 不同） */
  const processingPieceLetterKey = useMemo(() => {
    const s = String(processingPieceLetterFilter ?? '').trim()
    return s ? s[0] : ''
  }, [processingPieceLetterFilter])

  const processingDayColumns = useMemo(
    () => buildProcessingDayColumns(taskNavCounts?.processing_piece_strip),
    [taskNavCounts?.processing_piece_strip],
  )

  const todayDayOfMonth = new Date().getDate()

  const filteredTodayQueueExpandedBands = useMemo(() => {
    if (!processingPieceLetterKey) return todayQueueExpandedBands
    return todayQueueExpandedBands.filter((row) =>
      pieceLabelMatchesLetterFilter(row.unitLabel, processingPieceLetterKey),
    )
  }, [todayQueueExpandedBands, processingPieceLetterKey])

  const filteredTodayQueueClusters = useMemo(() => {
    const flat = filteredTodayQueueExpandedBands
    const clusters = []
    let cur = []
    let curOno = null
    for (const row of flat) {
      const ono = String(row.it.order_no ?? '')
      if (ono !== curOno) {
        if (cur.length) clusters.push(cur)
        cur = [row]
        curOno = ono
      } else {
        cur.push(row)
      }
    }
    if (cur.length) clusters.push(cur)
    return clusters
  }, [filteredTodayQueueExpandedBands])

  /** 今日处理：按订单编号分簇（同一订单号多件可聚合为一行展示） */
  const todayQueueClusters = useMemo(() => {
    const flat = todayQueueExpandedBands
    const clusters = []
    let cur = []
    let curOno = null
    for (const row of flat) {
      const ono = String(row.it.order_no ?? '')
      if (ono !== curOno) {
        if (cur.length) clusters.push(cur)
        cur = [row]
        curOno = ono
      } else {
        cur.push(row)
      }
    }
    if (cur.length) clusters.push(cur)
    return clusters
  }, [todayQueueExpandedBands])

  /** 同一订单号多件：聚合/展开组数（用于标题） */
  const todayMultiFoldStats = useMemo(() => {
    let multi = 0
    let aggregated = 0
    for (const c of todayQueueClusters) {
      if (c.length <= 1) continue
      multi += 1
      const ono = String(c[0].it.order_no ?? '')
      if (collapsedTodayOrderNos.has(ono)) aggregated += 1
    }
    return { multi, aggregated, expanded: multi - aggregated }
  }, [todayQueueClusters, collapsedTodayOrderNos])

  /** 待完成：按订单号排序 → 按件展开 → 同订单号分簇（与今日处理一致） */
  const restProcessingExpandedBands = useMemo(() => {
    const sorted = [...restProcessingRows].sort((a, b) => {
      const cmp = compareOrderNo(a.order_no, b.order_no)
      if (cmp !== 0) return cmp
      return a.id - b.id
    })
    const flat = []
    for (const it of sorted) {
      const rawQ = Number(it.quantity)
      const units = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 0
      if (units === 0) {
        flat.push({ it, unitIndex: 0, unitsTotal: 0 })
        continue
      }
      for (let u = 0; u < units; u += 1) {
        flat.push({ it, unitIndex: u, unitsTotal: units })
      }
    }
    let g = 0
    return flat.map((row, i) => {
      const ono = String(row.it.order_no ?? '')
      const prevOno = i > 0 ? String(flat[i - 1].it.order_no ?? '') : '\x00'
      if (i > 0 && ono !== prevOno) g += 1
      const codes = Array.isArray(row.it.processing_unit_codes)
        ? row.it.processing_unit_codes
        : []
      const unitLabel = codes[row.unitIndex] ?? '—'
      return {
        ...row,
        orderBand: g % 2 === 0 ? 'a' : 'b',
        showOrderNo: i === 0 || ono !== prevOno,
        unitLabel,
      }
    })
  }, [restProcessingRows])

  const restProcessingClusters = useMemo(() => {
    const flat = restProcessingExpandedBands
    const clusters = []
    let cur = []
    let curOno = null
    for (const row of flat) {
      const ono = String(row.it.order_no ?? '')
      if (ono !== curOno) {
        if (cur.length) clusters.push(cur)
        cur = [row]
        curOno = ono
      } else {
        cur.push(row)
      }
    }
    if (cur.length) clusters.push(cur)
    return clusters
  }, [restProcessingExpandedBands])

  const filteredRestProcessingExpandedBands = useMemo(() => {
    if (!processingPieceLetterKey) return restProcessingExpandedBands
    return restProcessingExpandedBands.filter((row) =>
      pieceLabelMatchesLetterFilter(row.unitLabel, processingPieceLetterKey),
    )
  }, [restProcessingExpandedBands, processingPieceLetterKey])

  const filteredRestProcessingClusters = useMemo(() => {
    const flat = filteredRestProcessingExpandedBands
    const clusters = []
    let cur = []
    let curOno = null
    for (const row of flat) {
      const ono = String(row.it.order_no ?? '')
      if (ono !== curOno) {
        if (cur.length) clusters.push(cur)
        cur = [row]
        curOno = ono
      } else {
        cur.push(row)
      }
    }
    if (cur.length) clusters.push(cur)
    return clusters
  }, [filteredRestProcessingExpandedBands])

  const tomorrowQueueExpandedBands = useMemo(() => {
    if (tasksPreset !== 'processing') return []
    const sorted = [...tomorrowQueueRows].sort((a, b) => {
      const cmp = compareOrderNo(a.order_no, b.order_no)
      if (cmp !== 0) return cmp
      return a.id - b.id
    })
    const flat = []
    for (const it of sorted) {
      const rawQ = Number(it.quantity)
      const units = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 0
      if (units === 0) {
        flat.push({ it, unitIndex: 0, unitsTotal: 0 })
        continue
      }
      for (let u = 0; u < units; u += 1) {
        flat.push({ it, unitIndex: u, unitsTotal: units })
      }
    }
    let g = 0
    return flat.map((row, i) => {
      const ono = String(row.it.order_no ?? '')
      const prevOno = i > 0 ? String(flat[i - 1].it.order_no ?? '') : '\x00'
      if (i > 0 && ono !== prevOno) g += 1
      const codes = Array.isArray(row.it.processing_unit_codes)
        ? row.it.processing_unit_codes
        : []
      const unitLabel = codes[row.unitIndex] ?? '—'
      return {
        ...row,
        orderBand: g % 2 === 0 ? 'a' : 'b',
        showOrderNo: i === 0 || ono !== prevOno,
        unitLabel,
      }
    })
  }, [tasksPreset, tomorrowQueueRows])

  const filteredTomorrowQueueExpandedBands = useMemo(() => {
    if (!processingPieceLetterKey) return tomorrowQueueExpandedBands
    return tomorrowQueueExpandedBands.filter((row) =>
      pieceLabelMatchesLetterFilter(row.unitLabel, processingPieceLetterKey),
    )
  }, [tomorrowQueueExpandedBands, processingPieceLetterKey])

  const showProcessingPieceFilter =
    tasksPreset === 'processing' && Boolean(processingPieceLetterKey)
  const filteredTodayOrderCount = useMemo(() => {
    const s = new Set()
    for (const row of filteredTodayQueueExpandedBands) s.add(String(row.it.order_no ?? ''))
    return s.size
  }, [filteredTodayQueueExpandedBands])
  const filteredTomorrowOrderCount = useMemo(() => {
    const s = new Set()
    for (const row of filteredTomorrowQueueExpandedBands) s.add(String(row.it.order_no ?? ''))
    return s.size
  }, [filteredTomorrowQueueExpandedBands])
  const filteredRestOrderCount = useMemo(() => {
    const s = new Set()
    for (const row of filteredRestProcessingExpandedBands) s.add(String(row.it.order_no ?? ''))
    return s.size
  }, [filteredRestProcessingExpandedBands])

  const restMultiFoldStats = useMemo(() => {
    let multi = 0
    let aggregated = 0
    for (const c of restProcessingClusters) {
      if (c.length <= 1) continue
      multi += 1
      const ono = String(c[0].it.order_no ?? '')
      if (collapsedRestOrderNos.has(ono)) aggregated += 1
    }
    return { multi, aggregated, expanded: multi - aggregated }
  }, [restProcessingClusters, collapsedRestOrderNos])

  function toggleTodayFoldAll() {
    const multis = todayQueueClusters.filter((c) => c.length > 1)
    if (multis.length === 0) return
    const onos = multis.map((c) => String(c[0].it.order_no ?? ''))
    const allAgg = onos.every((o) => collapsedTodayOrderNos.has(o))
    setCollapsedTodayOrderNos(allAgg ? new Set() : new Set(onos))
  }

  function toggleRestFoldAll() {
    const multis = restProcessingClusters.filter((c) => c.length > 1)
    if (multis.length === 0) return
    const onos = multis.map((c) => String(c[0].it.order_no ?? ''))
    const allAgg = onos.every((o) => collapsedRestOrderNos.has(o))
    setCollapsedRestOrderNos(allAgg ? new Set() : new Set(onos))
  }

  const showCaseStudyUi = tasksPreset === 'processing' && can(user, PERM.ORDER_PROCESS)
  const multiSpecBaseIdByBaseOrderNo = useMemo(() => {
    const m = new Map()
    for (const it of rows) {
      const base = String(it?.split_base_order_no ?? '').trim()
      if (!base) continue
      if (it?.split_group_id) continue
      const seq = Number(it?.split_seq)
      if (!Number.isFinite(seq) || seq < 0) continue
      const cur = m.get(base)
      const idNum = Number(it?.id)
      if (!Number.isFinite(idNum)) continue
      if (cur === undefined || idNum < cur) m.set(base, idNum)
    }
    return m
  }, [rows])

  const multiSpecSiblingCountByBase = useMemo(() => {
    const m = new Map()
    for (const it of rows) {
      if (!isMultiSpecFamilyChild(it)) continue
      const base = String(it?.split_base_order_no ?? '').trim()
      if (!base) continue
      m.set(base, (m.get(base) ?? 0) + 1)
    }
    return m
  }, [rows])

  const multiSpecMaxChildSeqByBase = useMemo(() => {
    const m = new Map()
    for (const it of rows) {
      if (!isMultiSpecFamilyChild(it)) continue
      const base = String(it?.split_base_order_no ?? '').trim()
      if (!base) continue
      const seq = Number(it?.split_seq)
      if (!Number.isFinite(seq) || seq <= 0) continue
      const cur = m.get(base)
      if (cur === undefined || seq > cur) m.set(base, seq)
    }
    return m
  }, [rows])

  const displayItemId = useCallback(
    (it) => {
      const base = String(it?.split_base_order_no ?? '').trim()
      const seq = Number(it?.split_seq)
      if (!base || it?.split_group_id) return it?.id
      if (!Number.isFinite(seq) || seq <= 0) return it?.id
      const baseId = multiSpecBaseIdByBaseOrderNo.get(base) ?? it?.id
      return `${baseId}-${seq}`
    },
    [multiSpecBaseIdByBaseOrderNo],
  )

  const isSameSourceChildOnScreen = useCallback(
    (it) => {
      if (!isMultiSpecFamilyChild(it)) return false
      const base = String(it?.split_base_order_no ?? '').trim()
      if (!base) return false
      if ((multiSpecSiblingCountByBase.get(base) ?? 0) < 2) return false
      const seq = Number(it?.split_seq)
      const maxSeq = multiSpecMaxChildSeqByBase.get(base)
      if (maxSeq !== undefined && Number.isFinite(seq) && seq === maxSeq) return false
      return true
    },
    [multiSpecMaxChildSeqByBase, multiSpecSiblingCountByBase],
  )

  function caseUnitLabel(unitIndex, fallbackLabel) {
    if (fallbackLabel) return fallbackLabel
    if (typeof unitIndex === 'number') return `第${unitIndex + 1}件`
    return '整单'
  }

  const loadCaseStudiesForContext = useCallback(async (ctx) => {
    if (!ctx?.it?.id) return
    setCaseListLoading(true)
    setCaseListErr(null)
    try {
      const p = new URLSearchParams()
      p.set('order_item_id', String(ctx.it.id))
      if (ctx.unitIndex !== null && ctx.unitIndex !== undefined) {
        p.set('unit_index', String(ctx.unitIndex))
      }
      p.set('skip', '0')
      p.set('limit', '100')
      const resp = await getJson(`/api/case-studies?${p.toString()}`)
      setCaseListRows(Array.isArray(resp?.items) ? resp.items : [])
    } catch (e) {
      setCaseListErr(e instanceof Error ? e.message : '案例加载失败')
    } finally {
      setCaseListLoading(false)
    }
  }, [])

  function openCaseStudy(it, unitIndex, unitLabel, editingCase = null) {
    setCaseModal({
      it,
      unitIndex,
      unitLabel,
      mode: editingCase ? 'edit' : 'create',
      caseStudyId: editingCase?.id ?? null,
    })
    setCaseNote(editingCase?.note ?? '')
    setCaseFiles([])
    setCaseExistingImages(Array.isArray(editingCase?.images) ? editingCase.images : [])
    setErr(null)
  }

  function openCaseStudyList(it, unitIndex, unitLabel) {
    const ctx = { it, unitIndex, unitLabel }
    setCaseListModal(ctx)
    setCaseListRows([])
    void loadCaseStudiesForContext(ctx)
  }

  const caseFileKey = useCallback((f) => `${f?.name ?? ''}::${f?.size ?? ''}::${f?.lastModified ?? ''}`, [])

  const closeCaseStudy = useCallback(() => {
    setCaseModal(null)
    setCaseNote('')
    setCaseFiles([])
    setCaseExistingImages([])
    setErr(null)
  }, [])

  const closeCaseStudyList = useCallback(() => {
    setCaseListModal(null)
    setCaseListRows([])
    setCaseListErr(null)
  }, [])

  const appendCaseFiles = useCallback(
    (picked) => {
      const arr = Array.isArray(picked) ? picked : []
      if (arr.length === 0) return
      setCaseFiles((prev) => {
        const m = new Map()
        for (const f of prev) m.set(caseFileKey(f), f)
        for (const f of arr) m.set(caseFileKey(f), f)
        return [...m.values()]
      })
    },
    [caseFileKey],
  )

  const removeCaseFile = useCallback(
    (key) => {
      setCaseFiles((prev) => prev.filter((f) => caseFileKey(f) !== key))
    },
    [caseFileKey],
  )

  const removeExistingCaseImage = useCallback((src) => {
    setCaseExistingImages((prev) => prev.filter((it) => it !== src))
  }, [])

  useEffect(() => {
    const previews = caseFiles
      .filter((f) => String(f?.type ?? '').startsWith('image/'))
      .map((f) => ({ key: caseFileKey(f), name: f.name, url: URL.createObjectURL(f) }))
    queueMicrotask(() => setCaseFilePreviews(previews))
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url)
    }
  }, [caseFiles, caseFileKey])

  async function submitCaseStudy(e) {
    e.preventDefault()
    if (!caseModal) return
    setErr(null)
    setCaseSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('note', caseNote)
      if (caseModal.mode === 'edit' && caseModal.caseStudyId) {
        fd.append('keep_images', JSON.stringify(caseExistingImages))
      } else {
        fd.append('order_item_id', String(caseModal.it.id))
        if (caseModal.unitIndex !== null && caseModal.unitIndex !== undefined) {
          fd.append('unit_index', String(caseModal.unitIndex))
        }
      }
      for (const f of caseFiles) fd.append('files', f)
      if (caseModal.mode === 'edit' && caseModal.caseStudyId) {
        await putFormData(`/api/case-studies/${caseModal.caseStudyId}`, fd)
      } else {
        await postFormData('/api/case-studies', fd)
      }
      closeCaseStudy()
      await loadTasks()
      if (caseListModal?.it?.id === caseModal.it.id) {
        await loadCaseStudiesForContext(caseListModal)
      }
      onTasksMutated?.()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '保存失败')
    } finally {
      setCaseSubmitting(false)
    }
  }

  async function deleteCaseStudyRow(row) {
    if (!row) return
    if (!window.confirm(`删除案例「${row.order_no} / 明细 ${row.order_item_id}」？`)) return
    setCaseListErr(null)
    setErr(null)
    try {
      await deleteReq(`/api/case-studies/${row.id}`)
      await loadTasks()
      if (caseListModal) {
        await loadCaseStudiesForContext(caseListModal)
      }
      onTasksMutated?.()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '删除失败'
      setCaseListErr(msg)
      setErr(msg)
    }
  }

  function openSlotOrderModal() {
    const draft = [...todaySlotOrder]
    setSlotOrderDraft(draft)
    const firstEmpty = draft.findIndex((s) => !String(s).trim())
    setSlotOrderActiveSlot(firstEmpty === -1 ? 0 : firstEmpty)
    setSlotOrderModalOpen(true)
  }

  function assignSlotOrderPiece(pieceLabel) {
    const raw = String(pieceLabel ?? '').trim()
    if (!raw) return
    const slot = slotOrderActiveSlot
    if (slot < 0 || slot > 9) return
    setSlotOrderDraft((prev) => {
      const next = [...prev]
      const cur = parseSlotPieces(next[slot])
      const dedupe = raw !== '—'
      if (cur.includes(raw)) {
        next[slot] = joinSlotPieces(cur.filter((p) => p !== raw))
      } else {
        next[slot] = joinSlotPieces([...cur, raw])
        if (dedupe) {
          for (let j = 0; j < 10; j += 1) {
            if (j === slot) continue
            next[j] = joinSlotPieces(parseSlotPieces(next[j]).filter((p) => p !== raw))
          }
        }
      }
      return next
    })
  }

  function clearSlotOrderRow(i) {
    setSlotOrderDraft((prev) => {
      const next = [...prev]
      next[i] = ''
      return next
    })
  }

  function saveSlotOrderModal() {
    const next = slotOrderDraft.map((s) => String(s).trim())
    saveTodaySlotOrder(next)
    setTodaySlotOrder(next)
    setSlotOrderModalOpen(false)
  }

  function nextSplitChildOrderNo(baseOrderNo) {
    const base = String(baseOrderNo ?? '').trim()
    if (!base) return ''
    const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    let maxSeq = 0
    for (const it of todayQueueRows) {
      const ono = String(it?.order_no ?? '').trim()
      const m = ono.match(new RegExp(`^${escRe(base)}-([0-9]+)$`))
      if (!m) continue
      const n = Number(m[1])
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n
    }
    const next = maxSeq >= 1 ? maxSeq + 1 : 1
    return `${base}-${next}`
  }

  async function openTodaySplit(it) {
    const qty = itemQuantityOrNull(it)
    const unitCodes = Array.isArray(it?.processing_unit_codes) ? it.processing_unit_codes : []
    const all = qty ? Array.from({ length: qty }, (_, i) => i) : []
    setTodaySplitLeftIndexes(all)
    setTodaySplitRightIndexes([])
    let nextOrderNo = nextSplitChildOrderNo(it.order_no)
    try {
      const resp = await getJson(`/api/tasks/split-order-next?order_item_id=${encodeURIComponent(it.id)}`)
      const o1 = String(resp?.order_no_1 ?? '').trim()
      const o2 = String(resp?.order_no_2 ?? '').trim()
      if (o1) {
        it = { ...it, order_no: o1 }
      }
      if (o2) nextOrderNo = o2
    } catch (e) {
      void e
    }
    const splitFoPick = (() => {
      const outs = Array.isArray(it?.finished_outputs) ? it.finished_outputs : []
      const withSpec = outs.find((x) => String(x?.spec ?? '').trim())
      return withSpec || outs[0] || null
    })()
    setTodaySplitModal({
      itemId: it.id,
      orderNo1: it.order_no,
      orderNo2: nextOrderNo,
      qty,
      quantityKnown: qty !== null,
      customerName: it.customer_name ?? '',
      materialGrade: it.material_grade ?? '',
      specIncoming: it.spec_incoming ?? '',
      forgingSpec: String(
        (Array.isArray(it?.finished_outputs) ? it.finished_outputs : [])
          .find((x) => String(x?.spec ?? '').trim())?.spec ?? '',
      ).trim(),
      weightReturn: splitFoPick?.weight_return ?? '',
      returnDate: splitFoPick?.return_date ? String(splitFoPick.return_date).slice(0, 10) : '',
      remark: it.remark ?? '',
      unitCodes,
    })
    setTodaySplitEdit({
      customer_name: it.customer_name ?? '',
      material_grade: it.material_grade ?? '',
      spec_incoming: it.spec_incoming ?? '',
      forging_spec: String(
        (Array.isArray(it?.finished_outputs) ? it.finished_outputs : [])
          .find((x) => String(x?.spec ?? '').trim())?.spec ?? '',
      ).trim(),
      weight_return: splitFoPick?.weight_return ?? '',
      return_date: splitFoPick?.return_date ? String(splitFoPick.return_date).slice(0, 10) : '',
      remark: it.remark ?? '',
    })
  }

  async function submitTodaySplit() {
    if (!todaySplitModal) return
    const uniq = [...todaySplitRightIndexes].sort((a, b) => a - b)
    if (todaySplitModal.quantityKnown && uniq.length === 0) return
    if (todaySplitModal.quantityKnown && todaySplitModal.qty > 1 && uniq.length >= todaySplitModal.qty) return
    setErr(null)
    setTodaySplitSubmitting(true)
    try {
      const created = await postJson('/api/tasks/split-order', {
        order_item_id: todaySplitModal.itemId,
        move_unit_indexes: uniq,
      })
      const newId = Number(created?.item_id_2)
      if (Number.isFinite(newId) && newId > 0 && todaySplitEdit) {
        const prefix = stripUnitCodeSuffix(
          inferPieceCodePrefixFromUnitCodes(todaySplitModal.unitCodes),
        )
        const foRows = [
          {
            piece_code: prefix,
            spec: todaySplitEdit.forging_spec ?? '',
            pieces: '',
            weight_return: todaySplitEdit.weight_return ?? '',
            return_date: todaySplitEdit.return_date ?? '',
            remark: '',
          },
        ]
        const fo = normalizeFinishedOutputsForApi(foRows)
        const patch = {
          material_grade: todaySplitEdit.material_grade || null,
          spec_incoming: todaySplitEdit.spec_incoming || null,
          remark: todaySplitEdit.remark || null,
          finished_outputs: fo,
        }
        await patchJson(`/api/order-items/${newId}`, patch)
      }
      if (Number.isFinite(newId) && newId > 0) {
        await ensureProcessingCodesForItems([todaySplitModal.itemId, newId])
      }
      setTodaySplitModal(null)
      setTodaySplitLeftIndexes([])
      setTodaySplitRightIndexes([])
      setTodaySplitEdit(null)
      await loadTasks()
      onTasksMutated?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '拆分失败')
    } finally {
      setTodaySplitSubmitting(false)
    }
  }

  const renderTaskRow = (it, rowOptions = {}) => {
    const { orderBand, todayExpand, queueExpandMode = 'today', enableSplitAction = false } = rowOptions
    const groupSummary = Boolean(todayExpand?.groupSummary)
    const rowExpand = Boolean(todayExpand) && !groupSummary
    const bandClass =
      orderBand === 'a'
        ? 'task-order-group-a'
        : orderBand === 'b'
          ? 'task-order-group-b'
          : ''
    const showChrome = groupSummary || !todayExpand || todayExpand.unitIndex === 0
    const canMutateStatus =
      can(user, PERM.ORDER_PROCESS) ||
      can(user, PERM.ORDER_OUTBOUND) ||
      can(user, PERM.ORDER_CONFIRM_SHIP)
    const showOrderNoCell =
      groupSummary || !todayExpand || todayExpand.showOrderNo
    const rowKey = groupSummary
      ? `sum-${String(it.order_no ?? '')}-${it.id}`
      : rowExpand
        ? `${it.id}-u${todayExpand.unitIndex}`
        : it.id
    const unitLabel = groupSummary
      ? todayExpand.summaryLabelShort
      : todayExpand?.unitLabel ?? (showProcessingUnitCol ? '—' : null)
    const qtyDisplay = groupSummary
      ? todayExpand.summaryPieceCount
      : rowExpand
        ? 1
        : it.quantity
    const todayRowToggleExpand =
      groupSummary || Boolean(todayExpand?.todayGroupClickToggle)
    const badgeN = caseStudyBadgeCount(it, todayExpand)
    const multiUnit = isMultiUnitItem(it)
    const unitIndex =
      rowExpand && todayExpand && typeof todayExpand.unitIndex === 'number'
        ? todayExpand.unitIndex
        : null
    const expandedUnitRow = multiUnit && typeof unitIndex === 'number'
    const statusLabel =
      todayExpand?.orderStatusOverride !== undefined
        ? todayExpand.orderStatusOverride
        : it.order_status
    const productionStatusLabel = String(it.production_status ?? '在库中')
    const rowStatusOptions = statusOptionsForRow(it, tasksPreset, statuses)
    const canEditUnitStatuses = showChrome && can(user, PERM.ORDER_PROCESS)
    const readyOutboundSetAll = tasksPreset === 'ready_outbound' && multiUnit
    const showStatusSelect =
      canMutateStatus && (!multiUnit ? showChrome : expandedUnitRow || readyOutboundSetAll)
    const showUnitStatusButton = multiUnit && !expandedUnitRow && !readyOutboundSetAll
    const unitStatusButtonLabel = multiUnit ? `逐支状态：${productionStatusLabel}` : productionStatusLabel
    const expandedUnitStatusValue =
      expandedUnitRow && typeof unitIndex === 'number'
        ? (buildUnitStatuses(it)[unitIndex] ?? it.production_status ?? '在库中')
        : null
    const sameSourceChildDefault =
      (tasksPreset === 'all' || tasksPreset === 'pending') && isSameSourceChildOnScreen(it)
    const outboundSameSourceChild = (() => {
      if (tasksPreset !== 'ready_outbound') return false
      if (productionStatusLabel !== '出库中') return false
      if (!isMultiSpecFamilyChild(it)) return false
      const base = String(it?.split_base_order_no ?? '').trim()
      if (!base) return false
      const cnt = outboundShippingSameSourceMeta.countByBase.get(base) ?? 0
      if (cnt < 2) return false
      const seq = Number(it?.split_seq)
      const maxSeq = outboundShippingSameSourceMeta.maxSeqByBase.get(base)
      if (!Number.isFinite(seq) || !Number.isFinite(maxSeq)) return false
      return seq !== maxSeq
    })()
    const sameSourceMaskMode = outboundSameSourceChild
      ? 'outbound_shipping'
      : sameSourceChildDefault
        ? (tasksPreset === 'pending' ? 'pending' : 'default')
        : null
    const keepCols =
      sameSourceMaskMode === 'outbound_shipping'
        ? new Set([
            'finished_outputs',
            'finished_outputs_remark',
            'quantity',
            'weight_return',
            'return_date',
            'production_status',
          ])
        : sameSourceMaskMode === 'pending'
          ? new Set([
              'customer',
              'finished_outputs',
              'finished_outputs_remark',
              'quantity',
              'weight_return',
              'return_date',
              'production_status',
            ])
          : new Set([
              'id',
              'order_no',
              'customer',
              'finished_outputs',
              'finished_outputs_remark',
              'quantity',
              'weight_return',
              'return_date',
              'order_remark',
              'production_status',
              'task_actions',
            ])
    const colMasked = (key) => Boolean(sameSourceMaskMode) && !keepCols.has(key)
    const megaColWidth = (key) => {
      const n = Number(megaColWidths?.[key])
      return Number.isFinite(n) && n > 0 ? Math.round(n) : getMegaColResizeRule(key).defaultWidth
    }
    const shouldEllipsisCol = (key) => {
      if (colCollapsed(key)) return false
      const rule = getMegaColResizeRule(key)
      return megaColWidth(key) <= rule.ellipsisAt
    }
    const tdCls = (key, base = '') => {
      const cls = [
        base,
        colCollapsed(key) ? 'task-col-collapsed' : '',
        shouldEllipsisCol(key) ? 'task-col-ellipsis' : '',
      ]
        .filter(Boolean)
        .join(' ')
      return cls || undefined
    }
    const itemRemarkText = String(it?.remark ?? '').trim()
    const orderRemarkText = String(it?.order_remark ?? '').trim()
    const remarkDisplay = itemRemarkText || orderRemarkText || emptyCell

    const finishedOutputs = Array.isArray(it?.finished_outputs) ? it.finished_outputs : []
    const resolveFinishedOutputForUnitIndex = (uIdx) => {
      if (!Number.isFinite(uIdx) || uIdx < 0) return null
      let cursor = 0
      for (const fo of finishedOutputs) {
        const rawPieces = Number.parseInt(String(fo?.pieces ?? 1), 10)
        const pieces = Number.isFinite(rawPieces) && rawPieces >= 1 ? Math.floor(rawPieces) : 1
        if (uIdx >= cursor && uIdx < cursor + pieces) return fo
        cursor += pieces
      }
      return finishedOutputs[0] ?? null
    }
    const compactFoField = (field, fmt) => {
      const vals = []
      for (const fo of finishedOutputs) {
        const v = fmt(fo?.[field])
        if (v && v !== emptyCell && v !== '-') vals.push(v)
      }
      const uniq = Array.from(new Set(vals))
      return uniq.length ? uniq.join(' / ') : emptyCell
    }
    const resolvedFo = typeof unitIndex === 'number' ? resolveFinishedOutputForUnitIndex(unitIndex) : null
    const weightReturnDisplay =
      finishedOutputs.length > 0
        ? (resolvedFo ? fmtNumCell(resolvedFo?.weight_return) : compactFoField('weight_return', fmtNumCell))
        : fmtNumCell(it.weight_return)
    const returnDateDisplay =
      finishedOutputs.length > 0
        ? (resolvedFo ? fmtDateCell(resolvedFo?.return_date) : compactFoField('return_date', fmtDateCell))
        : fmtDateCell(it.return_date)

    const renderMegaTdByKey = (key) => {
      switch (key) {
        case 'id':
          if (!colOn('id')) return null
          return (
            <td key={key} className={tdCls('id', 'cell-nowrap')}>
              <span className="task-id-cell">
                {badgeN > 0 ? (
                  <button
                    type="button"
                    className="task-case-badge task-case-badge-btn"
                    title={`${badgeN} 条案例，点击查看`}
                    onClick={(e) => {
                      e.stopPropagation()
                      const uidx =
                        todayExpand &&
                        !groupSummary &&
                        typeof todayExpand.unitIndex === 'number'
                          ? todayExpand.unitIndex
                          : null
                      const ulab =
                        todayExpand && !groupSummary
                          ? todayExpand.unitLabel ?? caseUnitLabel(todayExpand.unitIndex, '')
                          : '整单'
                      openCaseStudyList(it, uidx, ulab)
                    }}
                  >
                    案例
                  </button>
                ) : null}
                {displayItemId(it)}
                {showCaseStudyUi ? (
                  <button
                    type="button"
                    className="btn btn-ghost task-case-add-btn"
                    onClick={(e) => {
                      e.stopPropagation()
                      const uidx =
                        todayExpand &&
                        !groupSummary &&
                        typeof todayExpand.unitIndex === 'number'
                          ? todayExpand.unitIndex
                          : null
                      const ulab =
                        todayExpand && !groupSummary
                          ? todayExpand.unitLabel ?? `第${(todayExpand.unitIndex ?? 0) + 1}件`
                          : '整单'
                      openCaseStudy(it, uidx, ulab)
                    }}
                  >
                    ＋案例
                  </button>
                ) : null}
              </span>
            </td>
          )
        case 'production_status':
          if (!showProductionStatusCol || !colOn('production_status')) return null
          return (
            <td key={key} className={tdCls('production_status', GS)} onClick={(e) => e.stopPropagation()}>
              {colMasked('production_status') ? (
                '-'
              ) : showStatusSelect ? (
                <select
                  value={expandedUnitRow ? expandedUnitStatusValue : it.production_status}
                  onChange={(e) =>
                    expandedUnitRow
                      ? patchUnitStatus(it, unitIndex, e.target.value)
                      : patchStatus(it, e.target.value, { set_all_units: readyOutboundSetAll })
                  }
                >
                  {rowStatusOptions.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : showUnitStatusButton ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  title={canEditUnitStatuses ? '点击按支修改生产状态' : '当前按最慢一支展示生产状态'}
                  disabled={!canEditUnitStatuses}
                  onClick={() => openUnitStatusEditor(it)}
                >
                  {unitStatusButtonLabel}
                </button>
              ) : (
                <span className="tag">{productionStatusLabel}</span>
              )}
            </td>
          )
        case 'incoming_date':
          if (!colOn('incoming_date')) return null
          return (
            <td key={key} className={tdCls('incoming_date', GS)}>
              {colMasked('incoming_date') ? '-' : fmtDateCell(it.incoming_date)}
            </td>
          )
        case 'processing_unit':
          if (!showProcessingUnitCol || !colOn('processing_unit')) return null
          return (
            <td key={key} className={tdCls('processing_unit', 'cell-nowrap task-unit-code')}>
              {colMasked('processing_unit') ? '-' : (unitLabel ?? emptyCell)}
            </td>
          )
        case 'order_no':
          if (!colOn('order_no')) return null
          return (
            <td
              key={key}
              className={[
                'cell-nowrap',
                !showOrderNoCell ? 'task-order-no-merged' : '',
                colCollapsed('order_no') ? 'task-col-collapsed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {showOrderNoCell ? (colMasked('order_no') ? '-' : it.order_no) : '\u00a0'}
            </td>
          )
        case 'customer':
          if (!colOn('customer')) return null
          return (
            <td key={key} className={tdCls('customer')}>
              {colMasked('customer') ? '-' : fmtNumCell(it.customer_name)}
            </td>
          )
        case 'material_grade':
          if (!colOn('material_grade')) return null
          return (
            <td key={key} className={tdCls('material_grade')}>
              {colMasked('material_grade') ? '-' : fmtNumCell(it.material_grade)}
            </td>
          )
        case 'spec_incoming':
          if (!colOn('spec_incoming')) return null
          return (
            <td key={key} className={tdCls('spec_incoming', 'text-cell')}>
              {colMasked('spec_incoming') ? '-' : fmtNumCell(it.spec_incoming)}
            </td>
          )
        case 'weight_incoming':
          if (!colOn('weight_incoming')) return null
          return (
            <td key={key} className={tdCls('weight_incoming')}>
              {colMasked('weight_incoming') ? '-' : fmtNumCell(it.weight_incoming)}
            </td>
          )
        case 'quantity':
          if (!colOn('quantity')) return null
          return (
            <td key={key} className={tdCls('quantity')}>
              {colMasked('quantity') ? '-' : fmtNumCell(qtyDisplay)}
            </td>
          )
        case 'order_created_at':
          if (!colOn('order_created_at')) return null
          return (
            <td key={key} className={tdCls('order_created_at', 'cell-nowrap')}>
              {colMasked('order_created_at') ? '-' : fmtDateTimeCell(it.order_created_at)}
            </td>
          )
        case 'order_status':
          if (!colOn('order_status')) return null
          return (
            <td key={key} className={tdCls('order_status')}>
              {colMasked('order_status') ? '-' : <span className="tag tag-status">{statusLabel}</span>}
            </td>
          )
        case 'order_remark':
          if (!colOn('order_remark')) return null
          {
            const orderRemarkDisplay =
              tasksPreset === 'all' || tasksPreset === 'ready_outbound'
                ? (itemRemarkText || emptyCell)
                : fmtNumCell(it.order_remark)
            return (
              <td key={key} className={tdCls('order_remark', 'text-cell')}>
                {colMasked('order_remark') ? '-' : orderRemarkDisplay}
              </td>
            )
          }
        case 'incoming_no':
          if (!colOn('incoming_no')) return null
          return (
            <td key={key} className={tdCls('incoming_no', GS)}>
              {colMasked('incoming_no') ? '-' : fmtNumCell(it.incoming_no)}
            </td>
          )
        case 'weight_return':
          if (!colOn('weight_return')) return null
          return (
            <td key={key} className={tdCls('weight_return', GS)}>
              {colMasked('weight_return') ? '-' : weightReturnDisplay}
            </td>
          )
        case 'cut_head_weight':
          if (!showCutHeadWeightColInList || !colOn('cut_head_weight')) return null
          return (
            <td key={key} className={tdCls('cut_head_weight', GS)}>
              {colMasked('cut_head_weight') ? '-' : fmtNumCell(it.cut_head_weight)}
            </td>
          )
        case 'finished_outputs':
          if (!colOn('finished_outputs')) return null
          return (
            <td key={key} className={tdCls('finished_outputs', 'text-cell finished-outputs-cell')}>
              {colMasked('finished_outputs')
                ? '-'
                : <FinishedOutputsView outputs={it.finished_outputs} variant="compact" emptyText={emptyCell} />}
            </td>
          )
        case 'finished_outputs_remark':
          if (!colOn('finished_outputs_remark')) return null
          return (
            <td key={key} className={tdCls('finished_outputs_remark', 'text-cell')}>
              {colMasked('finished_outputs_remark') ? '-' : finishedOutputsRemarkCompact(it.finished_outputs)}
            </td>
          )
        case 'forging_requirements':
          if (!colOn('forging_requirements')) return null
          return (
            <td key={key} className={tdCls('forging_requirements', `text-cell ${GS}`)}>
              {colMasked('forging_requirements') ? '-' : fmtNumCell(it.forging_requirements)}
            </td>
          )
        case 'remark':
          if (!colOn('remark')) return null
          return (
            <td key={key} className={tdCls('remark', 'text-cell')}>
              {colMasked('remark') ? '-' : remarkDisplay}
            </td>
          )
        case 'cutting_time':
          if (!showCuttingReturnDateCols || !colOn('cutting_time')) return null
          return (
            <td key={key} className={tdCls('cutting_time')}>
              {colMasked('cutting_time') ? '-' : fmtCuttingDateCell(it.cutting_time)}
            </td>
          )
        case 'return_date':
          if (!showCuttingReturnDateCols || !colOn('return_date')) return null
          return (
            <td key={key} className={tdCls('return_date')}>
              {colMasked('return_date') ? '-' : returnDateDisplay}
            </td>
          )
        case 'ready_outbound_actions':
          if (!showReadyOutboundActionsCol || !colOn('ready_outbound_actions')) return null
          return (
            <td
              key={key}
              className={tdCls('ready_outbound_actions', `row-actions cell-actions ${GS}`)}
              onClick={(e) => e.stopPropagation()}
            >
              {multiUnit ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!canEditUnitStatuses}
                  onClick={() => openUnitStatusEditor(it)}
                >
                  逐支状态
                </button>
              ) : it.production_status === '待发回' ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!can(user, PERM.ORDER_OUTBOUND)}
                  onClick={() => patchStatus(it, '出库中')}
                >
                  →出库中
                </button>
              ) : it.production_status === '出库中' ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!can(user, PERM.ORDER_OUTBOUND)}
                  onClick={() => patchStatus(it, '待发回')}
                >
                  ←等待出库
                </button>
              ) : null}
            </td>
          )
        case 'task_actions':
          if (!showTaskActionsCol || !colOn('task_actions')) return null
          return (
            <td
              key={key}
              className={tdCls('task_actions', `row-actions cell-actions ${GS}`)}
              onClick={(e) => e.stopPropagation()}
            >
              {colMasked('task_actions') ? (
                '-'
              ) : showChrome && can(user, PERM.ORDER_PROCESS) ? (
                <>
                  {multiUnit ? (
                    <button type="button" className="btn btn-ghost" onClick={() => openUnitStatusEditor(it)}>
                      逐支状态
                    </button>
                  ) : (
                    <>
                      <button type="button" className="btn btn-ghost" onClick={() => patchStatus(it, '锻造中')}>
                        →锻造
                      </button>
                      <button type="button" className="btn btn-ghost" onClick={() => patchStatus(it, '待发回')}>
                        →待发回
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => openPrint('production', taskToPrintPayload(it))}
                  >
                    打印生产单
                  </button>
                  {it.production_status === '修磨中' ? (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => {
                        setGrindItem(it)
                        setGrindNote('')
                        setGrindUnitIndex(multiUnit ? 0 : null)
                      }}
                    >
                      {multiUnit ? '修磨记录（首支）' : '修磨记录'}
                    </button>
                  ) : null}
                </>
              ) : null}
            </td>
          )
        default:
          return null
      }
    }

    return (
    <tr
      key={rowKey}
      className={[
        'clickable',
        bandClass,
        todayRowToggleExpand ? 'task-today-row-toggle' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        todayRowToggleExpand
          ? '单击展开逐件 / 聚合为同一订单号一行'
          : undefined
      }
      onClick={() => {
        if (todayRowToggleExpand) {
          if (queueExpandMode === 'rest') toggleRestOrderCollapse(it.order_no)
          else toggleTodayOrderCollapse(it.order_no)
          return
        }
        enterDetail(it)
      }}
    >
      {showBulkSelectCol ? (
        <td className="task-select-cell" onClick={(e) => e.stopPropagation()}>
          {showChrome ? (
            <input
              type="checkbox"
              aria-label={`选择明细 ${it.id}`}
              checked={selectedIds.includes(it.id)}
              onChange={() =>
                setSelectedIds((prev) =>
                  prev.includes(it.id) ? prev.filter((x) => x !== it.id) : [...prev, it.id],
                )
              }
            />
          ) : null}
        </td>
      ) : null}
      {megaColOrderNormalized.map(renderMegaTdByKey)}
      {enableSplitAction ? (
        <td className={`row-actions ${GS} task-today-split-col`} onClick={(e) => e.stopPropagation()}>
          {showChrome && can(user, PERM.ORDER_PROCESS) ? (
            <button type="button" className="btn btn-ghost" onClick={() => void openTodaySplit(it)}>
              拆分
            </button>
          ) : null}
        </td>
      ) : null}
    </tr>
    )
  }

  const megaColOrderNormalized = normalizeColOrder(megaColOrder, MEGA_COL_DEFAULT_ORDER)
  const detailIncomingColOrderNormalized = normalizeColOrder(detailIncomingColOrder, DETAIL_INCOMING_DEFAULT_ORDER)
  const detailLogColOrderNormalized = normalizeColOrder(detailLogColOrder, DETAIL_LOG_DEFAULT_ORDER)

  const megaColWidthsReady = Object.keys(megaColWidths || {}).length > 0
  const detailIncomingColWidthsReady = Object.keys(detailIncomingColWidths || {}).length > 0
  const detailLogColWidthsReady = Object.keys(detailLogColWidths || {}).length > 0
  const megaColDisplayWidth = useCallback(
    (key) => {
      if (colCollapsed(key)) return COLLAPSED_COL_WIDTH_PX
      const n = Number(megaColWidths?.[key])
      const rule = getMegaColResizeRule(key)
      return Number.isFinite(n) && n > 0 ? Math.round(n) : rule.defaultWidth
    },
    [colCollapsed, megaColWidths],
  )
  const megaColShouldEllipsis = useCallback(
    (key) => !colCollapsed(key) && megaColDisplayWidth(key) <= getMegaColResizeRule(key).ellipsisAt,
    [colCollapsed, megaColDisplayWidth],
  )

  useEffect(() => {
    if (!megaColWidthsLoaded || megaColWidthsHasServerValue) return
    if (!megaTableEl) return
    const raf = window.requestAnimationFrame(() => {
      const next = measureTheadColWidths(megaTableEl)
      if (Object.keys(next).length === 0) return
      setMegaColWidths(next)
      setMegaColWidthsHasServerValue(true)
      void persistMegaColWidths(next)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [megaColWidthsLoaded, megaColWidthsHasServerValue, megaTableEl, persistMegaColWidths])

  useEffect(() => {
    if (!detailIncomingColWidthsLoaded || detailIncomingColWidthsHasServerValue) return
    if (!detailIncomingTableEl) return
    const raf = window.requestAnimationFrame(() => {
      const next = measureTheadColWidths(detailIncomingTableEl)
      if (Object.keys(next).length === 0) return
      setDetailIncomingColWidths(next)
      setDetailIncomingColWidthsHasServerValue(true)
      void persistDetailIncomingColWidths(next)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [
    detailIncomingColWidthsLoaded,
    detailIncomingColWidthsHasServerValue,
    detailIncomingTableEl,
    persistDetailIncomingColWidths,
  ])

  useEffect(() => {
    if (!detailLogColWidthsLoaded || detailLogColWidthsHasServerValue) return
    if (!detailLogTableEl) return
    const raf = window.requestAnimationFrame(() => {
      const next = measureTheadColWidths(detailLogTableEl)
      if (Object.keys(next).length === 0) return
      setDetailLogColWidths(next)
      setDetailLogColWidthsHasServerValue(true)
      void persistDetailLogColWidths(next)
    })
    return () => window.cancelAnimationFrame(raf)
  }, [detailLogColWidthsLoaded, detailLogColWidthsHasServerValue, detailLogTableEl, persistDetailLogColWidths])

  const startResize = useCallback(
    (kind, key, e) => {
      if (!key) return
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const k = String(key)
      const tableEl =
        kind === 'mega' ? megaTableEl : kind === 'detail_incoming' ? detailIncomingTableEl : detailLogTableEl
      const ths = tableEl ? Array.from(tableEl.querySelectorAll('thead th[data-col-key]')) : []
      const th = ths.find((x) => String(x.getAttribute('data-col-key') || '') === k) || null
      const measured = th ? Math.round(th.getBoundingClientRect().width) : 0
      const widthRef =
        kind === 'mega' ? megaColWidthsRef : kind === 'detail_incoming' ? detailIncomingColWidthsRef : detailLogColWidthsRef
      const megaRule = kind === 'mega' ? getMegaColResizeRule(k) : null
      const startW =
        kind === 'mega'
          ? Number(widthRef.current?.[k]) || measured || megaRule?.defaultWidth || DEFAULT_MEGA_COL_WIDTH
          : Number(widthRef.current?.[k]) || measured || 120
      const minW = kind === 'mega' ? COLLAPSED_COL_WIDTH_PX : k === 'actions' ? 110 : 60

      resizeCtxRef.current = { raf: 0, kind, key: k, startX: e.clientX, startW, pendingW: startW }
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'col-resize'

      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        return
      }

      const applyW = (nextW) => {
        const w = Math.max(minW, Math.round(nextW))
        if (kind === 'mega') {
          if (w <= megaRule.collapseAt) {
            setMegaColCollapsed(k, true)
            return
          }
          setMegaColCollapsed(k, false)
          setMegaColWidths((prev) => {
            const cur = prev && typeof prev === 'object' ? prev : {}
            if (cur[k] === w) return cur
            return { ...cur, [k]: w }
          })
        }
        else if (kind === 'detail_incoming') setDetailIncomingColWidths((prev) => ({ ...(prev || {}), [k]: w }))
        else setDetailLogColWidths((prev) => ({ ...(prev || {}), [k]: w }))
      }

      const onMove = (ev) => {
        const ctx = resizeCtxRef.current
        if (!ctx || ctx.key !== k || ctx.kind !== kind) return
        const dx = ev.clientX - ctx.startX
        ctx.pendingW = ctx.startW + dx
        if (ctx.raf) return
        ctx.raf = window.requestAnimationFrame(() => {
          const ctx2 = resizeCtxRef.current
          if (!ctx2 || ctx2.key !== k || ctx2.kind !== kind) return
          ctx2.raf = 0
          applyW(ctx2.pendingW)
        })
      }

      const onUp = () => {
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        const ctx = resizeCtxRef.current
        if (ctx?.raf) window.cancelAnimationFrame(ctx.raf)
        resizeCtxRef.current = { raf: 0, kind: null, key: null, startX: 0, startW: 0, pendingW: 0 }
        document.body.style.userSelect = ''
        document.body.style.cursor = ''
        const snap =
          kind === 'mega'
            ? megaColWidthsRef.current
            : kind === 'detail_incoming'
              ? detailIncomingColWidthsRef.current
              : detailLogColWidthsRef.current
        if (kind === 'mega') void persistMegaColWidths(snap)
        else if (kind === 'detail_incoming') void persistDetailIncomingColWidths(snap)
        else void persistDetailLogColWidths(snap)
      }

      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [
      megaTableEl,
      detailIncomingTableEl,
      detailLogTableEl,
      persistMegaColWidths,
      persistDetailIncomingColWidths,
      persistDetailLogColWidths,
      setMegaColCollapsed,
    ],
  )

  const megaColHeaderOn = (key) => {
    switch (key) {
      case 'id':
        return colOn('id')
      case 'production_status':
        return showProductionStatusCol && colOn('production_status')
      case 'incoming_date':
        return colOn('incoming_date')
      case 'processing_unit':
        return showProcessingUnitCol && colOn('processing_unit')
      case 'order_no':
        return colOn('order_no')
      case 'customer':
        return colOn('customer')
      case 'material_grade':
        return colOn('material_grade')
      case 'spec_incoming':
        return colOn('spec_incoming')
      case 'quantity':
        return colOn('quantity')
      case 'weight_incoming':
        return colOn('weight_incoming')
      case 'order_created_at':
        return colOn('order_created_at')
      case 'order_status':
        return colOn('order_status')
      case 'order_remark':
        return colOn('order_remark')
      case 'incoming_no':
        return colOn('incoming_no')
      case 'weight_return':
        return colOn('weight_return')
      case 'cut_head_weight':
        return showCutHeadWeightColInList && colOn('cut_head_weight')
      case 'finished_outputs':
        return colOn('finished_outputs')
      case 'finished_outputs_remark':
        return colOn('finished_outputs_remark')
      case 'forging_requirements':
        return colOn('forging_requirements')
      case 'remark':
        return colOn('remark')
      case 'cutting_time':
        return showCuttingReturnDateCols && colOn('cutting_time')
      case 'return_date':
        return showCuttingReturnDateCols && colOn('return_date')
      case 'task_actions':
        return showTaskActionsCol && colOn('task_actions')
      case 'ready_outbound_actions':
        return showReadyOutboundActionsCol && colOn('ready_outbound_actions')
      default:
        return false
    }
  }

  const renderMegaColgroup = (extraTailLabel = '') => {
    const keys = megaColOrderNormalized.filter((k) => megaColHeaderOn(k))
    return (
      <colgroup>
        {showBulkSelectCol ? <col style={{ width: '2.75rem' }} /> : null}
        {keys.map((k) => {
          const style = { width: `${megaColDisplayWidth(k)}px` }
          return <col key={`mega-col-${k}`} style={style} />
        })}
        {extraTailLabel ? <col /> : null}
      </colgroup>
    )
  }

  const megaTableWidthPx = (extraTailLabel = '') => {
    const keys = megaColOrderNormalized.filter((k) => megaColHeaderOn(k))
    return (
      (showBulkSelectCol ? BULK_SELECT_COL_WIDTH_PX : 0) +
      keys.reduce((sum, k) => sum + megaColDisplayWidth(k), 0) +
      (extraTailLabel ? EXTRA_TAIL_COL_WIDTH_PX : 0)
    )
  }

  const renderMegaColTh = (key, label, className = '', labelText = '', isLast = false) => {
    const collapsed = colCollapsed(key)
    const titleLabel =
      typeof label === 'string' ? label : labelText ? labelText : String(key)
    const thStyle = { width: `${megaColDisplayWidth(key)}px` }
    const cls = [
      className,
      collapsed ? 'task-col-collapsed' : '',
      megaColShouldEllipsis(key) ? 'task-col-ellipsis' : '',
      'task-col-toggle',
      'task-col-draggable',
      megaColDnD.draggingKey === key ? 'task-col-dragging' : '',
      megaColDnD.overKey === key && megaColDnD.draggingKey && megaColDnD.draggingKey !== key
        ? 'task-col-drag-over'
        : '',
    ]
      .filter(Boolean)
      .join(' ')
    const props = {
      className: cls || undefined,
      title: collapsed ? `展开列：${titleLabel}` : `折叠列：${titleLabel}`,
      role: 'button',
      tabIndex: 0,
      style: thStyle,
    }
    const onToggleCollapsed = () => toggleColCollapsedAlways(key)
    props.onKeyDown = (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return
      e.preventDefault()
      onToggleCollapsed()
    }
    const dragProps = megaColDnD.getThProps(key, { onClick: onToggleCollapsed, labelText: titleLabel })
    return (
      <th key={`mega-th-${key}`} {...props} {...dragProps}>
        {label}
        {!collapsed && !isLast ? (
          <span
            className="table-col-resizer"
            onClick={(e) => {
              e.preventDefault()
              e.stopPropagation()
            }}
            onPointerDown={(e) => startResize('mega', key, e)}
          />
        ) : null}
      </th>
    )
  }

  const renderMegaThByKey = (key, isLast = false) => {
    switch (key) {
      case 'id':
        return colOn('id') ? renderMegaColTh('id', '明细ID', 'cell-nowrap', '', isLast) : null
      case 'production_status':
        return showProductionStatusCol && colOn('production_status')
          ? renderMegaColTh('production_status', '生产状态', GS, '', isLast)
          : null
      case 'incoming_date':
        return colOn('incoming_date') ? renderMegaColTh('incoming_date', '来料日期', GS, '', isLast) : null
      case 'processing_unit':
        return showProcessingUnitCol && colOn('processing_unit')
          ? renderMegaColTh('processing_unit', '件号', 'cell-nowrap', '', isLast)
          : null
      case 'order_no':
        return colOn('order_no')
          ? renderMegaColTh(
              'order_no',
              <>
                订单编号 <span className="task-col-hint">⇔</span>
              </>,
              'cell-nowrap',
              '订单编号',
              isLast,
            )
          : null
      case 'customer':
        return colOn('customer') ? renderMegaColTh('customer', customerColLabel, '', '', isLast) : null
      case 'material_grade':
        return colOn('material_grade') ? renderMegaColTh('material_grade', '材质', '', '', isLast) : null
      case 'spec_incoming':
        return colOn('spec_incoming') ? renderMegaColTh('spec_incoming', '来料规格', '', '', isLast) : null
      case 'quantity':
        return colOn('quantity') ? renderMegaColTh('quantity', '支数', '', '', isLast) : null
      case 'weight_incoming':
        return colOn('weight_incoming') ? renderMegaColTh('weight_incoming', weightIncomingColLabel, '', '', isLast) : null
      case 'order_created_at':
        return colOn('order_created_at')
          ? renderMegaColTh('order_created_at', '下单时间', 'cell-nowrap', '', isLast)
          : null
      case 'order_status':
        return colOn('order_status') ? renderMegaColTh('order_status', '订单状态', '', '', isLast) : null
      case 'order_remark':
        return colOn('order_remark') ? renderMegaColTh('order_remark', '订单备注', '', '', isLast) : null
      case 'incoming_no':
        return colOn('incoming_no') ? renderMegaColTh('incoming_no', '炉号', GS, '', isLast) : null
      case 'weight_return':
        return colOn('weight_return') ? renderMegaColTh('weight_return', '发回重量', GS, '', isLast) : null
      case 'cut_head_weight':
        return showCutHeadWeightColInList && colOn('cut_head_weight')
          ? renderMegaColTh('cut_head_weight', '切头重量', GS, '', isLast)
          : null
      case 'finished_outputs':
        return colOn('finished_outputs')
          ? renderMegaColTh('finished_outputs', finishedOutputsColLabel, 'task-col-finished-outputs', '', isLast)
          : null
      case 'finished_outputs_remark':
        return colOn('finished_outputs_remark')
          ? renderMegaColTh('finished_outputs_remark', '分支备注', '', '', isLast)
          : null
      case 'forging_requirements':
        return colOn('forging_requirements')
          ? renderMegaColTh(
              'forging_requirements',
              <>
                锻造要求 <span className="task-col-hint">⇔</span>
              </>,
              GS,
              '锻造要求',
              isLast,
            )
          : null
      case 'remark':
        return colOn('remark') ? renderMegaColTh('remark', '锻造备注', '', '', isLast) : null
      case 'cutting_time':
        return showCuttingReturnDateCols && colOn('cutting_time')
          ? renderMegaColTh('cutting_time', '下料/锻造时间', '', '', isLast)
          : null
      case 'return_date':
        return showCuttingReturnDateCols && colOn('return_date')
          ? renderMegaColTh('return_date', returnDateColLabel, '', '', isLast)
          : null
      case 'task_actions':
        return showTaskActionsCol && colOn('task_actions')
          ? renderMegaColTh('task_actions', '操作', GS, '', isLast)
          : null
      case 'ready_outbound_actions':
        return showReadyOutboundActionsCol && colOn('ready_outbound_actions')
          ? renderMegaColTh('ready_outbound_actions', '操作', GS, '', isLast)
          : null
      default:
        return null
    }
  }

  const renderMegaThead = (bulkControls, extraTailLabel = '') => (
    <thead>
      <tr>
        {showBulkSelectCol ? (
          <th className="task-select-cell">
            {bulkControls ? (
              <input
                ref={headerSelectRef}
                type="checkbox"
                aria-label="全选本页"
                checked={
                  rows.length > 0 && rows.every((r) => selectedIds.includes(r.id))
                }
                onChange={() => {
                  if (rows.length === 0) return
                  const ids = rows.map((r) => r.id)
                  const allOnPageSelected =
                    ids.length > 0 && ids.every((id) => selectedIds.includes(id))
                  setSelectedIds(allOnPageSelected ? [] : ids)
                }}
              />
            ) : (
              <span className="task-thead-placeholder" aria-hidden />
            )}
          </th>
        ) : null}
        {(() => {
          const keys = megaColOrderNormalized.filter((k) => megaColHeaderOn(k))
          const last = extraTailLabel ? null : keys.length ? keys[keys.length - 1] : null
          return megaColOrderNormalized.map((k) => renderMegaThByKey(k, k === last))
        })()}
        {extraTailLabel ? <th className={GS}>{extraTailLabel}</th> : null}
      </tr>
    </thead>
  )

  async function submitBatchProductionConfirm() {
    if (selectedIds.length === 0 || !batchTargetStatus) return
    setErr(null)
    const snap = captureUndoSnapshot(selectedIds)
    setBatchSubmitting(true)
    try {
      await postJson('/api/order-items/batch-production-status', {
        item_ids: selectedIds,
        production_status: batchTargetStatus,
      })
      setLastBatchUndo(snap)
      setBatchTargetStatus('')
      setBatchProductionExpanded(false)
      setSelectedIds([])
      loadTasks()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '批量更新失败')
    } finally {
      setBatchSubmitting(false)
    }
  }

  async function deleteWorkOrder() {
    if (!detail?.items?.[0]) return
    if (!window.confirm(`删除来料订单 ${detail.order_no}？`)) return
    setErr(null)
    try {
      await deleteReq(`/api/tasks/items/${detail.items[0].id}`)
      backToList()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div
      className={[
        'page-wrap',
        'tasks-page-merged',
        tasksPreset === 'all' && view === 'list' ? 'tasks-page--all-list' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <header className="dashboard-page-title">
        <h1>
          {view === 'list'
            ? listPageTitle(tasksPreset)
            : detail?.order_no
              ? `订单明细 · ${detail.order_no}`
              : '订单明细'}
        </h1>
      </header>

      {view === 'list' ? (
        <>
          <div className="toolbar orders-toolbar">
            {!isCutHead && !isSplitMergeLogs ? (
              <>
                <select
                  aria-label="选择搜索列"
                  value={searchCol}
                  onChange={(e) => {
                    setSearchCol(e.target.value)
                    setSearchValue('')
                  }}
                >
                  <option value="customer">客户</option>
                  <option value="material_grade">材质</option>
                  <option value="incoming_no">炉号</option>
                  <option value="order_no">订单编号</option>
                  <option value="spec_incoming">来料规格</option>
                  <option value="weight_incoming">来料重量</option>
                  <option value="incoming_date">来料日期</option>
                </select>
                <input
                  type="search"
                  list={searchCol === 'customer' ? 'task-search-customer-options' : undefined}
                  placeholder={(() => {
                    switch (searchCol) {
                      case 'customer':
                        return '客户（模糊，可下拉选择）'
                      case 'material_grade':
                        return '材质（模糊）'
                      case 'incoming_no':
                        return '炉号（模糊）'
                      case 'order_no':
                        return '订单编号（模糊）'
                      case 'spec_incoming':
                        return '来料规格（模糊）'
                      case 'weight_incoming':
                        return '来料重量（模糊）'
                      case 'incoming_date':
                        return '来料日期（如 2026-06-29）'
                      default:
                        return '输入关键字'
                    }
                  })()}
                  value={searchValue}
                  onChange={(e) => setSearchValue(e.target.value)}
                />
                {searchCol === 'customer' ? (
                  <datalist id="task-search-customer-options">
                    {customers.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                ) : null}
              </>
            ) : null}
            {!isCutHead && showProductionStatusFilter ? (
              <select
                className="select-production-status"
                aria-label="按生产状态筛选"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">全部生产状态</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s === '待发回' ? '待发回（等待出库）' : s}
                  </option>
                ))}
              </select>
            ) : null}
            {isCutHead || isSplitMergeLogs ? (
              <input
                type="search"
                placeholder={isCutHead ? '订单号 / 炉号 / 客户' : '订单号'}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            ) : null}
            {isCutHead && can(user, PERM.ORDER_PROCESS) ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  setCutHeadModalOpen(true)
                  setCutHeadPickQ('')
                  setCutHeadPickRows([])
                  setCutHeadPickId('')
                  setCutHeadWeight('')
                }}
              >
                新建切头
              </button>
            ) : null}
            {isSplitMergeLogs ? (
              <button type="button" className="btn" onClick={() => loadSplitMergeLogs()}>
                刷新
              </button>
            ) : null}
            {showNewWorkOrder ? (
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  openNewWorkOrderWindow()
                }}
              >
                新建来料订单
              </button>
            ) : null}
            {showBulkCheckboxCol ? (
              <>
                <button
                  type="button"
                  className={`btn ${bulkSelectColumnVisible ? 'is-pressed' : ''}`}
                  aria-pressed={bulkSelectColumnVisible}
                  onClick={() => {
                    setErr(null)
                    setBulkSelectColumnVisible((v) => !v)
                  }}
                >
                  多选
                </button>
                <button
                  type="button"
                  className={`btn ${batchProductionExpanded ? 'is-pressed' : ''}`}
                  aria-pressed={batchProductionExpanded}
                  onClick={() => {
                    setErr(null)
                    setBatchProductionExpanded((v) => {
                      const next = !v
                      if (next) setBulkSelectColumnVisible(true)
                      if (!next) setBatchTargetStatus('')
                      return next
                    })
                  }}
                >
                  批量修改生产状态
                </button>
                {tasksPreset === 'pending' ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      batchSubmitting ||
                      selectedIds.filter((id) => {
                        const st = rows.find((r) => r.id === id)?.production_status
                        return st === '在库中'
                      }).length === 0
                    }
                    onClick={() => {
                      setErr(null)
                      setBulkSelectColumnVisible(true)
                      void submitStartProcessingToday()
                    }}
                  >
                    开始处理（今日）
                  </button>
                ) : null}
                {tasksPreset === 'processing' ? (
                  <>
                    <select
                      className="toolbar-batch-select"
                      value={batchPieceDay}
                      onChange={(e) => setBatchPieceDay(e.target.value)}
                      aria-label="件号目标日期"
                      disabled={batchPieceSubmitting}
                    >
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={String(d)}>
                          {d}日
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn"
                      disabled={batchPieceSubmitting || selectedIds.length === 0}
                      onClick={() => {
                        setErr(null)
                        setBulkSelectColumnVisible(true)
                        void submitBatchReassignProcessingCodes()
                      }}
                    >
                      {batchPieceSubmitting ? '重排中…' : '件号重排'}
                    </button>
                    <span className="muted" style={{ fontSize: '0.86rem' }}>
                      对已勾选订单生效
                    </span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        batchSubmitting ||
                        selectedIds.filter(
                          (id) => !todayQueueRows.some((r) => r.id === id),
                        ).length === 0
                      }
                      onClick={() => {
                        setErr(null)
                        setBulkSelectColumnVisible(true)
                        void submitAddToTodayFromProcessing()
                      }}
                    >
                      开始处理（今日）
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        batchSubmitting ||
                        selectedIds.filter(
                          (id) => !tomorrowQueueRows.some((r) => r.id === id),
                        ).length === 0
                      }
                      onClick={() => {
                        setErr(null)
                        setBulkSelectColumnVisible(true)
                        void submitAddToTomorrowFromProcessing()
                      }}
                    >
                      安排明日处理
                    </button>
                    <button
                      type="button"
                      className="btn"
                      disabled={
                        batchSubmitting ||
                        selectedIds.filter(
                          (id) =>
                            todayQueueRows.some((r) => r.id === id) ||
                            tomorrowQueueRows.some((r) => r.id === id),
                        ).length === 0
                      }
                      onClick={() => {
                        setErr(null)
                        setBulkSelectColumnVisible(true)
                        void submitRemoveFromQueues()
                      }}
                    >
                      移回待完成
                    </button>
                  </>
                ) : null}
                {lastBatchUndo?.length ? (
                  <button
                    type="button"
                    className="btn"
                    disabled={batchSubmitting}
                    onClick={() => {
                      void undoLastBatch()
                    }}
                  >
                    撤回最近一次批量
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          {showBulkCheckboxCol && batchProductionExpanded ? (
            <div className="toolbar toolbar-secondary toolbar-batch-production">
              <select
                className="toolbar-batch-select"
                value={batchTargetStatus}
                onChange={(e) => setBatchTargetStatus(e.target.value)}
                aria-label="目标生产状态"
              >
                <option value="">请选择生产状态</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s === '待发回' ? '待发回（等待出库）' : s}
                  </option>
                ))}
              </select>
              <span className="toolbar-secondary-label">生产状态</span>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  batchSubmitting ||
                  selectedIds.length === 0 ||
                  !batchTargetStatus
                }
                onClick={() => {
                  void submitBatchProductionConfirm()
                }}
              >
                {batchSubmitting ? '提交中…' : '确认一键修改'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={batchSubmitting}
                onClick={() => {
                  setBatchProductionExpanded(false)
                  setBatchTargetStatus('')
                }}
              >
                收起
              </button>
              <span className="muted toolbar-secondary-meta">
                已选 {selectedIds.length} 条
                {lastBatchUndo?.length ? (
                  <> · 可通过「撤回最近一次批量」还原</>
                ) : null}
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <div className="order-detail-nav">
          <button type="button" className="btn" onClick={backToList}>
            ← 返回列表
          </button>
          {detailLoading ? <span className="muted">加载中…</span> : null}
        </div>
      )}

      {err ? <p className="err">{err}</p> : null}

      {view === 'list' ? (
        <div className="tasks-pagination-bar toolbar">
          <label className="tasks-page-size">
            每页
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              aria-label="每页条数"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="muted tasks-page-info">
            共 {listTotal} 条 · 第 {page} / {totalPages} 页
          </span>
          <button
            type="button"
            className="btn"
            disabled={
              (isSplitMergeLogs
                ? splitMergeLoading
                : isCutHead
                  ? cutHeadListLoading
                  : loading) || page <= 1
            }
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <button
            type="button"
            className="btn"
            disabled={
              (isSplitMergeLogs
                ? splitMergeLoading
                : isCutHead
                  ? cutHeadListLoading
                  : loading) || page >= totalPages
            }
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}

      {view === 'list' ? (
        isSplitMergeLogs ? (
          <div className="data-table-wrap task-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="cell-nowrap">记录ID</th>
                  <th className="cell-nowrap">时间</th>
                  <th className="cell-nowrap">动作</th>
                  <th className="cell-nowrap">阶段</th>
                  <th className="cell-nowrap">订单</th>
                  <th className="cell-nowrap">关联订单</th>
                  <th className="cell-nowrap">操作人</th>
                </tr>
              </thead>
              <tbody>
                {splitMergeLoading ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      加载中…
                    </td>
                  </tr>
                ) : splitMergeRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      暂无日志
                    </td>
                  </tr>
                ) : (
                  splitMergeRows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-nowrap">{r.id}</td>
                      <td className="cell-nowrap">{fmtDateTime(r.created_at)}</td>
                      <td className="cell-nowrap">{r.action === 'merge' ? '合并' : '拆分'}</td>
                      <td className="cell-nowrap">{fmtNum(r.production_status)}</td>
                      <td className="cell-nowrap">{fmtNum(r.order_no_a)}</td>
                      <td className="cell-nowrap">{fmtNum(r.order_no_b ?? '—')}</td>
                      <td className="cell-nowrap">{fmtNum(r.operator_username ?? '—')}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : isCutHead ? (
          <div className="data-table-wrap task-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="cell-nowrap">记录ID</th>
                  <th className="cell-nowrap">创建时间</th>
                  <th className="cell-nowrap">订单编号</th>
                  <th>客户</th>
                  <th>炉号</th>
                  <th>材质</th>
                  <th className="cell-nowrap">切头重量</th>
                </tr>
              </thead>
              <tbody>
                {cutHeadListLoading ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      加载中…
                    </td>
                  </tr>
                ) : cutHeadRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="muted">
                      暂无切头记录
                    </td>
                  </tr>
                ) : (
                  cutHeadRows.map((r) => (
                    <tr key={r.id}>
                      <td className="cell-nowrap">{r.id}</td>
                      <td className="cell-nowrap">{fmtDateTime(r.created_at)}</td>
                      <td className="cell-nowrap">{fmtNum(r.order_no)}</td>
                      <td>{fmtNum(r.customer_name)}</td>
                      <td>{fmtNum(r.incoming_no)}</td>
                      <td>{fmtNum(r.material_grade)}</td>
                      <td className="cell-nowrap">{fmtNum(r.weight)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : loading ? (
          <div className="data-table-wrap task-table-wrap" ref={setTaskTableWrap}>
            <table
              className={[
                'data-table',
                'task-mega-table',
                'table-resizable',
                megaColWidthsReady ? 'is-fixed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              ref={setMegaTableRef}
              style={{ width: `${megaTableWidthPx('')}px` }}
            >
              {renderMegaColgroup('')}
              {renderMegaThead(true)}
              <tbody>
                <tr>
                  <td colSpan={listColSpan} className="muted">
                    加载中…
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : rows.length === 0 ? (
          <div className="data-table-wrap task-table-wrap" ref={setTaskTableWrap}>
            <table
              className={[
                'data-table',
                'task-mega-table',
                'table-resizable',
                megaColWidthsReady ? 'is-fixed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              ref={setMegaTableRef}
              style={{ width: `${megaTableWidthPx('')}px` }}
            >
              {renderMegaColgroup('')}
              {renderMegaThead(true)}
              <tbody>
                <tr>
                  <td colSpan={listColSpan} className="muted">
                    暂无来料订单
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ) : tasksPreset === 'processing' ? (
          <>
            <div
              className="card tasks-processing-strip-card"
              aria-label="处理中件号首字母件数统计"
            >
              <div className="tasks-processing-strip-head">
                <span className="tasks-processing-strip-title">件号字母（在制件数）</span>
              </div>
              <div className="tasks-processing-piece-grid">
                <div className="tasks-processing-day-row" aria-hidden="false">
                  {processingDayColumns.map(({ day }) => (
                    <span
                      key={`d-${day}`}
                      className={[
                        'tasks-processing-day-num',
                        day === todayDayOfMonth ? 'is-today-col' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {day}
                    </span>
                  ))}
                </div>
                <div className="tasks-processing-day-divider" aria-hidden="true" />
                <div className="tasks-processing-letter-row">
                  {processingDayColumns.map(({ day, letter, count }) => {
                    const isTodayCol = day === todayDayOfMonth
                    return (
                      <span
                        key={letter}
                        role="button"
                        tabIndex={0}
                        aria-pressed={
                          showProcessingPieceFilter &&
                          String(letter ?? '').trim() === processingPieceLetterKey
                        }
                        onClick={() => {
                          const next = String(letter ?? '').trim()
                          setProcessingPieceLetter((prev) => {
                            const cur = String(prev ?? '').trim()
                            if (!next) return ''
                            if (cur && cur[0] === next) return ''
                            return next
                          })
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== 'Enter' && e.key !== ' ') return
                          e.preventDefault()
                          const next = String(letter ?? '').trim()
                          setProcessingPieceLetter((prev) => {
                            const cur = String(prev ?? '').trim()
                            if (!next) return ''
                            if (cur && cur[0] === next) return ''
                            return next
                          })
                        }}
                        className={[
                          'tasks-processing-piece-cell',
                          count === 0 ? 'is-muted' : '',
                          isTodayCol ? 'is-today-col' : '',
                          showProcessingPieceFilter &&
                          String(letter ?? '').trim() === processingPieceLetterKey
                            ? 'is-active'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        title={
                          isTodayCol
                            ? `今日（${day}日）${letter}：${count}件`
                            : `${day}日 ${letter}：${count}件`
                        }
                      >
                        <span className="tasks-processing-piece-letter">{letter}</span>
                        <span className="tasks-processing-piece-num">{count}</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            </div>
            {tasksPreset === 'processing' ? (
              <section className="card today-slot-order-bar" aria-label="今日件号排序">
                <div className="today-slot-order-head">
                  <span className="today-slot-order-title">今日件号排序（第1～10排）</span>
                  <div className="today-slot-order-actions">
                    <button type="button" className="btn btn-ghost" onClick={openSlotOrderModal}>
                      编辑排序
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={todayQueueRows.length === 0 || !can(user, PERM.ORDER_PROCESS)}
                      onClick={() =>
                        openWorkshopProductionPreview(todayQueueRows, {
                          slotLabels: todaySlotOrder,
                        })
                      }
                    >
                      打印排序生产单
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={todayQueueRows.length === 0}
                      onClick={() => {
                        setExportErr(null)
                        setExportModalOpen(true)
                      }}
                    >
                      数据导出
                    </button>
                  </div>
                </div>
                <div className="today-slot-order-body">
                  {todaySlotOrder.some((s) => String(s).trim()) ? (
                    <div
                      className="today-slot-order-two-col"
                      aria-label="件号排序（左列第1～6排，右列第7～10排；右侧窄条为占位）"
                    >
                      <div className="today-slot-order-col">
                        {[0, 1, 2, 3, 4, 5].map((i) => (
                          <span key={`l-${i}`} className="today-slot-chip">
                            第{i + 1}排{' '}
                            <strong>{formatSlotPiecesDisplay(todaySlotOrder[i] ?? '') || '—'}</strong>
                          </span>
                        ))}
                      </div>
                      <div className="today-slot-order-col">
                        {[6, 7, 8, 9].map((i) => (
                          <span key={`r-${i}`} className="today-slot-chip">
                            第{i + 1}排{' '}
                            <strong>{formatSlotPiecesDisplay(todaySlotOrder[i] ?? '') || '—'}</strong>
                          </span>
                        ))}
                      </div>
                      <div className="today-slot-order-col today-slot-order-col-spacer" aria-hidden>
                        <span className="today-slot-order-slot-spacer" />
                        <span className="today-slot-order-slot-spacer" />
                        <span className="today-slot-order-slot-spacer" />
                      </div>
                    </div>
                  ) : (
                    <p className="muted today-slot-order-empty">
                      尚未填写；点击「编辑排序」，先选排再点件号填入。
                    </p>
                  )}
                </div>
              </section>
            ) : null}
            <div
              className="task-queue-panels"
              style={{
                display: 'flex',
                flexDirection: 'column',
                flexWrap: 'nowrap',
                gap: '1rem',
                width: '100%',
                alignItems: 'stretch',
              }}
            >
            <div
              role="region"
              aria-labelledby="task-queue-today-heading"
              className="task-queue-panel card"
              style={{ width: '100%', minWidth: 0, flexShrink: 0 }}
            >
              <div className="task-queue-panel-head">
                <h3 id="task-queue-today-heading" className="task-queue-panel-title">
                  今日处理 ·{' '}
                  {showProcessingPieceFilter
                    ? `${processingPieceLetterKey} · ${filteredTodayOrderCount}个订单，${filteredTodayQueueExpandedBands.length}件`
                    : `${todayQueueRows.length}个订单，${todayQueueQtySum}件`}
                </h3>
                <div className="task-queue-panel-actions">
                  {todayMultiFoldStats.multi > 0 ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-pressed={
                        todayMultiFoldStats.aggregated === todayMultiFoldStats.multi
                      }
                      onClick={toggleTodayFoldAll}
                    >
                      {todayMultiFoldStats.aggregated === todayMultiFoldStats.multi
                        ? '展开'
                        : '折叠'}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={todayQueueRows.length === 0 || !can(user, PERM.ORDER_PROCESS)}
                    onClick={() => openWorkshopProductionPreview(todayQueueRows)}
                  >
                    加工生产单预览
                  </button>
                </div>
              </div>
              <div
                className="data-table-wrap task-queue-panel-inner"
                ref={setTaskTableWrap}
                onScroll={(e) => {
                  taskTableWrapRef.current = e.currentTarget
                }}
              >
                <table
                  className={[
                    'data-table',
                    'task-mega-table',
                    'table-resizable',
                    megaColWidthsReady ? 'is-fixed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={setMegaTableRef}
                  style={{ width: `${megaTableWidthPx('操作')}px` }}
                >
                  {renderMegaColgroup('操作')}
                  {renderMegaThead(true, '操作')}
                  <tbody>
                    {(showProcessingPieceFilter
                      ? filteredTodayQueueExpandedBands.length === 0
                      : todayQueueRows.length === 0) ? (
                      <tr>
                        <td colSpan={listColSpan + 1} className="muted task-queue-empty-hint">
                          {showProcessingPieceFilter
                            ? '暂无符合筛选的件号'
                            : '暂无；使用「开始处理（今日）」将订单移入本节'}
                        </td>
                      </tr>
                    ) : (
                      (showProcessingPieceFilter
                        ? filteredTodayQueueClusters
                        : todayQueueClusters
                      ).flatMap((cluster) => {
                        const it0 = cluster[0].it
                        const ono = String(it0.order_no ?? '')
                        const multi = cluster.length > 1
                        const aggregated =
                          multi && collapsedTodayOrderNos.has(ono)
                        const summaryLabelShort = todayClusterPieceLabelShort(cluster)
                        if (multi && aggregated) {
                          return [
                            renderTaskRow(it0, {
                              orderBand: cluster[0].orderBand,
                              queueExpandMode: 'today',
                              enableSplitAction: true,
                              todayExpand: {
                                groupSummary: true,
                                summaryPieceCount: cluster.length,
                                summaryLabelShort,
                                orderStatusOverride: `聚合 · ${cluster.length}件`,
                              },
                            }),
                          ]
                        }
                        return cluster.map((row) =>
                          renderTaskRow(row.it, {
                            orderBand: row.orderBand,
                            queueExpandMode: 'today',
                            enableSplitAction: true,
                            todayExpand: {
                              unitIndex: row.unitIndex,
                              unitsTotal: row.unitsTotal,
                              showOrderNo: row.showOrderNo,
                              unitLabel: row.unitLabel,
                              todayGroupClickToggle:
                                multi && row.unitIndex === 0 ? true : undefined,
                            },
                          }),
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div
              role="region"
              aria-labelledby="task-queue-tomorrow-heading"
              className="task-queue-panel card"
              style={{ width: '100%', minWidth: 0, flexShrink: 0 }}
            >
              <div className="task-queue-panel-head">
                <h3 id="task-queue-tomorrow-heading" className="task-queue-panel-title">
                  明日处理 ·{' '}
                  {showProcessingPieceFilter
                    ? `${processingPieceLetterKey} · ${filteredTomorrowOrderCount}个订单，${filteredTomorrowQueueExpandedBands.length}件`
                    : `${tomorrowQueueRows.length}个订单，${tomorrowQueueQtySum}件`}
                </h3>
              </div>
              <div
                className="data-table-wrap task-queue-panel-inner"
                ref={setTaskTableWrap}
                onScroll={(e) => {
                  taskTableWrapRef.current = e.currentTarget
                }}
              >
                <table
                  className={[
                    'data-table',
                    'task-mega-table',
                    'table-resizable',
                    megaColWidthsReady ? 'is-fixed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={setMegaTableRef}
                  style={{ width: `${megaTableWidthPx('')}px` }}
                >
                  {renderMegaColgroup('')}
                  {renderMegaThead(false)}
                  <tbody>
                    {showProcessingPieceFilter ? (
                      filteredTomorrowQueueExpandedBands.length === 0 ? (
                        <tr>
                          <td colSpan={listColSpan} className="muted">
                            暂无符合筛选的件号
                          </td>
                        </tr>
                      ) : (
                        filteredTomorrowQueueExpandedBands.map((row) =>
                          renderTaskRow(row.it, {
                            orderBand: row.orderBand,
                            queueExpandMode: 'today',
                            todayExpand: {
                              unitIndex: row.unitIndex,
                              unitsTotal: row.unitsTotal,
                              showOrderNo: row.showOrderNo,
                              unitLabel: row.unitLabel,
                            },
                          }),
                        )
                      )
                    ) : tomorrowQueueRows.length === 0 ? (
                      <tr>
                        <td colSpan={listColSpan} className="muted">
                          暂无；使用「安排明日处理」将订单移入本节
                        </td>
                      </tr>
                    ) : (
                      tomorrowQueueRows.map((it) => renderTaskRow(it))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div
              role="region"
              aria-labelledby="task-queue-rest-heading"
              className="task-queue-panel card"
              style={{ width: '100%', minWidth: 0, flexShrink: 0 }}
            >
              <div className="task-queue-panel-head">
                <h3 id="task-queue-rest-heading" className="task-queue-panel-title">
                  待完成 ·{' '}
                  {showProcessingPieceFilter
                    ? `${processingPieceLetterKey} · ${filteredRestOrderCount}个订单，${filteredRestProcessingExpandedBands.length}件`
                    : `${restProcessingRows.length}个订单，${restQueueQtySum}件`}
                </h3>
                <div className="task-queue-panel-actions">
                  {restMultiFoldStats.multi > 0 ? (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      aria-pressed={
                        restMultiFoldStats.aggregated === restMultiFoldStats.multi
                      }
                      onClick={toggleRestFoldAll}
                    >
                      {restMultiFoldStats.aggregated === restMultiFoldStats.multi
                        ? '展开'
                        : '折叠'}
                    </button>
                  ) : null}
                </div>
              </div>
              <div
                className="data-table-wrap task-queue-panel-inner"
                ref={setTaskTableWrap}
                onScroll={(e) => {
                  taskTableWrapRef.current = e.currentTarget
                }}
              >
                <table
                  className={[
                    'data-table',
                    'task-mega-table',
                    'table-resizable',
                    megaColWidthsReady ? 'is-fixed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={setMegaTableRef}
                  style={{ width: `${megaTableWidthPx('')}px` }}
                >
                  {renderMegaColgroup('')}
                  {renderMegaThead(false)}
                  <tbody>
                    {(showProcessingPieceFilter
                      ? filteredRestProcessingExpandedBands.length === 0
                      : restProcessingRows.length === 0) ? (
                      <tr>
                        <td colSpan={listColSpan} className="muted">
                          {showProcessingPieceFilter
                            ? '暂无符合筛选的件号'
                            : '暂无待完成明细'}
                        </td>
                      </tr>
                    ) : (
                      (showProcessingPieceFilter
                        ? filteredRestProcessingClusters
                        : restProcessingClusters
                      ).flatMap((cluster) => {
                        const it0 = cluster[0].it
                        const ono = String(it0.order_no ?? '')
                        const multi = cluster.length > 1
                        const aggregated = multi && collapsedRestOrderNos.has(ono)
                        const summaryLabelShort = todayClusterPieceLabelShort(cluster)
                        if (multi && aggregated) {
                          return [
                            renderTaskRow(it0, {
                              orderBand: cluster[0].orderBand,
                              queueExpandMode: 'rest',
                              todayExpand: {
                                groupSummary: true,
                                summaryPieceCount: cluster.length,
                                summaryLabelShort,
                                orderStatusOverride: `聚合 · ${cluster.length}件`,
                              },
                            }),
                          ]
                        }
                        return cluster.map((row) =>
                          renderTaskRow(row.it, {
                            orderBand: row.orderBand,
                            queueExpandMode: 'rest',
                            todayExpand: {
                              unitIndex: row.unitIndex,
                              unitsTotal: row.unitsTotal,
                              showOrderNo: row.showOrderNo,
                              unitLabel: row.unitLabel,
                              todayGroupClickToggle:
                                multi && row.unitIndex === 0 ? true : undefined,
                            },
                          }),
                        )
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          </>
        ) : tasksPreset === 'ready_outbound' ? (
          <div
            className="task-queue-panels"
            style={{
              display: 'flex',
              flexDirection: 'column',
              flexWrap: 'nowrap',
              gap: '1rem',
              width: '100%',
              alignItems: 'stretch',
            }}
          >
            <div
              role="region"
              aria-labelledby="outbound-ship-heading"
              className="task-queue-panel card"
              style={{ width: '100%', minWidth: 0, flexShrink: 0 }}
            >
              <div className="task-queue-panel-head">
                <h3 id="outbound-ship-heading" className="task-queue-panel-title">
                  出库中 · {shippingOutboundRows.length} 条
                </h3>
                <div className="task-queue-panel-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={
                      shippingOutboundRows.length === 0 || !can(user, PERM.ORDER_OUTBOUND)
                    }
                    onClick={() => openDeliverySlipPreview(shippingOutboundRows)}
                  >
                    导出送货单（按收货单位分页）
                  </button>
                </div>
              </div>
              <div
                className="data-table-wrap task-queue-panel-inner"
                ref={setTaskTableWrap}
                onScroll={(e) => {
                  taskTableWrapRef.current = e.currentTarget
                }}
              >
                <table
                  className={[
                    'data-table',
                    'task-mega-table',
                    'table-resizable',
                    megaColWidthsReady ? 'is-fixed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={setMegaTableRef}
                  style={{ width: `${megaTableWidthPx('')}px` }}
                >
                  {renderMegaColgroup('')}
                  {renderMegaThead(true)}
                  <tbody>
                    {shippingOutboundRows.length === 0 ? (
                      <tr>
                        <td colSpan={listColSpan} className="muted">
                          暂无；在等待出库中点击「→出库中」进入本节后可打印送货单
                        </td>
                      </tr>
                    ) : (
                      shippingOutboundRows.map((r) => renderTaskRow(r))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
            <div
              role="region"
              aria-labelledby="outbound-wait-heading"
              className="task-queue-panel card"
              style={{ width: '100%', minWidth: 0, flexShrink: 0 }}
            >
              <div className="task-queue-panel-head">
                <h3 id="outbound-wait-heading" className="task-queue-panel-title">
                  等待出库 · {waitingOutboundRows.length} 条
                </h3>
              </div>
              <div
                className="data-table-wrap task-queue-panel-inner"
                ref={setTaskTableWrap}
                onScroll={(e) => {
                  taskTableWrapRef.current = e.currentTarget
                }}
              >
                <table
                  className={[
                    'data-table',
                    'task-mega-table',
                    'table-resizable',
                    megaColWidthsReady ? 'is-fixed' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  ref={setMegaTableRef}
                  style={{ width: `${megaTableWidthPx('')}px` }}
                >
                  {renderMegaColgroup('')}
                  {renderMegaThead(false)}
                  <tbody>
                    {waitingOutboundRows.length === 0 ? (
                      <tr>
                        <td colSpan={listColSpan} className="muted task-queue-empty-hint">
                          暂无；处理中单据设为「待发回」后进入本节，可点此「→出库中」发运
                        </td>
                      </tr>
                    ) : (
                      waitingOutboundRows.map((r) => renderTaskRow(r))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="data-table-wrap task-table-wrap" ref={setTaskTableWrap}>
            <table
              className={[
                'data-table',
                'task-mega-table',
                'table-resizable',
                megaColWidthsReady ? 'is-fixed' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              ref={setMegaTableRef}
              style={{ width: `${megaTableWidthPx('')}px` }}
            >
              {renderMegaColgroup('')}
              {renderMegaThead(true)}
              <tbody>{rows.map(renderTaskRow)}</tbody>
            </table>
          </div>
        )
      ) : (
        <>
          {!detail && detailLoading ? <p className="muted">加载订单…</p> : null}
          {detail ? (
            <>
              <section className="card order-section">
                <div className="order-detail-head">
                  <div>
                    <h2 className="order-section-title-inline">{detail.order_no}</h2>
                    <p className="muted">
                      客户：{detail.customer?.name} · 下单时间：
                      {fmtDateTime(detail.created_at)} · 订单备注：{detail.remark || '—'}
                    </p>
                  </div>
                  <div className="row-actions">
                    {can(user, PERM.ORDER_PROCESS) ? (
                      <button type="button" className="btn btn-danger" onClick={deleteWorkOrder}>
                        删除订单
                      </button>
                    ) : null}
                  </div>
                </div>
              </section>

              {detail.items?.[0] &&
              (detail.items[0].remark ||
                (Array.isArray(detail.items[0].remark_images) &&
                  detail.items[0].remark_images.length > 0)) ? (
                <section className="card order-section">
                  <h2 className="order-section-title">锻造备注</h2>
                  <p className="text-cell">{detail.items[0].remark || '—'}</p>
                  {Array.isArray(detail.items[0].remark_images) &&
                  detail.items[0].remark_images.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                        marginTop: '0.5rem',
                      }}
                    >
                      {detail.items[0].remark_images.map((src) => (
                        <a key={src} href={apiUrl(src)} target="_blank" rel="noreferrer">
                          <img src={apiUrl(src)} alt="" style={{ maxHeight: 120, display: 'block' }} />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}

              <section className="card order-section">
                <h2 className="order-section-title">来料单</h2>
                {can(user, PERM.ORDER_PROCESS) ? (
                  <div style={{ marginTop: '0.5rem' }}>
                    <DragDropFileButton
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      multiple
                      disabled={incomingSheetSubmitting}
                      label="拖入/选择来料单图片"
                      meta={incomingSheetSubmitting ? '上传中…' : '支持多选'}
                      onFiles={(files) => void uploadDetailIncomingSheetFiles(files)}
                    />
                    {incomingSheetSubmitting ? <span className="muted" style={{ marginLeft: '0.5rem' }}>上传中…</span> : null}
                  </div>
                ) : null}
                {Array.isArray(detail.items?.[0]?.incoming_sheet_images) &&
                detail.items[0].incoming_sheet_images.length > 0 ? (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                      marginTop: '0.75rem',
                    }}
                  >
                    {detail.items[0].incoming_sheet_images.map((src) => (
                      <div
                        key={src}
                        style={{
                          border: '1px solid var(--border, #ddd)',
                          borderRadius: 8,
                          padding: 4,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <a href={apiUrl(src)} target="_blank" rel="noreferrer">
                          <img src={apiUrl(src)} alt="" style={{ maxHeight: 120, display: 'block' }} />
                        </a>
                        {can(user, PERM.ORDER_PROCESS) ? (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={incomingSheetSubmitting}
                            onClick={() => removeDetailIncomingSheetImage(src)}
                          >
                            移除
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: '0.5rem' }}>
                    暂无来料单图片。
                  </p>
                )}
              </section>

              {detail.items?.[0] ? (
                <>
                  <section className="card order-section">
                    <h2 className="order-section-title">来料信息</h2>
                    <div className="data-table-wrap order-items-wide">
                      <table
                        className={['data-table', 'table-resizable', detailIncomingColWidthsReady ? 'is-fixed' : '']
                          .filter(Boolean)
                          .join(' ')}
                        ref={setDetailIncomingTableRef}
                      >
                        <colgroup>
                          {detailIncomingColOrderNormalized.map((k) => {
                            const w = Number(detailIncomingColWidths?.[k])
                            const style = Number.isFinite(w) && w > 0 ? { width: `${Math.round(w)}px` } : undefined
                            return <col key={`detail-incoming-col-${k}`} style={style} />
                          })}
                        </colgroup>
                        <thead>
                          <tr>
                            {detailIncomingColOrderNormalized.map((k, idx) => {
                              const label = (() => {
                                switch (k) {
                                  case 'incoming_no':
                                    return '炉号'
                                  case 'material_grade':
                                    return '材质'
                                  case 'spec_incoming':
                                    return '来料规格'
                                  case 'weight_incoming':
                                    return '来料重'
                                  case 'incoming_quantity':
                                    return '来料个数'
                                  case 'quantity':
                                    return '支数'
                                  case 'actions':
                                    return '操作'
                                  default:
                                    return k
                                }
                              })()
                              const cls = [
                                'task-col-draggable',
                                detailIncomingDnD.draggingKey === k ? 'task-col-dragging' : '',
                                detailIncomingDnD.overKey === k &&
                                detailIncomingDnD.draggingKey &&
                                detailIncomingDnD.draggingKey !== k
                                  ? 'task-col-drag-over'
                                  : '',
                              ]
                                .filter(Boolean)
                                .join(' ')
                              const dragProps = detailIncomingDnD.getThProps(k, { labelText: label })
                              const w = Number(detailIncomingColWidths?.[k])
                              const baseStyle = k === 'actions' ? { minWidth: '6rem' } : undefined
                              const style =
                                Number.isFinite(w) && w > 0 ? { ...(baseStyle || {}), width: `${Math.round(w)}px` } : baseStyle
                              return (
                                <th key={`detail-incoming-th-${k}`} className={cls || undefined} style={style} {...dragProps}>
                                  {label}
                                  {idx < detailIncomingColOrderNormalized.length - 1 ? (
                                    <span
                                      className="table-col-resizer"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                      }}
                                      onPointerDown={(e) => startResize('detail_incoming', k, e)}
                                    />
                                  ) : null}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.items ?? []).map((it) => (
                            <tr key={it.id}>
                              {detailIncomingColOrderNormalized.map((k) => {
                                switch (k) {
                                  case 'incoming_no':
                                    return <td key={k}>{it.incoming_no}</td>
                                  case 'material_grade':
                                    return <td key={k}>{it.material_grade}</td>
                                  case 'spec_incoming':
                                    return <td key={k} className="text-cell">{it.spec_incoming ?? '—'}</td>
                                  case 'weight_incoming':
                                    return <td key={k}>{it.weight_incoming ?? '—'}</td>
                                  case 'incoming_quantity':
                                    return <td key={k}>{fmtNum(it.incoming_quantity ?? 1)}</td>
                                  case 'quantity':
                                    return <td key={k}>{fmtNum(it.quantity)}</td>
                                  case 'actions':
                                    return (
                                      <td key={k} className="row-actions">
                                        <button
                                          type="button"
                                          className="btn btn-ghost"
                                          onClick={() => openEditItem(it)}
                                        >
                                          编辑
                                        </button>
                                      </td>
                                    )
                                  default:
                                    return null
                                }
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {detail.items?.length === 0 ? (
                      <p className="muted order-slip-empty" style={{ marginTop: '0.75rem' }}>
                        暂无来料数据。
                      </p>
                    ) : null}
                  </section>

                  <ForgingSpecSection
                    it0={detail.items[0]}
                    tasksPreset={tasksPreset}
                    statuses={statuses}
                    user={user}
                    patchStatus={patchStatus}
                    patchUnitStatus={patchUnitStatus}
                  />

                  <section className="card order-section">
                    <h2 className="order-section-title">锻造规格明细</h2>
                    <FinishedOutputsView
                      outputs={detail.items[0].finished_outputs}
                      unitCodes={detail.items[0].processing_unit_codes}
                      variant="table"
                      emptyText="—"
                    />
                  </section>

                  <section className="card order-section">
                    <h2 className="order-section-title">操作记录</h2>
                    <p className="muted order-section-desc">修磨等环节登记</p>
                    <div className="data-table-wrap">
                      <table
                        className={['data-table', 'table-resizable', detailLogColWidthsReady ? 'is-fixed' : '']
                          .filter(Boolean)
                          .join(' ')}
                        ref={setDetailLogTableRef}
                      >
                        <colgroup>
                          {detailLogColOrderNormalized.map((k) => {
                            const w = Number(detailLogColWidths?.[k])
                            const style = Number.isFinite(w) && w > 0 ? { width: `${Math.round(w)}px` } : undefined
                            return <col key={`detail-log-col-${k}`} style={style} />
                          })}
                        </colgroup>
                        <thead>
                          <tr>
                            {detailLogColOrderNormalized.map((k, idx) => {
                              const label = (() => {
                                switch (k) {
                                  case 'created_at':
                                    return '时间'
                                  case 'order_no':
                                    return '订单号'
                                  case 'incoming_no':
                                    return '炉号'
                                  case 'note':
                                    return '备注'
                                  default:
                                    return k
                                }
                              })()
                              const cls = [
                                'task-col-draggable',
                                detailLogDnD.draggingKey === k ? 'task-col-dragging' : '',
                                detailLogDnD.overKey === k && detailLogDnD.draggingKey && detailLogDnD.draggingKey !== k
                                  ? 'task-col-drag-over'
                                  : '',
                                k === 'created_at' ? 'cell-nowrap' : '',
                              ]
                                .filter(Boolean)
                                .join(' ')
                              const dragProps = detailLogDnD.getThProps(k, { labelText: label })
                              const w = Number(detailLogColWidths?.[k])
                              const style =
                                Number.isFinite(w) && w > 0 ? { width: `${Math.round(w)}px` } : undefined
                              return (
                                <th key={`detail-log-th-${k}`} className={cls || undefined} style={style} {...dragProps}>
                                  {label}
                                  {idx < detailLogColOrderNormalized.length - 1 ? (
                                    <span
                                      className="table-col-resizer"
                                      onClick={(e) => {
                                        e.preventDefault()
                                        e.stopPropagation()
                                      }}
                                      onPointerDown={(e) => startResize('detail_log', k, e)}
                                    />
                                  ) : null}
                                </th>
                              )
                            })}
                          </tr>
                        </thead>
                        <tbody>
                          {grindLogs.length === 0 ? (
                            <tr>
                              <td colSpan={Math.max(1, detailLogColOrderNormalized.length)} className="muted">
                                暂无操作记录
                              </td>
                            </tr>
                          ) : (
                            grindLogs.map((log) => (
                              <tr key={log.id}>
                                {detailLogColOrderNormalized.map((k) => {
                                  switch (k) {
                                    case 'created_at':
                                      return <td key={k} className="cell-nowrap">{fmtDateTime(log.created_at)}</td>
                                    case 'order_no':
                                      return <td key={k}>{log.order_no ?? '—'}</td>
                                    case 'incoming_no':
                                      return <td key={k}>{log.incoming_no ?? '—'}</td>
                                    case 'note':
                                      return <td key={k} className="text-cell">{log.note ?? '—'}</td>
                                    default:
                                      return null
                                  }
                                })}
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : (
                <section className="card order-section">
                  <p className="muted">暂无来料数据。</p>
                </section>
              )}
            </>
          ) : null}
        </>
      )}

      {cutHeadModalOpen ? (
        <Modal open title="新建切头" onClose={() => setCutHeadModalOpen(false)}>
            <form className="form-grid" onSubmit={submitCutHead} onKeyDown={preventModalFormEnterSubmit}>
              <label className="full">
                搜索（订单号/炉号）
                <input
                  value={cutHeadPickQ}
                  onChange={(e) => setCutHeadPickQ(e.target.value)}
                  placeholder="输入关键字"
                />
              </label>
              <label className="full">
                选择处理中订单 *
                <select
                  value={cutHeadPickId}
                  onChange={(e) => setCutHeadPickId(e.target.value)}
                  required
                >
                  {cutHeadPickLoading ? (
                    <option value="">加载中…</option>
                  ) : cutHeadPickRows.length === 0 ? (
                    <option value="">暂无数据</option>
                  ) : (
                    cutHeadPickRows.map((r) => (
                      <option key={r.id} value={String(r.id)}>
                        {r.order_no} · {r.customer_name} · {r.incoming_no ?? '—'} ·{' '}
                        {r.material_grade ?? '—'}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <label>
                切头重量
                <input
                  type="number"
                  step="0.001"
                  value={cutHeadWeight}
                  onChange={(e) => setCutHeadWeight(e.target.value)}
                  placeholder="kg"
                  required
                />
              </label>
              <div className="row-actions full" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!cutHeadPickId || !String(cutHeadWeight ?? '').trim()}
                >
                  保存
                </button>
              </div>
            </form>
        </Modal>
      ) : null}

      {unitStatusModal ? (
        <Modal
          open
          wide
          title={`逐支生产状态 · ${unitStatusModal.orderNo || `明细 ${unitStatusModal.itemId}`}`}
          onClose={() => {
            if (unitStatusSubmitting) return
            setUnitStatusModal(null)
          }}
        >
            {(() => {
              const modalIt =
                rows.find((r) => r.id === unitStatusModal.itemId) ||
                detail?.items?.find((r) => r.id === unitStatusModal.itemId) ||
                unitStatusModal
              const modalStatuses = statusOptionsForRow(modalIt, tasksPreset, statuses)
              return (
            <form className="form-grid" onSubmit={saveUnitStatuses} onKeyDown={preventModalFormEnterSubmit}>
              <p className="muted full" style={{ marginTop: '-0.25rem' }}>
                当前共 {unitStatusModal.qty} 支；列表展示的是最慢一支的生产状态。
              </p>
              <div className="full" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'end' }}>
                <label style={{ minWidth: '14rem', flex: '1 1 14rem' }}>
                  件号
                  <input
                    value={unitCodePrefixDraft}
                    onChange={(e) => setUnitCodePrefixDraft(e.target.value)}
                    placeholder="如：A1"
                  />
                </label>
                <label style={{ minWidth: '14rem', flex: '1 1 14rem' }}>
                  一键全部改为
                  <select value={unitStatusSetAll} onChange={(e) => setUnitStatusSetAll(e.target.value)}>
                    <option value="">请选择</option>
                    {modalStatuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={!unitStatusSetAll}
                  onClick={() => setUnitStatusDraft(Array(unitStatusModal.qty).fill(unitStatusSetAll))}
                >
                  应用到全部
                </button>
              </div>
              <div className="full data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th style={{ width: '4.5rem' }}>序号</th>
                      <th>件号</th>
                      <th style={{ minWidth: '12rem' }}>生产状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unitStatusDraft.map((status, idx) => (
                      <tr key={idx}>
                        <td className="cell-nowrap">{idx + 1}</td>
                        <td className="cell-nowrap" style={{ minWidth: '12rem' }}>
                          {String(unitCodePrefixDraft ?? '').trim() || '—'}
                        </td>
                        <td>
                          <select
                            value={status}
                            onChange={(e) =>
                              setUnitStatusDraft((prev) =>
                                prev.map((x, i) => (i === idx ? e.target.value : x)),
                              )
                            }
                          >
                            {modalStatuses.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {err ? <p className="err full">{err}</p> : null}
              <div className="form-actions full">
                <button type="submit" className="btn btn-primary" disabled={unitStatusSubmitting}>
                  {unitStatusSubmitting ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
              )
            })()}
        </Modal>
      ) : null}

      {workOrderTabs.length > 0 ? (
        <Modal
          open
          className="modal-workorder modal-workorder-tabs"
          title="新建来料订单"
          onClose={closeAllWorkOrderTabs}
          windowed
          draggable
          resizable
          closeOnBackdrop={false}
          initialWidth={1120}
          initialHeight={820}
        >
          <div className="workorder-tabs" role="tablist" aria-label="新建订单标签页">
            {workOrderTabs.map((t) => {
              const active =
                t.id === activeWorkOrderTabId ||
                (!activeWorkOrderTabId && t.id === workOrderTabs[workOrderTabs.length - 1]?.id)
              return (
                <div key={t.id} className={['workorder-tab-item', active ? 'is-active' : ''].filter(Boolean).join(' ')}>
                  <button
                    type="button"
                    className="workorder-tab-btn"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveWorkOrderTabId(t.id)}
                  >
                    订单 {t.label}
                  </button>
                  <button
                    type="button"
                    className="workorder-tab-close"
                    aria-label={`关闭订单 ${t.label}`}
                    onClick={() => closeWorkOrderTab(t.id)}
                  >
                    ×
                  </button>
                </div>
              )
            })}
            <button type="button" className="btn btn-primary workorder-tab-add" onClick={openNewWorkOrderWindow}>
              新建一单
            </button>
          </div>
          <div className="workorder-tab-panel" role="tabpanel">
            {(() => {
              const resolvedId =
                activeWorkOrderTabId || workOrderTabs[workOrderTabs.length - 1]?.id || null
              return workOrderTabs.map((t) => {
                const active = t.id === resolvedId
                return (
                  <div key={t.id} style={{ display: active ? 'block' : 'none' }}>
                    <WorkOrderCreateTab
                      tabId={t.id}
                      customers={customers}
                      statuses={statuses}
                      uploadRemarkImagesForItem={uploadRemarkImagesForItem}
                      uploadIncomingSheetImagesForItem={uploadIncomingSheetImagesForItem}
                      onCreated={handleWorkOrderCreated}
                      onRequestClose={() => closeWorkOrderTab(t.id)}
                    />
                  </div>
                )
              })
            })()}
          </div>
        </Modal>
      ) : null}

      {itemModal ? (
        <Modal open wide className="modal-workorder" title="编辑来料" onClose={() => setItemModal(null)}>
            <form
              className="form-grid item-form-grid"
              onSubmit={submitItem}
              onKeyDown={preventModalFormEnterSubmit}
            >
              <label>
                炉号
                <input
                  value={itemForm.incoming_no}
                  onChange={(e) => setItemForm((f) => ({ ...f, incoming_no: e.target.value }))}
                />
              </label>
              <label>
                材质
                <input
                  value={itemForm.material_grade}
                  onChange={(e) => setItemForm((f) => ({ ...f, material_grade: e.target.value }))}
                />
              </label>
              <label>
                来料规格
                <input
                  value={itemForm.spec_incoming}
                  onChange={(e) => setItemForm((f) => ({ ...f, spec_incoming: e.target.value }))}
                />
              </label>
              <label>
                来料重
                <input
                  value={itemForm.weight_incoming}
                  onChange={(e) => setItemForm((f) => ({ ...f, weight_incoming: e.target.value }))}
                />
              </label>
              <label>
                来料个数
                <input
                  type="number"
                  min={1}
                  value={itemForm.incoming_quantity}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, incoming_quantity: e.target.value }))
                  }
                />
              </label>
              <div className="full">
                <span className="form-field-label">成品</span>
                <FinishedOutputsEditor
                  rows={itemFinishedOutputs}
                  onChange={setItemFinishedOutputs}
                  defaultPieces=""
                  allowAddRow={false}
                  showWeightReturn
                  showReturnDate
                  showRemark
                />
              </div>
              <label className="full">
                锻造要求
                <textarea
                  value={itemForm.forging_requirements}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, forging_requirements: e.target.value }))
                  }
                />
              </label>
              <label className="full">
                锻造备注
                <textarea
                  value={itemForm.remark}
                  onChange={(e) => setItemForm((f) => ({ ...f, remark: e.target.value }))}
                />
              </label>
              <div className="full" style={{ gridColumn: '1 / -1' }}>
                <label>锻造备注配图</label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={onItemRemarkFilesSelected}
                />
                {Array.isArray(itemForm.remark_images) && itemForm.remark_images.length > 0 ? (
                  <ul
                    style={{
                      listStyle: 'none',
                      padding: 0,
                      margin: '0.5rem 0 0',
                      display: 'flex',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                    }}
                  >
                    {itemForm.remark_images.map((src) => (
                      <li
                        key={src}
                        style={{
                          border: '1px solid var(--border, #ddd)',
                          borderRadius: 8,
                          padding: 4,
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <a href={apiUrl(src)} target="_blank" rel="noreferrer">
                          <img src={apiUrl(src)} alt="" style={{ maxHeight: 72, display: 'block' }} />
                        </a>
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() =>
                            setItemForm((f) => ({
                              ...f,
                              remark_images: (f.remark_images || []).filter((x) => x !== src),
                            }))
                          }
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
              <label>
                生产状态
                {(() => {
                  const modalIt =
                    rows.find((r) => r.id === itemModal?.itemId) ||
                    detail?.items?.find((r) => r.id === itemModal?.itemId) ||
                    itemModal
                  const modalStatuses = statusOptionsForRow(modalIt, tasksPreset, statuses)
                  const curStatus = String(itemForm.production_status ?? '').trim()
                  const hasCur = curStatus && modalStatuses.includes(curStatus)
                  return (
                    <select
                      value={itemForm.production_status}
                      onChange={(e) =>
                        setItemForm((f) => ({ ...f, production_status: e.target.value }))
                      }
                    >
                      {!hasCur && curStatus ? (
                        <option value={curStatus} disabled>
                          {curStatus}
                        </option>
                      ) : null}
                      {modalStatuses.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  )
                })()}
              </label>
              <label>
                来料日期
                <input
                  type="date"
                  value={itemForm.incoming_date}
                  onChange={(e) => setItemForm((f) => ({ ...f, incoming_date: e.target.value }))}
                />
              </label>
              <label>
                下料/锻造时间
                <input
                  type="datetime-local"
                  value={dtLocal(itemForm.cutting_time)}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, cutting_time: e.target.value }))
                  }
                />
              </label>
              {err ? <p className="err full">{err}</p> : null}
              <div className="form-actions full">
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
            </form>
        </Modal>
      ) : null}

      {caseListModal ? (
        <Modal open wide title="订单案例" onClose={closeCaseStudyList}>
          <div className="task-case-modal-toolbar">
            <p className="muted">
              明细 {caseListModal.it.id} · {caseListModal.it.order_no}
              {caseListModal.unitLabel ? ` · ${caseListModal.unitLabel}` : ''}
            </p>
            {showCaseStudyUi ? (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  openCaseStudy(
                    caseListModal.it,
                    caseListModal.unitIndex,
                    caseListModal.unitLabel || caseUnitLabel(caseListModal.unitIndex, ''),
                  )
                }
              >
                ＋案例
              </button>
            ) : null}
          </div>
          {caseListErr ? <p className="err">{caseListErr}</p> : null}
          {caseListLoading ? (
            <p className="muted">加载案例…</p>
          ) : caseListRows.length === 0 ? (
            <p className="muted">暂无案例</p>
          ) : (
            <div className="task-case-modal-list">
              {caseListRows.map((row) => (
                <article key={row.id} className="task-case-card">
                  <div className="task-case-card-head">
                    <div>
                      <div className="task-case-card-title">
                        {row.unit_index !== null && row.unit_index !== undefined
                          ? `支点（件）#${row.unit_index}`
                          : '整单案例'}
                      </div>
                      <div className="muted task-case-card-time">{fmtDateTime(row.created_at)}</div>
                    </div>
                    {can(user, PERM.ORDER_PROCESS) ? (
                      <div className="task-case-card-actions">
                        <button
                          type="button"
                          className="case-action-icon"
                          title="编辑案例"
                          aria-label="编辑案例"
                          onClick={() =>
                            openCaseStudy(
                              { id: row.order_item_id, order_no: row.order_no },
                              row.unit_index,
                              row.unit_index !== null && row.unit_index !== undefined
                                ? `支点（件）#${row.unit_index}`
                                : '整单',
                              row,
                            )
                          }
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          className="case-action-icon danger"
                          title="删除案例"
                          aria-label="删除案例"
                          onClick={() => void deleteCaseStudyRow(row)}
                        >
                          🗑
                        </button>
                      </div>
                    ) : null}
                  </div>
                  {row.note ? <p className="task-case-card-note">{row.note}</p> : null}
                  {Array.isArray(row.images) && row.images.length > 0 ? (
                    <div className="task-case-card-images">
                      {row.images.map((src) => (
                        <a key={src} href={apiUrl(src)} target="_blank" rel="noopener noreferrer">
                          <img src={apiUrl(src)} alt="" loading="lazy" />
                        </a>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </Modal>
      ) : null}

      <CaseStudyEditorModal
        open={Boolean(caseModal)}
        title={caseModal?.mode === 'edit' ? '编辑生产案例' : '添加生产案例'}
        subtitle={
          caseModal
            ? `明细 ${caseModal.it.id} · ${caseModal.it.order_no}${
                caseModal.unitLabel ? ` · ${caseModal.unitLabel}` : ''
              }`
            : ''
        }
        note={caseNote}
        onNoteChange={setCaseNote}
        onSubmit={submitCaseStudy}
        onClose={closeCaseStudy}
        onFilesPicked={appendCaseFiles}
        existingImages={caseExistingImages}
        onRemoveExistingImage={removeExistingCaseImage}
        filePreviews={caseFilePreviews}
        onRemoveFile={removeCaseFile}
        error={err}
        submitting={caseSubmitting}
        submitLabel={caseModal?.mode === 'edit' ? '保存修改' : '保存'}
      />

      {slotOrderModalOpen ? (
        <Modal
          open
          wide
          className="today-slot-order-modal"
          title="今日件号排序"
          onClose={() => setSlotOrderModalOpen(false)}
        >
            <p className="muted" style={{ marginTop: '-0.35rem' }}>
              先点选一排（高亮），再点上方的件号：可连续点多个件号排进同一排（用两个空格分隔）；同一排再点已选件号会从该排去掉。非「未编号」的件号仍不可同时出现在两排。
            </p>
            <section className="today-slot-modal-pool" aria-label="今日处理件号">
              <div className="today-slot-modal-pool-head">
                <span className="today-slot-modal-pool-title">可选件号</span>
                <span className="muted today-slot-modal-pool-hint">
                  当前选中：第{slotOrderActiveSlot + 1}排
                </span>
              </div>
              {todaySlotPiecePool.length === 0 ? (
                <p className="muted today-slot-modal-pool-empty">暂无今日处理明细，无法排序</p>
              ) : (
                <div className="today-slot-modal-pool-chips">
                  {todaySlotPiecePool.map((p) => {
                    const placedRows = []
                    for (let j = 0; j < 10; j += 1) {
                      if (parseSlotPieces(slotOrderDraft[j]).includes(p.label)) placedRows.push(j)
                    }
                    const isPlaced = placedRows.length > 0
                    const placedLabel =
                      placedRows.length > 0
                        ? placedRows.map((i) => `第${i + 1}排`).join(' / ')
                        : ''
                    return (
                      <button
                        key={p.key}
                        type="button"
                        className={`today-slot-modal-piece-chip ${isPlaced ? 'is-placed' : ''}`}
                        onClick={() => assignSlotOrderPiece(p.label)}
                      >
                        <span className="today-slot-modal-piece-main">
                          {p.label === '—' ? '未编号' : p.label}
                        </span>
                        <span className="today-slot-modal-piece-meta">
                          {p.orderNo || `明细${p.detailId}`} · 第{p.unitIndex + 1}件
                        </span>
                        {isPlaced ? (
                          <span className="today-slot-modal-piece-slot">{placedLabel}</span>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
            <div className="today-slot-modal-two-col-wrap">
              <div className="today-slot-modal-two-col">
                <div className="today-slot-modal-col">
                  <span className="today-slot-modal-col-title muted">第1～6排（点选）</span>
                  {[0, 1, 2, 3, 4, 5].map((i) => {
                    const disp = formatSlotPiecesDisplay(slotOrderDraft[i] ?? '')
                    return (
                      <div key={i} className="today-slot-modal-slot-row">
                        <button
                          type="button"
                          className={`today-slot-modal-slot-btn ${slotOrderActiveSlot === i ? 'is-active' : ''}`}
                          aria-pressed={slotOrderActiveSlot === i}
                          onClick={() => setSlotOrderActiveSlot(i)}
                        >
                          <span className="today-slot-modal-slot-num">{`第${i + 1}排`}</span>
                          <span className="today-slot-modal-slot-val">{disp || '空'}</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost today-slot-modal-slot-clear"
                          aria-label={`清空第${i + 1}排`}
                          disabled={!disp}
                          onClick={() => clearSlotOrderRow(i)}
                        >
                          清空
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className="today-slot-modal-col">
                  <span className="today-slot-modal-col-title muted">第7～10排（点选）</span>
                  {[6, 7, 8, 9].map((i) => {
                    const disp = formatSlotPiecesDisplay(slotOrderDraft[i] ?? '')
                    return (
                      <div key={i} className="today-slot-modal-slot-row">
                        <button
                          type="button"
                          className={`today-slot-modal-slot-btn ${slotOrderActiveSlot === i ? 'is-active' : ''}`}
                          aria-pressed={slotOrderActiveSlot === i}
                          onClick={() => setSlotOrderActiveSlot(i)}
                        >
                          <span className="today-slot-modal-slot-num">{`第${i + 1}排`}</span>
                          <span className="today-slot-modal-slot-val">{disp || '空'}</span>
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost today-slot-modal-slot-clear"
                          aria-label={`清空第${i + 1}排`}
                          disabled={!disp}
                          onClick={() => clearSlotOrderRow(i)}
                        >
                          清空
                        </button>
                      </div>
                    )
                  })}
                </div>
                <div className="today-slot-modal-col today-slot-modal-spacer-col" aria-hidden>
                  <span className="today-slot-modal-slot-spacer" />
                  <span className="today-slot-modal-slot-spacer" />
                  <span className="today-slot-modal-slot-spacer" />
                </div>
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: '0.75rem' }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setSlotOrderDraft(Array(10).fill(''))}
              >
                清空全部排
              </button>
              <button type="button" className="btn btn-primary" onClick={saveSlotOrderModal}>
                保存
              </button>
            </div>
        </Modal>
      ) : null}

      {exportModalOpen ? (
        <Modal
          open
          wide
          title="数据导出"
          onClose={() => {
            setExportErr(null)
            setExportModalOpen(false)
          }}
        >
            <form
              className="form-grid"
              onSubmit={(e) => {
                e.preventDefault()
                exportSelectedTodayOrder()
              }}
              onKeyDown={preventModalFormEnterSubmit}
            >
              <label className="full">
                客户（模糊匹配）
                <input
                  list="export-customer-options"
                  value={exportCustomerQ}
                  onChange={(e) => setExportCustomerQ(e.target.value)}
                  placeholder="输入客户名称（可下拉选择）"
                />
                <datalist id="export-customer-options">
                  {customers.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </label>
              <div className="workorder-row workorder-row--2">
                <label>
                  来料日期起
                  <input type="date" value={exportIncomingFrom} onChange={(e) => setExportIncomingFrom(e.target.value)} />
                </label>
                <label>
                  来料日期止
                  <input type="date" value={exportIncomingTo} onChange={(e) => setExportIncomingTo(e.target.value)} />
                </label>
              </div>
              <div className="workorder-row workorder-row--2">
                <label>
                  送回日期起
                  <input type="date" value={exportReturnFrom} onChange={(e) => setExportReturnFrom(e.target.value)} />
                </label>
                <label>
                  送回日期止
                  <input type="date" value={exportReturnTo} onChange={(e) => setExportReturnTo(e.target.value)} />
                </label>
              </div>
              <label className="full">
                选择订单（同源分支会自动一起导出）
                <select value={exportGroupKey} onChange={(e) => setExportGroupKey(e.target.value)}>
                  {exportGroups.length === 0 ? <option value="">暂无可导出订单</option> : null}
                  {exportGroups.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.label}
                    </option>
                  ))}
                </select>
              </label>
              {exportErr ? <p className="err full">{exportErr}</p> : null}
              <div className="form-actions full">
                <button type="submit" className="btn btn-primary" disabled={exportGroups.length === 0}>
                  导出
                </button>
              </div>
            </form>
        </Modal>
      ) : null}

      {todaySplitModal ? (
        <Modal
          open
          wide
          title="拆分订单"
          onClose={() => {
            if (todaySplitSubmitting) return
            setTodaySplitModal(null)
            setTodaySplitLeftIndexes([])
            setTodaySplitRightIndexes([])
            setTodaySplitEdit(null)
          }}
        >
          <div className="form-grid" onKeyDown={preventModalFormEnterSubmit}>
            <p className="muted full">
              原订单：{todaySplitModal.orderNo1} → 新订单：{todaySplitModal.orderNo2}
            </p>
            <div className="task-split-modal-grid full">
              <section className="task-split-modal-col">
                <div className="muted task-split-modal-col-title">原订单（保留）</div>
                <div>订单编号：{todaySplitModal.orderNo1 || '—'}</div>
                <div>客户：{todaySplitModal.customerName || '—'}</div>
                <div>材质：{todaySplitModal.materialGrade || '—'}</div>
                <div>来料规格：{todaySplitModal.specIncoming || '—'}</div>
                <div className="task-split-modal-spec">
                  锻造规格：{' '}
                  <span
                    dangerouslySetInnerHTML={{
                      __html: formatForgingSpecHtml(todaySplitModal.forgingSpec || '—', '—'),
                    }}
                  />
                </div>
                <div>发回重量：{fmtNumCell(todaySplitModal.weightReturn)}</div>
                <div>发回日期：{todaySplitModal.returnDate || '—'}</div>
                <div>锻造备注：{todaySplitModal.remark || '—'}</div>
                <div className="task-split-modal-count">
                  支数：{todaySplitModal.quantityKnown ? (todaySplitLeftIndexes.length > 0 ? todaySplitLeftIndexes.length : '—') : '—'}
                </div>
                {todaySplitModal.quantityKnown ? (
                  <div className="task-split-units">
                    {todaySplitLeftIndexes.map((idx) => {
                      const code = todaySplitModal.unitCodes?.[idx] ?? `第${idx + 1}件`
                      return (
                        <button
                          key={`l-${idx}`}
                          type="button"
                          className="task-split-unit-btn"
                          disabled={todaySplitSubmitting}
                          onClick={() => {
                            setTodaySplitLeftIndexes((prev) => prev.filter((x) => x !== idx))
                            setTodaySplitRightIndexes((prev) => [...prev, idx].sort((a, b) => a - b))
                          }}
                        >
                          <span className="task-split-unit-code">{code}</span>
                          <span className="task-split-unit-arrow">→</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: '0.4rem' }}>
                    当前订单未填写支数，将直接拆分为新订单并自动分配新件号。
                  </p>
                )}
              </section>
              <div className="task-split-modal-divider" aria-hidden />
              <section className="task-split-modal-col">
                <div className="muted task-split-modal-col-title">拆分订单（新建）</div>
                <div>订单编号：{todaySplitModal.orderNo2 || '—'}</div>
                <div>客户：{todaySplitEdit?.customer_name || todaySplitModal.customerName || '—'}</div>
                <label>
                  材质
                  <input
                    value={todaySplitEdit?.material_grade ?? ''}
                    onChange={(e) =>
                      setTodaySplitEdit((p) => ({ ...(p || {}), material_grade: e.target.value }))
                    }
                  />
                </label>
                <label>
                  来料规格
                  <input
                    value={todaySplitEdit?.spec_incoming ?? ''}
                    onChange={(e) =>
                      setTodaySplitEdit((p) => ({ ...(p || {}), spec_incoming: e.target.value }))
                    }
                  />
                </label>
                <label>
                  锻造规格
                  <input
                    value={todaySplitEdit?.forging_spec ?? ''}
                    onChange={(e) =>
                      setTodaySplitEdit((p) => ({ ...(p || {}), forging_spec: e.target.value }))
                    }
                  />
                  <div
                    className="muted"
                    style={{ fontSize: '0.9em', marginTop: '0.25rem' }}
                    dangerouslySetInnerHTML={{
                      __html: formatForgingSpecHtml(todaySplitEdit?.forging_spec ?? '', '—'),
                    }}
                  />
                </label>
                <label>
                  发回重量
                  <input
                    value={todaySplitEdit?.weight_return ?? ''}
                    onChange={(e) =>
                      setTodaySplitEdit((p) => ({ ...(p || {}), weight_return: e.target.value }))
                    }
                    inputMode="decimal"
                    placeholder="如：12.345"
                  />
                </label>
                <label>
                  发回日期
                  <input
                    type="date"
                    value={todaySplitEdit?.return_date ?? ''}
                    onChange={(e) =>
                      setTodaySplitEdit((p) => ({ ...(p || {}), return_date: e.target.value }))
                    }
                  />
                </label>
                <label>
                  锻造备注
                  <input
                    value={todaySplitEdit?.remark ?? ''}
                    onChange={(e) => setTodaySplitEdit((p) => ({ ...(p || {}), remark: e.target.value }))}
                  />
                </label>
                <div className="task-split-modal-count">
                  支数：{todaySplitModal.quantityKnown ? (todaySplitRightIndexes.length > 0 ? todaySplitRightIndexes.length : '—') : '—'}
                </div>
                {todaySplitModal.quantityKnown ? (
                  <div className="task-split-units">
                    {todaySplitRightIndexes.map((idx) => {
                      const code = todaySplitModal.unitCodes?.[idx] ?? `第${idx + 1}件`
                      return (
                        <button
                          key={`r-${idx}`}
                          type="button"
                          className="task-split-unit-btn"
                          onClick={() => {
                            setTodaySplitRightIndexes((prev) => prev.filter((x) => x !== idx))
                            setTodaySplitLeftIndexes((prev) => [...prev, idx].sort((a, b) => a - b))
                          }}
                        >
                          <span className="task-split-unit-arrow">←</span>
                          <span className="task-split-unit-code">{code}</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <p className="muted" style={{ marginTop: '0.4rem' }}>
                    拆分后将自动生成新的件号，后续可分别补录支数。
                  </p>
                )}
              </section>
            </div>
            <div className="form-actions full">
              {err ? <p className="err full">{err}</p> : null}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={todaySplitSubmitting}
                onClick={() => {
                  setTodaySplitModal(null)
                  setTodaySplitLeftIndexes([])
                  setTodaySplitRightIndexes([])
                  setTodaySplitEdit(null)
                }}
              >
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  todaySplitSubmitting ||
                  (todaySplitModal.quantityKnown && todaySplitRightIndexes.length === 0) ||
                  (todaySplitModal.quantityKnown &&
                    todaySplitModal.qty > 1 &&
                    todaySplitRightIndexes.length >= todaySplitModal.qty)
                }
                onClick={() => void submitTodaySplit()}
              >
                {todaySplitSubmitting ? '拆分中…' : '确认拆分'}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {grindItem ? (
        <Modal
          open
          title="修磨记录"
          onClose={() => {
            setGrindItem(null)
            setGrindUnitIndex(null)
          }}
        >
            <p className="muted">
              订单 {grindItem.order_no} · 炉号 {grindItem.incoming_no ?? '—'}
              {grindUnitIndex !== null && grindUnitIndex !== undefined
                ? ` · 第 ${grindUnitIndex + 1} 件`
                : ''}
            </p>
            <form className="form-grid" onSubmit={submitGrind} onKeyDown={preventModalFormEnterSubmit}>
              <label className="full">
                备注（可选）
                <textarea
                  value={grindNote}
                  onChange={(e) => setGrindNote(e.target.value)}
                  placeholder="本次修磨说明"
                />
              </label>
              {err ? <p className="err">{err}</p> : null}
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  保存记录
                </button>
              </div>
            </form>
        </Modal>
      ) : null}
    </div>
  )
}
