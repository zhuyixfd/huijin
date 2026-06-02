import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './Pages.css'
import { deleteReq, getJson, patchJson, postFormData, postJson } from './api.js'
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
import Modal, { preventModalFormEnterSubmit } from './Modal.jsx'
import { FinishedOutputsEditor, FinishedOutputsView } from './FinishedOutputs.jsx'
import { FormedSizeStagesEditor, FormedSizeStagesView } from './FormedSizeStages.jsx'
import {
  emptyFinishedOutput,
  normalizeFinishedOutputsForApi,
  parseFinishedOutputsFromItem,
  sumFinishedOutputWeights,
} from './finishedOutputs.js'
import { FORMED_SIZE_FIELD_LABEL } from './formedSizeStages.js'
import { can, PERM } from './permissions.js'

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

const emptyItemForm = () => ({
  incoming_no: '',
  material_grade: '',
  spec_incoming: '',
  weight_incoming: '',
  quantity: 1,
  weight_return: '',
  formed_size: '',
  forging_requirements: '',
  remark: '',
  remark_images: [],
  production_status: '在库中',
  return_date: '',
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

/** 明细页按件：未指定件的记录挂在第 1 件展示（兼容旧数据） */
function grindLogsForUnit(logs, unitIdx) {
  return logs.filter((log) => {
    const ix = log.unit_index
    if (ix === null || ix === undefined) return unitIdx === 0
    return ix === unitIdx
  })
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

function normalizeItemPayload(form) {
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
    quantity: Number.isFinite(q) && q >= 1 ? q : 1,
    weight_return: form.weight_return === '' ? null : String(form.weight_return),
    formed_size: form.formed_size || null,
    forging_requirements: form.forging_requirements || null,
    remark: form.remark || null,
    remark_images:
      Array.isArray(form.remark_images) && form.remark_images.length > 0
        ? form.remark_images
        : null,
    production_status: form.production_status || '在库中',
    return_date: form.return_date || null,
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
const COL_COUNT = 22
const PAGE_SIZE_OPTIONS = [20, 50, 100]

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

export default function TasksPage({
  tasksPreset = 'all',
  onTasksMutated,
  taskNavCounts,
  user = null,
}) {
  const isCutHead = tasksPreset === 'cut_head'
  const isSplitMergeLogs = tasksPreset === 'split_merge_logs'
  const [customers, setCustomers] = useState([])
  const [statuses, setStatuses] = useState([])

  const [statusFilter, setStatusFilter] = useState('')
  const [cid, setCid] = useState('')
  const [customerNameQ, setCustomerNameQ] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [q, setQ] = useState('')

  const [rows, setRows] = useState([])
  const [listTotal, setListTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const [view, setView] = useState('list')
  const [detail, setDetail] = useState(null)
  const [grindLogs, setGrindLogs] = useState([])
  const [detailLoading, setDetailLoading] = useState(false)
  const [grindItem, setGrindItem] = useState(null)
  const [grindNote, setGrindNote] = useState('')
  const [grindUnitIndex, setGrindUnitIndex] = useState(null)

  const [workOrderModal, setWorkOrderModal] = useState(false)
  const [newWork, setNewWork] = useState(emptyWorkOrderForm)
  const [newWorkRemarkFiles, setNewWorkRemarkFiles] = useState([])
  const [newWorkRemarkPreviews, setNewWorkRemarkPreviews] = useState([])
  const [newWorkRemarkPreviewOpen, setNewWorkRemarkPreviewOpen] = useState(null)

  const [itemModal, setItemModal] = useState(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)
  const [itemFinishedOutputs, setItemFinishedOutputs] = useState(() => [emptyFinishedOutput()])
  const [newWorkFinishedOutputs, setNewWorkFinishedOutputs] = useState(() => [emptyFinishedOutput()])

  const [cutHeadModalOpen, setCutHeadModalOpen] = useState(false)
  const [cutHeadPickQ, setCutHeadPickQ] = useState('')
  const [cutHeadPickRows, setCutHeadPickRows] = useState([])
  const [cutHeadPickLoading, setCutHeadPickLoading] = useState(false)
  const [cutHeadPickId, setCutHeadPickId] = useState('')
  const [cutHeadWeight, setCutHeadWeight] = useState('')
  const [cutHeadRows, setCutHeadRows] = useState([])
  const [cutHeadTotal, setCutHeadTotal] = useState(0)
  const [cutHeadListLoading, setCutHeadListLoading] = useState(false)
  const [splitMergeRows, setSplitMergeRows] = useState([])
  const [splitMergeTotal, setSplitMergeTotal] = useState(0)
  const [splitMergeLoading, setSplitMergeLoading] = useState(false)

  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [splitTargetId, setSplitTargetId] = useState('')
  const [splitMoveIdx, setSplitMoveIdx] = useState(() => new Set())
  const [splitSubmitting, setSplitSubmitting] = useState(false)

  const [selectedIds, setSelectedIds] = useState([])
  const [bulkSelectColumnVisible, setBulkSelectColumnVisible] = useState(false)
  const [batchProductionExpanded, setBatchProductionExpanded] = useState(false)
  const [batchTargetStatus, setBatchTargetStatus] = useState('')
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [lastBatchUndo, setLastBatchUndo] = useState(null)
  /** 今日处理：同一订单号多件「聚合」为单行（按订单编号，不是隐藏表格） */
  const [collapsedTodayOrderNos, setCollapsedTodayOrderNos] = useState(() => new Set())
  /** 待完成：同订单号多件聚合（与今日处理一致） */
  const [collapsedRestOrderNos, setCollapsedRestOrderNos] = useState(() => new Set())
  const [caseModal, setCaseModal] = useState(null)
  const [caseNote, setCaseNote] = useState('')
  const [caseFiles, setCaseFiles] = useState([])
  const [caseSubmitting, setCaseSubmitting] = useState(false)
  /** 今日第1～10排件号排序（与加工单预览排位置同结构） */
  const [todaySlotOrder, setTodaySlotOrder] = useState(() => loadTodaySlotOrder())
  const [slotOrderModalOpen, setSlotOrderModalOpen] = useState(false)
  const [slotOrderDraft, setSlotOrderDraft] = useState(() => Array(10).fill(''))
  /** 编辑排序：当前选中的排（0～9），点击件号填入该排 */
  const [slotOrderActiveSlot, setSlotOrderActiveSlot] = useState(0)
  const [processingPieceLetter, setProcessingPieceLetter] = useState('')
  const headerSelectRef = useRef(null)

  const listStatusCategory = useMemo(
    () => statusCategoryFromPreset(tasksPreset),
    [tasksPreset],
  )

  /* 侧栏切换预设时清空「按生产状态筛选」，避免与新区间的列表条件叠加 */
  useEffect(() => {
    queueMicrotask(() => setStatusFilter(''))
  }, [tasksPreset])

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
    if (workOrderModal) return
    queueMicrotask(() => setNewWorkRemarkPreviewOpen(null))
  }, [workOrderModal])

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
    cid,
    q,
    customerNameQ,
    createdFrom,
    createdTo,
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

  const loadMeta = useCallback(() => {
    getJson('/api/meta/production-statuses').then((d) => setStatuses(d.statuses ?? []))
    getJson('/api/customers').then(setCustomers)
  }, [])

  const loadTasks = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (statusFilter) p.set('status', statusFilter)
    if (q.trim()) p.set('q', q.trim())
    if (cid) p.set('customer_id', cid)
    if (tasksPreset === 'all' && statusFilter) {
      p.set('status_category', 'all')
    } else if (listStatusCategory && listStatusCategory !== 'all') {
      p.set('status_category', listStatusCategory)
    }
    if (customerNameQ.trim()) p.set('customer_q', customerNameQ.trim())
    if (createdFrom) p.set('created_from', createdFrom)
    if (createdTo) p.set('created_to', createdTo)
    if (tasksPreset === 'all') {
      if (!statusFilter || statusFilter !== '已发回') {
        p.set('exclude_completed', 'true')
      }
    }
    p.set('skip', String((page - 1) * pageSize))
    p.set('limit', String(pageSize))
    const qs = p.toString()
    getJson(`/api/tasks/items?${qs}`)
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
    q,
    cid,
    listStatusCategory,
    customerNameQ,
    createdFrom,
    createdTo,
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
        setCutHeadTotal(tt)
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
        setSplitMergeTotal(tt)
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

  async function patchStatus(it, nextStatus) {
    setErr(null)
    try {
      await patchJson(`/api/order-items/${it.id}`, { production_status: nextStatus })
      loadTasks()
      if (detail && detail.id === it.id) await refreshDetail(detail.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '更新失败')
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
      if (detail && detail.id === grindItem.id) await refreshDetail(detail.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '记录失败')
    }
  }

  async function submitWorkOrder(e) {
    e.preventDefault()
    setErr(null)
    try {
      const payload = {
        customer_id: Number(newWork.customer_id),
        order_remark: newWork.order_remark || null,
        ...normalizeItemPayload(newWork),
        finished_outputs: normalizeFinishedOutputsForApi(newWorkFinishedOutputs),
      }
      const created = await postJson('/api/tasks/work-orders', payload)
      let mergedImages = Array.isArray(newWork.remark_images) ? [...newWork.remark_images] : []
      if (newWorkRemarkFiles.length > 0) {
        const up = await uploadRemarkImagesForItem(created.id, newWorkRemarkFiles)
        mergedImages = [...mergedImages, ...up]
        if (mergedImages.length > 0) {
          await patchJson(`/api/order-items/${created.id}`, { remark_images: mergedImages })
        }
      }
      setWorkOrderModal(false)
      setNewWork(emptyWorkOrderForm())
      setNewWorkFinishedOutputs([emptyFinishedOutput()])
      setNewWorkRemarkFiles([])
      loadTasks()
      await refreshDetail(created.id)
      setView('detail')
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败')
    }
  }

  function openEditItem(it) {
    setItemForm({
      incoming_no: it.incoming_no ?? '',
      material_grade: it.material_grade ?? '',
      spec_incoming: it.spec_incoming ?? '',
      weight_incoming: it.weight_incoming ?? '',
      quantity: it.quantity ?? 1,
      weight_return: it.weight_return ?? '',
      formed_size: it.formed_size ?? '',
      forging_requirements: it.forging_requirements ?? '',
      remark: it.remark ?? '',
      remark_images: Array.isArray(it.remark_images) ? [...it.remark_images] : [],
      production_status: it.production_status ?? '在库中',
      return_date: it.return_date ? String(it.return_date).slice(0, 10) : '',
      incoming_date: it.incoming_date ? String(it.incoming_date).slice(0, 10) : todayDateISO(),
      cutting_time: it.cutting_time
        ? String(it.cutting_time).slice(0, 16).replace('T', 'T')
        : todayDatetimeLocal(),
    })
    setItemFinishedOutputs(parseFinishedOutputsFromItem(it))
    setItemModal({ itemId: it.id })
  }

  async function submitItem(e) {
    e.preventDefault()
    if (!detail || !itemModal) return
    setErr(null)
    const payload = {
      ...normalizeItemPayload(itemForm),
      finished_outputs: normalizeFinishedOutputsForApi(itemFinishedOutputs),
    }
    try {
      await patchJson(`/api/order-items/${itemModal.itemId}`, payload)
      setItemModal(null)
      await refreshDetail(detail.id)
      loadTasks()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
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
  const showBulkSelectCol = showBulkCheckboxCol && bulkSelectColumnVisible
  const showReadyOutboundActionsCol = tasksPreset === 'ready_outbound'
  const customerColLabel = tasksPreset === 'ready_outbound' ? '收货单位' : '客户'
  const showCutHeadWeightColInList = tasksPreset === 'done' || isCutHead
  /** 列表 mega 表列显隐（进入详情改状态；部分预设去掉列减轻干扰） */
  const showTaskActionsCol = !(
    tasksPreset === 'all' ||
    tasksPreset === 'pending' ||
    tasksPreset === 'processing' ||
    tasksPreset === 'ready_outbound' ||
    tasksPreset === 'done' ||
    isCutHead
  )
  const showCuttingReturnDateCols = tasksPreset !== 'pending' && !isCutHead
  const showProductionStatusCol =
    tasksPreset !== 'ready_outbound' && tasksPreset !== 'done' && !isCutHead
  const showProcessingUnitCol = tasksPreset === 'processing'
  const dataColCount =
    COL_COUNT -
    (showCutHeadWeightColInList ? 0 : 1) -
    (showTaskActionsCol ? 0 : 1) -
    (showCuttingReturnDateCols ? 0 : 2) -
    (showProductionStatusCol ? 0 : 1) +
    (showProcessingUnitCol ? 1 : 0) +
    (showReadyOutboundActionsCol ? 1 : 0)
  const listColSpan = dataColCount + (showBulkSelectCol ? 1 : 0)
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

  const splitCandidates = useMemo(() => {
    if (tasksPreset !== 'processing') return []
    return todayQueueRows.filter((it) => {
      if (Number(it.quantity ?? 1) <= 1) return false
      const ono = String(it.order_no ?? '')
      if (ono.endsWith('-1') || ono.endsWith('-2')) return false
      return true
    })
  }, [tasksPreset, todayQueueRows])

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
      const ao = String(a.order_no ?? '')
      const bo = String(b.order_no ?? '')
      const cmp = ao.localeCompare(bo, 'zh-CN')
      if (cmp !== 0) return cmp
      return a.id - b.id
    })
    const flat = []
    for (const it of sorted) {
      const rawQ = Number(it.quantity)
      const units = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 1
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
      const ao = String(a.order_no ?? '')
      const bo = String(b.order_no ?? '')
      const cmp = ao.localeCompare(bo, 'zh-CN')
      if (cmp !== 0) return cmp
      return a.id - b.id
    })
    const flat = []
    for (const it of sorted) {
      const rawQ = Number(it.quantity)
      const units = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 1
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
      const ao = String(a.order_no ?? '')
      const bo = String(b.order_no ?? '')
      const cmp = ao.localeCompare(bo, 'zh-CN')
      if (cmp !== 0) return cmp
      return a.id - b.id
    })
    const flat = []
    for (const it of sorted) {
      const rawQ = Number(it.quantity)
      const units = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 1
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

  const splitTarget = useMemo(() => {
    if (!splitTargetId) return null
    const idNum = Number(splitTargetId)
    if (!Number.isFinite(idNum)) return null
    return splitCandidates.find((x) => x.id === idNum) ?? null
  }, [splitTargetId, splitCandidates])

  const splitUnits = useMemo(() => {
    if (!splitTarget) return []
    const rawQ = Number(splitTarget.quantity)
    const n = Number.isFinite(rawQ) && rawQ >= 1 ? Math.floor(rawQ) : 1
    const codes = Array.isArray(splitTarget.processing_unit_codes)
      ? splitTarget.processing_unit_codes
      : []
    const out = []
    for (let i = 0; i < n; i += 1) {
      out.push({ idx: i, label: codes[i] ?? `第${i + 1}件` })
    }
    return out
  }, [splitTarget])

  async function submitSplit(e) {
    e.preventDefault()
    if (!splitTarget) return
    const idxs = [...splitMoveIdx].map((x) => Number(x)).filter((x) => Number.isFinite(x))
    if (idxs.length === 0) return
    if (idxs.length >= splitUnits.length) return
    setErr(null)
    setSplitSubmitting(true)
    try {
      await postJson('/api/tasks/split-order', {
        order_item_id: splitTarget.id,
        move_unit_indexes: idxs,
      })
      setSplitModalOpen(false)
      setSplitTargetId('')
      setSplitMoveIdx(new Set())
      loadTasks()
      onTasksMutated?.()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '拆分失败')
    } finally {
      setSplitSubmitting(false)
    }
  }

  function openCaseStudy(it, unitIndex, unitLabel) {
    setCaseModal({ it, unitIndex, unitLabel })
    setCaseNote('')
    setCaseFiles([])
    setErr(null)
  }

  async function submitCaseStudy(e) {
    e.preventDefault()
    if (!caseModal) return
    setErr(null)
    setCaseSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('order_item_id', String(caseModal.it.id))
      fd.append('note', caseNote)
      if (caseModal.unitIndex !== null && caseModal.unitIndex !== undefined) {
        fd.append('unit_index', String(caseModal.unitIndex))
      }
      for (const f of caseFiles) {
        fd.append('files', f)
      }
      await postFormData('/api/case-studies', fd)
      setCaseModal(null)
      loadTasks()
      onTasksMutated?.()
    } catch (err) {
      setErr(err instanceof Error ? err.message : '保存失败')
    } finally {
      setCaseSubmitting(false)
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

  const renderTaskRow = (it, rowOptions = {}) => {
    const { orderBand, todayExpand, queueExpandMode = 'today' } = rowOptions
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
    const showStatusSelect = showChrome && canMutateStatus
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
    const statusLabel =
      todayExpand?.orderStatusOverride !== undefined
        ? todayExpand.orderStatusOverride
        : it.order_status
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
      <td className="cell-nowrap">
        <span className="task-id-cell">
          {badgeN > 0 ? (
            <span className="task-case-badge" title={`${badgeN} 条案例`}>
              案例
            </span>
          ) : null}
          {it.id}
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
      <td className={GS}>{fmtDate(it.incoming_date)}</td>
      {showProcessingUnitCol ? (
        <td className="cell-nowrap task-unit-code">{unitLabel ?? '—'}</td>
      ) : null}
      <td
        className={[
          'cell-nowrap',
          !showOrderNoCell ? 'task-order-no-merged' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {showOrderNoCell ? it.order_no : '\u00a0'}
      </td>
      <td>{fmtNum(it.customer_name)}</td>
      <td>{fmtNum(it.material_grade)}</td>
      <td className="text-cell">{fmtNum(it.spec_incoming)}</td>
      <td>{fmtNum(it.weight_incoming)}</td>
      <td>{qtyDisplay}</td>
      <td className="cell-nowrap">{fmtDateTime(it.order_created_at)}</td>
      <td>
        <span className="tag tag-status">{statusLabel}</span>
      </td>
      <td className="text-cell">{fmtNum(it.order_remark)}</td>
      <td className={GS}>{fmtNum(it.incoming_no)}</td>
      <td className={GS}>{fmtNum(it.weight_return)}</td>
      {showCutHeadWeightColInList ? <td className={GS}>{fmtNum(it.cut_head_weight)}</td> : null}
      <td className="text-cell formed-size-stages-cell">
        <FormedSizeStagesView value={it.formed_size} variant="compact" />
      </td>
      <td className="text-cell finished-outputs-cell">
        <FinishedOutputsView outputs={it.finished_outputs} variant="compact" />
      </td>
      <td className={`text-cell ${GS}`}>{fmtNum(it.forging_requirements)}</td>
      <td className="text-cell">{fmtNum(it.remark)}</td>
      {showCuttingReturnDateCols ? (
        <td>{fmtCuttingDate(it.cutting_time)}</td>
      ) : null}
      {showCuttingReturnDateCols ? <td>{fmtDate(it.return_date)}</td> : null}
      {showProductionStatusCol ? (
        <td className={GS} onClick={(e) => e.stopPropagation()}>
          {showStatusSelect ? (
            <select
              value={it.production_status}
              onChange={(e) => patchStatus(it, e.target.value)}
            >
              {statuses.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          ) : null}
        </td>
      ) : null}
      {showReadyOutboundActionsCol ? (
        <td className={`row-actions cell-actions ${GS}`} onClick={(e) => e.stopPropagation()}>
          {it.production_status === '待发回' ? (
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
      ) : null}
      {showTaskActionsCol ? (
        <td className={`row-actions cell-actions ${GS}`} onClick={(e) => e.stopPropagation()}>
          {showChrome && can(user, PERM.ORDER_PROCESS) ? (
            <>
              <button type="button" className="btn btn-ghost" onClick={() => patchStatus(it, '锻造中')}>
                →锻造
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => patchStatus(it, '待发回')}>
                →待发回
              </button>
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
                    setGrindUnitIndex(null)
                  }}
                >
                  修磨记录
                </button>
              ) : null}
            </>
          ) : null}
        </td>
      ) : null}
    </tr>
    )
  }

  const renderMegaThead = (bulkControls) => (
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
        <th className="cell-nowrap">明细ID</th>
        <th className={GS}>来料日期</th>
        {showProcessingUnitCol ? <th className="cell-nowrap">件号</th> : null}
        <th className="cell-nowrap">订单编号</th>
        <th>{customerColLabel}</th>
        <th>材质</th>
        <th>来料规格</th>
        <th>来料重量</th>
        <th>个数</th>
        <th className="cell-nowrap">下单时间</th>
        <th>订单状态</th>
        <th>订单备注</th>
        <th className={GS}>来料编号</th>
        <th className={GS}>发回重量</th>
        {showCutHeadWeightColInList ? <th className={GS}>切头重量</th> : null}
        <th>{FORMED_SIZE_FIELD_LABEL}</th>
        <th>成品明细</th>
        <th className={GS}>锻造要求</th>
        <th>备注</th>
        {showCuttingReturnDateCols ? <th>下料/锻造时间</th> : null}
        {showCuttingReturnDateCols ? <th>发回日期</th> : null}
        {showProductionStatusCol ? <th className={GS}>生产状态</th> : null}
        {showTaskActionsCol ? <th className={GS}>操作</th> : null}
        {showReadyOutboundActionsCol ? <th className={GS}>操作</th> : null}
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
    <div className="page-wrap tasks-page-merged">
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
              <select value={cid} onChange={(e) => setCid(e.target.value)}>
                <option value="">全部客户</option>
                {customers.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.name}
                  </option>
                ))}
              </select>
            ) : null}
            {!isCutHead && !isSplitMergeLogs ? (
              <input
                type="search"
                placeholder="客户名称（模糊）"
                value={customerNameQ}
                onChange={(e) => setCustomerNameQ(e.target.value)}
              />
            ) : null}
            {!isCutHead && !isSplitMergeLogs ? (
              <input
                type="date"
                aria-label="下单时间起"
                value={createdFrom}
                onChange={(e) => setCreatedFrom(e.target.value)}
              />
            ) : null}
            {!isCutHead && !isSplitMergeLogs ? (
              <input
                type="date"
                aria-label="下单时间止"
                value={createdTo}
                onChange={(e) => setCreatedTo(e.target.value)}
              />
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
            <input
              type="search"
              placeholder={
                isCutHead
                  ? '订单号 / 来料编号 / 客户'
                  : isSplitMergeLogs
                    ? '订单号'
                    : '订单号 / 来料编号'
              }
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
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
                  setNewWork(emptyWorkOrderForm())
                  setNewWorkFinishedOutputs([emptyFinishedOutput()])
                  setNewWorkRemarkFiles([])
                  setWorkOrderModal(true)
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
                  <th>来料编号</th>
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
          <div className="data-table-wrap task-table-wrap">
            <table className="data-table task-mega-table">
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
          <div className="data-table-wrap task-table-wrap">
            <table className="data-table task-mega-table">
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
            {Array.isArray(taskNavCounts?.processing_piece_strip) &&
            taskNavCounts.processing_piece_strip.length > 0 ? (
              <div
                className="card tasks-processing-strip-card"
                aria-label="处理中件号首字母件数统计"
              >
                <div className="tasks-processing-strip-head">
                  <span className="tasks-processing-strip-title">件号字母（在制件数）</span>
                </div>
                <div className="tasks-processing-piece-strip">
                  {taskNavCounts.processing_piece_strip.map(({ letter, count }) => (
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
                        showProcessingPieceFilter &&
                        String(letter ?? '').trim() === processingPieceLetterKey
                          ? 'is-active'
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={`${letter}：${count}件`}
                    >
                      <span className="tasks-processing-piece-letter">{letter}</span>
                      <span className="tasks-processing-piece-num">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
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
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={splitCandidates.length === 0 || !can(user, PERM.ORDER_PROCESS)}
                    onClick={() => {
                      setSplitModalOpen(true)
                      const first = splitCandidates[0]?.id
                      setSplitTargetId(first ? String(first) : '')
                      setSplitMoveIdx(new Set())
                    }}
                  >
                    拆分订单
                  </button>
                </div>
              </div>
              <div className="data-table-wrap task-queue-panel-inner">
                <table className="data-table task-mega-table">
                  {renderMegaThead(true)}
                  <tbody>
                    {(showProcessingPieceFilter
                      ? filteredTodayQueueExpandedBands.length === 0
                      : todayQueueRows.length === 0) ? (
                      <tr>
                        <td colSpan={listColSpan} className="muted task-queue-empty-hint">
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
              <div className="data-table-wrap task-queue-panel-inner">
                <table className="data-table task-mega-table">
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
              <div className="data-table-wrap task-queue-panel-inner">
                <table className="data-table task-mega-table">
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
                    打印送货单（按收货单位分页）
                  </button>
                </div>
              </div>
              <div className="data-table-wrap task-queue-panel-inner">
                <table className="data-table task-mega-table">
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
              <div className="data-table-wrap task-queue-panel-inner">
                <table className="data-table task-mega-table">
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
          <div className="data-table-wrap task-table-wrap">
            <table className="data-table task-mega-table">
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
                  <h2 className="order-section-title">来料备注</h2>
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

              {detail.items?.[0]?.in_today_queue || detail.items?.[0]?.in_tomorrow_queue ? (
                <>
                  <section className="card order-section">
                    <h2 className="order-section-title">来料信息</h2>
                    <div className="data-table-wrap order-items-wide">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>来料编号</th>
                            <th>材质</th>
                            <th>来料规格</th>
                            <th>来料重</th>
                            <th>个数</th>
                            <th>{FORMED_SIZE_FIELD_LABEL}</th>
                            <th>状态</th>
                            <th style={{ minWidth: '6rem' }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.items ?? []).map((it) => (
                            <tr key={it.id}>
                              <td>{it.incoming_no}</td>
                              <td>{it.material_grade}</td>
                              <td className="text-cell">{it.spec_incoming ?? '—'}</td>
                              <td>{it.weight_incoming ?? '—'}</td>
                              <td>{it.quantity}</td>
                              <td className="text-cell formed-size-stages-cell">
                                <FormedSizeStagesView value={it.formed_size} variant="block" />
                              </td>
                              <td>
                                <span className="tag">{it.production_status}</span>
                              </td>
                              <td className="row-actions">
                                <button
                                  type="button"
                                  className="btn btn-ghost"
                                  onClick={() => openEditItem(it)}
                                >
                                  编辑
                                </button>
                              </td>
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

                  {detail.items?.[0]?.finished_outputs?.length ? (
                    <section className="card order-section">
                      <h2 className="order-section-title">成品明细</h2>
                      <p className="muted" style={{ marginTop: 0 }}>
                        同一来料对应 {detail.items[0].finished_outputs.length}{' '}
                        个成品；送货单按成品一行打印。
                      </p>
                      <FinishedOutputsView
                        outputs={detail.items[0].finished_outputs}
                        variant="table"
                      />
                    </section>
                  ) : null}

                  <section className="card order-section">
                    <h2 className="order-section-title">操作记录</h2>
                    <p className="muted order-section-desc">修磨等环节登记</p>
                    <div className="data-table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>订单号</th>
                            <th>来料编号</th>
                            <th>备注</th>
                          </tr>
                        </thead>
                        <tbody>
                          {grindLogs.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="muted">
                                暂无操作记录
                              </td>
                            </tr>
                          ) : (
                            grindLogs.map((log) => (
                              <tr key={log.id}>
                                <td className="cell-nowrap">{fmtDateTime(log.created_at)}</td>
                                <td>{log.order_no ?? '—'}</td>
                                <td>{log.incoming_no ?? '—'}</td>
                                <td className="text-cell">{log.note ?? '—'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </section>
                </>
              ) : detail.items?.[0] ? (
                <section className="card order-section">
                  <div className="order-detail-unit-head">
                    <h2 className="order-section-title">来料信息（按件）</h2>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => openEditItem(detail.items[0])}
                    >
                      编辑来料
                    </button>
                  </div>
                  <p className="muted order-section-desc">
                    未列入「今日处理」时按个数展开；处理中单件编号持久保留。旧记录未指定件号时挂在第 1 件。
                  </p>
                  {Array.from(
                    { length: Math.max(1, Number(detail.items[0].quantity) || 1) },
                    (_, u) => {
                      const it = detail.items[0]
                      const codes = it.processing_unit_codes
                      const isProc =
                        it.production_status !== '在库中' && it.production_status !== '已发回'
                      const pieceLabel =
                        isProc && Array.isArray(codes) && codes[u]
                          ? codes[u]
                          : `第${u + 1}件`
                      const unitLogs = grindLogsForUnit(grindLogs, u)
                      return (
                        <div key={u} className={'order-unit-expand-card' + (u === 0 ? '' : ' order-unit-expand-follow')}>
                          <h3 className="order-unit-expand-title">件号 {pieceLabel}</h3>
                          <div className="data-table-wrap">
                            <table className="data-table order-unit-meta-table">
                              <tbody>
                                <tr>
                                  <th scope="row">来料编号</th>
                                  <td>{it.incoming_no ?? '—'}</td>
                                  <th scope="row">材质</th>
                                  <td>{it.material_grade ?? '—'}</td>
                                </tr>
                                <tr>
                                  <th scope="row">来料规格</th>
                                  <td colSpan={3} className="text-cell">
                                    {it.spec_incoming ?? '—'}
                                  </td>
                                </tr>
                                <tr>
                                  <th scope="row">状态</th>
                                  <td colSpan={3}>
                                    <span className="tag">{it.production_status}</span>
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                          <h4 className="order-unit-logs-heading">处理记录</h4>
                          <div className="data-table-wrap">
                            <table className="data-table">
                              <thead>
                                <tr>
                                  <th>时间</th>
                                  <th>备注</th>
                                </tr>
                              </thead>
                              <tbody>
                                {unitLogs.length === 0 ? (
                                  <tr>
                                    <td colSpan={2} className="muted">
                                      暂无本条记录
                                    </td>
                                  </tr>
                                ) : (
                                  unitLogs.map((log) => (
                                    <tr key={log.id}>
                                      <td className="cell-nowrap">{fmtDateTime(log.created_at)}</td>
                                      <td className="text-cell">{log.note ?? '—'}</td>
                                    </tr>
                                  ))
                                )}
                              </tbody>
                            </table>
                          </div>
                          {it.production_status === '修磨中' ? (
                            <div className="row-actions order-unit-grind-actions">
                              <button
                                type="button"
                                className="btn btn-primary"
                                onClick={() => {
                                  setGrindItem(it)
                                  setGrindUnitIndex(u)
                                  setGrindNote('')
                                }}
                              >
                                登记修磨（本件）
                              </button>
                            </div>
                          ) : null}
                        </div>
                      )
                    },
                  )}
                </section>
              ) : (
                <section className="card order-section">
                  <p className="muted">暂无来料数据。</p>
                </section>
              )}
            </>
          ) : null}
        </>
      )}

      {splitModalOpen ? (
        <Modal
          open
          wide
          title="拆分订单（今日不处理）"
          onClose={() => setSplitModalOpen(false)}
        >
            <form className="form-grid" onSubmit={submitSplit} onKeyDown={preventModalFormEnterSubmit}>
              <label className="full">
                选择今日处理订单 *
                <select
                  value={splitTargetId}
                  onChange={(e) => {
                    setSplitTargetId(e.target.value)
                    setSplitMoveIdx(new Set())
                  }}
                  required
                >
                  {splitCandidates.length === 0 ? (
                    <option value="">暂无可拆分订单</option>
                  ) : (
                    splitCandidates.map((it) => (
                      <option key={it.id} value={String(it.id)}>
                        {it.order_no} · {it.customer_name} · 件数 {it.quantity}
                      </option>
                    ))
                  )}
                </select>
              </label>
              <fieldset className="full" style={{ border: '1px solid #ddd', borderRadius: 10 }}>
                <legend className="muted" style={{ padding: '0 0.5rem' }}>
                  选择今日不处理的件（至少 1 件，且不能全选）
                </legend>
                {splitUnits.length === 0 ? (
                  <p className="muted" style={{ padding: '0 0.75rem' }}>
                    请选择订单
                  </p>
                ) : (
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                      gap: '0.5rem',
                      padding: '0.5rem 0.75rem 0.75rem',
                    }}
                  >
                    {splitUnits.map((u) => {
                      const checked = splitMoveIdx.has(u.idx)
                      return (
                        <label
                          key={u.idx}
                          style={{
                            display: 'flex',
                            gap: '0.5rem',
                            alignItems: 'center',
                            padding: '0.35rem 0.5rem',
                            borderRadius: 8,
                            border: '1px solid #e5e7eb',
                            background: checked ? '#eef2ff' : '#fff',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSplitMoveIdx((prev) => {
                                const next = new Set(prev)
                                if (next.has(u.idx)) next.delete(u.idx)
                                else next.add(u.idx)
                                return next
                              })
                            }}
                          />
                          <span>{u.label}</span>
                        </label>
                      )
                    })}
                  </div>
                )}
              </fieldset>
              <div className="row-actions full" style={{ justifyContent: 'flex-end' }}>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    splitSubmitting ||
                    !splitTargetId ||
                    splitUnits.length <= 1 ||
                    splitMoveIdx.size === 0 ||
                    splitMoveIdx.size >= splitUnits.length
                  }
                >
                  {splitSubmitting ? '拆分中…' : '确认拆分'}
                </button>
              </div>
              <p className="muted full" style={{ marginTop: '-0.25rem' }}>
                拆分后订单号将变为「原订单号-1」与「原订单号-2」，切头重量会按件数比例分摊；当两单再次处于同一阶段（不晚于等待出库）会自动合并。
              </p>
            </form>
        </Modal>
      ) : null}

      {cutHeadModalOpen ? (
        <Modal open title="新建切头" onClose={() => setCutHeadModalOpen(false)}>
            <form className="form-grid" onSubmit={submitCutHead} onKeyDown={preventModalFormEnterSubmit}>
              <label className="full">
                搜索（订单号/来料编号）
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

      {workOrderModal ? (
        <Modal open wide title="新建来料订单" onClose={() => setWorkOrderModal(false)}>
            <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
              一单一条来料；订单号由服务端按 hj + 该客户的「客户缩写」+ 日期 + 流水 自动生成。
            </p>
            <form
              className="form-grid item-form-grid"
              onSubmit={submitWorkOrder}
              onKeyDown={preventModalFormEnterSubmit}
            >
              <label>
                客户 *
                <select
                  value={newWork.customer_id}
                  onChange={(e) => setNewWork((o) => ({ ...o, customer_id: e.target.value }))}
                  required
                >
                  <option value="">请选择</option>
                  {customers.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                订单备注
                <textarea
                  value={newWork.order_remark}
                  onChange={(e) => setNewWork((o) => ({ ...o, order_remark: e.target.value }))}
                />
              </label>
              <label>
                来料炉号
                <input
                  value={newWork.incoming_no}
                  onChange={(e) => setNewWork((o) => ({ ...o, incoming_no: e.target.value }))}
                />
              </label>
              <label>
                材质
                <input
                  value={newWork.material_grade}
                  onChange={(e) => setNewWork((o) => ({ ...o, material_grade: e.target.value }))}
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
                来料重
                <input
                  value={newWork.weight_incoming}
                  onChange={(e) => setNewWork((o) => ({ ...o, weight_incoming: e.target.value }))}
                />
              </label>
              <label>
                个数
                <input
                  type="number"
                  min={1}
                  value={newWorkFinishedOutputs.length || newWork.quantity}
                  readOnly
                  title="由下方成品明细条数自动汇总"
                />
              </label>
              <label>
                发回重量（合计）
                <input
                  value={
                    sumFinishedOutputWeights(newWorkFinishedOutputs) ??
                    newWork.weight_return
                  }
                  readOnly
                  title="由成品明细发回重量自动合计"
                />
              </label>
              <div className="full">
                <span className="form-field-label">{FORMED_SIZE_FIELD_LABEL}</span>
                <FormedSizeStagesEditor
                  value={newWork.formed_size}
                  onChange={(v) => setNewWork((o) => ({ ...o, formed_size: v }))}
                />
              </div>
              <div className="full">
                <span className="form-field-label">成品明细</span>
                <FinishedOutputsEditor
                  rows={newWorkFinishedOutputs}
                  onChange={setNewWorkFinishedOutputs}
                />
              </div>
              <label className="full">
                锻造要求
                <textarea
                  value={newWork.forging_requirements}
                  onChange={(e) =>
                    setNewWork((o) => ({ ...o, forging_requirements: e.target.value }))
                  }
                />
              </label>
              <label className="full">
                来料备注
                <textarea
                  value={newWork.remark}
                  onChange={(e) => setNewWork((o) => ({ ...o, remark: e.target.value }))}
                />
              </label>
              <label className="full">
                备注配图（保存订单后上传）
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  multiple
                  onChange={(e) => {
                    setNewWorkRemarkFiles((prev) => [...prev, ...Array.from(e.target.files || [])])
                  }}
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
              <label>
                生产状态
                <select
                  value={newWork.production_status}
                  onChange={(e) =>
                    setNewWork((o) => ({ ...o, production_status: e.target.value }))
                  }
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
              <label>
                发回日期
                <input
                  type="date"
                  value={newWork.return_date}
                  onChange={(e) => setNewWork((o) => ({ ...o, return_date: e.target.value }))}
                />
              </label>
              <label>
                下料/锻造时间
                <input
                  type="datetime-local"
                  value={dtLocal(newWork.cutting_time)}
                  onChange={(e) =>
                    setNewWork((o) => ({ ...o, cutting_time: e.target.value }))
                  }
                />
              </label>
              {err ? <p className="err full">{err}</p> : null}
              <div className="form-actions full">
                <button type="submit" className="btn btn-primary">
                  创建
                </button>
              </div>
            </form>
        </Modal>
      ) : null}

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

      {itemModal ? (
        <Modal open wide title="编辑来料" onClose={() => setItemModal(null)}>
            <form
              className="form-grid item-form-grid"
              onSubmit={submitItem}
              onKeyDown={preventModalFormEnterSubmit}
            >
              <label>
                来料编号
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
                个数
                <input
                  type="number"
                  min={1}
                  value={itemFinishedOutputs.length || itemForm.quantity}
                  readOnly
                  title="由成品明细条数自动汇总"
                />
              </label>
              <label>
                发回重量（合计）
                <input
                  value={
                    sumFinishedOutputWeights(itemFinishedOutputs) ?? itemForm.weight_return
                  }
                  readOnly
                />
              </label>
              <div className="full">
                <span className="form-field-label">{FORMED_SIZE_FIELD_LABEL}</span>
                <FormedSizeStagesEditor
                  value={itemForm.formed_size}
                  onChange={(v) => setItemForm((f) => ({ ...f, formed_size: v }))}
                />
              </div>
              <div className="full">
                <span className="form-field-label">成品明细</span>
                <FinishedOutputsEditor
                  rows={itemFinishedOutputs}
                  onChange={setItemFinishedOutputs}
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
                备注
                <textarea
                  value={itemForm.remark}
                  onChange={(e) => setItemForm((f) => ({ ...f, remark: e.target.value }))}
                />
              </label>
              <div className="full" style={{ gridColumn: '1 / -1' }}>
                <label>备注配图</label>
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
                <select
                  value={itemForm.production_status}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, production_status: e.target.value }))
                  }
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
                  value={itemForm.incoming_date}
                  onChange={(e) => setItemForm((f) => ({ ...f, incoming_date: e.target.value }))}
                />
              </label>
              <label>
                发回日期
                <input
                  type="date"
                  value={itemForm.return_date}
                  onChange={(e) => setItemForm((f) => ({ ...f, return_date: e.target.value }))}
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

      {caseModal ? (
        <Modal open wide title="添加生产案例" onClose={() => setCaseModal(null)}>
            <p className="muted">
              明细 {caseModal.it.id} · {caseModal.it.order_no}
              {caseModal.unitLabel ? ` · ${caseModal.unitLabel}` : ''}
            </p>
            <form className="form-grid" onSubmit={submitCaseStudy} onKeyDown={preventModalFormEnterSubmit}>
              <label className="full">
                文字备注
                <textarea
                  value={caseNote}
                  onChange={(e) => setCaseNote(e.target.value)}
                  placeholder="可与图片同时填写；若不上传图片则需填写备注"
                />
              </label>
              <label className="full">
                图片（可多选）
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e) => setCaseFiles(Array.from(e.target.files || []))}
                />
              </label>
              {caseFiles.length > 0 ? (
                <p className="muted full">已选 {caseFiles.length} 个文件</p>
              ) : null}
              {err ? <p className="err full">{err}</p> : null}
              <div className="form-actions full">
                <button type="submit" className="btn btn-primary" disabled={caseSubmitting}>
                  {caseSubmitting ? '提交中…' : '保存'}
                </button>
              </div>
            </form>
        </Modal>
      ) : null}

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
              订单 {grindItem.order_no} · 来料编号 {grindItem.incoming_no ?? '—'}
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
