import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import './Pages.css'
import { deleteReq, getJson, patchJson, postFormData, postJson } from './api.js'
import { openPrint } from './printSlip.js'
import { openWorkshopProductionPreview } from './workshopSheetPrint.js'

const emptyItemForm = () => ({
  incoming_no: '',
  material_grade: '',
  production_no: '',
  spec_incoming: '',
  weight_incoming: '',
  quantity: 1,
  weight_return: '',
  formed_size: '',
  forging_requirements: '',
  production_process: '',
  remark: '',
  production_status: '未入库',
  return_date: '',
  incoming_date: '',
  cutting_time: '',
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
    production_no: form.production_no || null,
    spec_incoming: form.spec_incoming || null,
    weight_incoming: form.weight_incoming === '' ? null : String(form.weight_incoming),
    quantity: Number.isFinite(q) && q >= 1 ? q : 1,
    weight_return: form.weight_return === '' ? null : String(form.weight_return),
    formed_size: form.formed_size || null,
    forging_requirements: form.forging_requirements || null,
    production_process: form.production_process || null,
    remark: form.remark || null,
    production_status: form.production_status || '未入库',
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
    default:
      return '全部订单'
  }
}

export default function TasksPage({ tasksPreset = 'all', onTasksMutated, taskNavCounts }) {
  const [customers, setCustomers] = useState([])
  const [statuses, setStatuses] = useState([])

  const [statusFilter, setStatusFilter] = useState('')
  const [statusCategory, setStatusCategory] = useState('all')
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

  const [itemModal, setItemModal] = useState(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)

  const [selectedIds, setSelectedIds] = useState([])
  const [bulkSelectColumnVisible, setBulkSelectColumnVisible] = useState(false)
  const [batchProductionExpanded, setBatchProductionExpanded] = useState(false)
  const [batchTargetStatus, setBatchTargetStatus] = useState('')
  const [batchSubmitting, setBatchSubmitting] = useState(false)
  const [lastBatchUndo, setLastBatchUndo] = useState(null)
  /** 今日处理：同一明细多件折叠后只显示一行（按 order_items.id） */
  const [collapsedTodayItemIds, setCollapsedTodayItemIds] = useState(() => new Set())
  const [todayPanelOpen, setTodayPanelOpen] = useState(true)
  const [restPanelOpen, setRestPanelOpen] = useState(true)
  const [caseModal, setCaseModal] = useState(null)
  const [caseNote, setCaseNote] = useState('')
  const [caseFiles, setCaseFiles] = useState([])
  const [caseSubmitting, setCaseSubmitting] = useState(false)
  const headerSelectRef = useRef(null)

  function toggleTodayItemCollapse(itemId) {
    setCollapsedTodayItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  /* 侧栏切换预设时同步列表筛选参数 */
  /* eslint-disable react-hooks/set-state-in-effect -- 预设来自路由，需同步本地筛选状态 */
  useEffect(() => {
    switch (tasksPreset) {
      case 'all':
        setStatusCategory('all')
        setStatusFilter('')
        break
      case 'pending':
        setStatusCategory('waiting_inbound')
        setStatusFilter('')
        break
      case 'processing':
        setStatusCategory('in_progress')
        setStatusFilter('')
        break
      case 'ready_outbound':
        setStatusCategory('all')
        setStatusFilter('待发回')
        break
      case 'done':
        setStatusCategory('completed')
        setStatusFilter('')
        break
      default:
        break
    }
  }, [tasksPreset])
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    queueMicrotask(() => {
      setBulkSelectColumnVisible(false)
      setBatchProductionExpanded(false)
      setCollapsedTodayItemIds(new Set())
      setTodayPanelOpen(true)
      setRestPanelOpen(true)
    })
  }, [tasksPreset])

  useEffect(() => {
    queueMicrotask(() => setPage(1))
  }, [
    tasksPreset,
    statusFilter,
    statusCategory,
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
    tasksPreset === 'processing' ||
    tasksPreset === 'pending' ||
    tasksPreset === 'ready_outbound'

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
    if (statusCategory && statusCategory !== 'all') p.set('status_category', statusCategory)
    if (customerNameQ.trim()) p.set('customer_q', customerNameQ.trim())
    if (createdFrom) p.set('created_from', createdFrom)
    if (createdTo) p.set('created_to', createdTo)
    if (tasksPreset === 'all') p.set('exclude_completed', 'true')
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
    statusCategory,
    customerNameQ,
    createdFrom,
    createdTo,
    page,
    pageSize,
    tasksPreset,
    onTasksMutated,
  ])

  useEffect(() => {
    queueMicrotask(() => loadMeta())
  }, [loadMeta])

  useEffect(() => {
    queueMicrotask(() => loadTasks())
  }, [loadTasks])

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

  function captureUndoSnapshot(ids) {
    const out = []
    for (const id of ids) {
      const r = rows.find((x) => x.id === id)
      if (r) {
        out.push({
          id,
          production_status: r.production_status,
          in_today_queue: Boolean(r.in_today_queue),
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
    const ids = selectedIds.filter(
      (id) => rows.find((r) => r.id === id)?.production_status === '未入库',
    )
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
      }
      const created = await postJson('/api/tasks/work-orders', payload)
      setWorkOrderModal(false)
      setNewWork(emptyWorkOrderForm())
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
      production_no: it.production_no ?? '',
      spec_incoming: it.spec_incoming ?? '',
      weight_incoming: it.weight_incoming ?? '',
      quantity: it.quantity ?? 1,
      weight_return: it.weight_return ?? '',
      formed_size: it.formed_size ?? '',
      forging_requirements: it.forging_requirements ?? '',
      production_process: it.production_process ?? '',
      remark: it.remark ?? '',
      production_status: it.production_status ?? '未入库',
      return_date: it.return_date ? String(it.return_date).slice(0, 10) : '',
      incoming_date: it.incoming_date ? String(it.incoming_date).slice(0, 10) : '',
      cutting_time: it.cutting_time
        ? String(it.cutting_time).slice(0, 16).replace('T', 'T')
        : '',
    })
    setItemModal({ itemId: it.id })
  }

  async function submitItem(e) {
    e.preventDefault()
    if (!detail || !itemModal) return
    setErr(null)
    const payload = normalizeItemPayload(itemForm)
    try {
      await patchJson(`/api/order-items/${itemModal.itemId}`, payload)
      setItemModal(null)
      await refreshDetail(detail.id)
      loadTasks()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    }
  }

  const showProductionStatusFilter =
    tasksPreset === 'all' || tasksPreset === 'processing'
  const showNewWorkOrder = tasksPreset === 'all' || tasksPreset === 'pending'
  const showBulkSelectCol = showBulkCheckboxCol && bulkSelectColumnVisible
  /** 列表 mega 表列显隐（进入详情改状态；部分预设去掉列减轻干扰） */
  const showTaskActionsCol = !(
    tasksPreset === 'all' ||
    tasksPreset === 'pending' ||
    tasksPreset === 'processing' ||
    tasksPreset === 'ready_outbound' ||
    tasksPreset === 'done'
  )
  const showCuttingReturnDateCols = tasksPreset !== 'pending'
  const showProductionStatusCol =
    tasksPreset !== 'ready_outbound' && tasksPreset !== 'done'
  const showProcessingUnitCol = tasksPreset === 'processing'
  const dataColCount =
    COL_COUNT -
    (showTaskActionsCol ? 0 : 1) -
    (showCuttingReturnDateCols ? 0 : 2) -
    (showProductionStatusCol ? 0 : 1) +
    (showProcessingUnitCol ? 1 : 0)
  const listColSpan = dataColCount + (showBulkSelectCol ? 1 : 0)
  const totalPages = Math.max(1, Math.ceil(listTotal / pageSize))

  const { todayQueueRows, restProcessingRows } = useMemo(() => {
    if (tasksPreset !== 'processing') {
      return { todayQueueRows: [], restProcessingRows: [] }
    }
    const t = []
    const r = []
    for (const row of rows) {
      if (row.in_today_queue) t.push(row)
      else r.push(row)
    }
    return { todayQueueRows: t, restProcessingRows: r }
  }, [rows, tasksPreset])

  async function submitAddToTodayFromProcessing() {
    const restIds = new Set(restProcessingRows.map((r) => r.id))
    const ids = selectedIds.filter((id) => restIds.has(id))
    if (ids.length === 0) return
    setErr(null)
    setBatchSubmitting(true)
    const snap = captureUndoSnapshot(ids)
    try {
      for (const id of ids) {
        await patchJson(`/api/order-items/${id}`, {
          in_today_queue: true,
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

  const todayQueueQtySum = useMemo(
    () => todayQueueRows.reduce((s, r) => s + (Number(r.quantity) || 0), 0),
    [todayQueueRows],
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

  /** 今日处理：按明细 id 分簇（同一订单号即同一行明细的多件） */
  const todayQueueClusters = useMemo(() => {
    const flat = todayQueueExpandedBands
    const clusters = []
    let cur = []
    let curId = null
    for (const row of flat) {
      const id = row.it.id
      if (id !== curId) {
        if (cur.length) clusters.push(cur)
        cur = [row]
        curId = id
      } else {
        cur.push(row)
      }
    }
    if (cur.length) clusters.push(cur)
    return clusters
  }, [todayQueueExpandedBands])

  /** 多件明细：折叠/展开组数（用于标题；折叠行内订单状态不再显示 0/1 式文案） */
  const todayMultiFoldStats = useMemo(() => {
    let multi = 0
    let collapsed = 0
    for (const c of todayQueueClusters) {
      if (c.length <= 1) continue
      multi += 1
      if (collapsedTodayItemIds.has(c[0].it.id)) collapsed += 1
    }
    return { multi, collapsed, expanded: multi - collapsed }
  }, [todayQueueClusters, collapsedTodayItemIds])

  const todayQueueVisibleRowCount = useMemo(() => {
    let n = 0
    for (const cluster of todayQueueClusters) {
      const multi = cluster.length > 1
      const id = cluster[0].it.id
      if (multi && collapsedTodayItemIds.has(id)) n += 1
      else n += cluster.length
    }
    return n
  }, [todayQueueClusters, collapsedTodayItemIds])

  /** 下方「处理中」：单行不展开，仅交替底色 */
  const restProcessingSortedBands = useMemo(() => {
    const sorted = [...restProcessingRows].sort((a, b) => {
      const ao = String(a.order_no ?? '')
      const bo = String(b.order_no ?? '')
      const cmp = ao.localeCompare(bo, 'zh-CN')
      if (cmp !== 0) return cmp
      return a.id - b.id
    })
    let g = 0
    return sorted.map((it, idx) => {
      if (
        idx > 0 &&
        String(sorted[idx - 1].order_no ?? '') !== String(sorted[idx].order_no ?? '')
      ) {
        g += 1
      }
      return { it, orderBand: g % 2 === 0 ? 'a' : 'b' }
    })
  }, [restProcessingRows])

  const showCaseStudyUi = tasksPreset === 'processing'

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

  const renderTaskRow = (it, rowOptions = {}) => {
    const { orderBand, todayExpand } = rowOptions
    const groupSummary = Boolean(todayExpand?.groupSummary)
    const rowExpand = Boolean(todayExpand) && !groupSummary
    const bandClass =
      orderBand === 'a'
        ? 'task-order-group-a'
        : orderBand === 'b'
          ? 'task-order-group-b'
          : ''
    const showChrome = groupSummary || !todayExpand || todayExpand.unitIndex === 0
    const showOrderNoCell =
      groupSummary || !todayExpand || todayExpand.showOrderNo
    const rowKey = groupSummary
      ? `sum-${it.id}`
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
        todayRowToggleExpand ? '单击展开或折叠（多件明细）' : undefined
      }
      onClick={() => {
        if (todayRowToggleExpand) {
          toggleTodayItemCollapse(it.id)
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
      <td className="cell-nowrap">{fmtDateTime(it.order_created_at)}</td>
      <td>
        <span className="tag tag-status">{statusLabel}</span>
      </td>
      <td className="text-cell">{fmtNum(it.order_remark)}</td>
      <td className={GS}>{fmtNum(it.incoming_no)}</td>
      <td>{fmtNum(it.production_no)}</td>
      <td>{fmtNum(it.material_grade)}</td>
      <td className="text-cell">{fmtNum(it.spec_incoming)}</td>
      <td>{fmtNum(it.weight_incoming)}</td>
      <td>{qtyDisplay}</td>
      <td className={GS}>{fmtNum(it.weight_return)}</td>
      <td className="text-cell">{fmtNum(it.formed_size)}</td>
      <td className={`text-cell ${GS}`}>{fmtNum(it.forging_requirements)}</td>
      <td className="text-cell">{fmtNum(it.production_process)}</td>
      <td className="text-cell">{fmtNum(it.remark)}</td>
      <td className={GS}>{fmtDate(it.incoming_date)}</td>
      {showCuttingReturnDateCols ? (
        <td>{fmtCuttingDate(it.cutting_time)}</td>
      ) : null}
      {showCuttingReturnDateCols ? <td>{fmtDate(it.return_date)}</td> : null}
      {showProductionStatusCol ? (
        <td className={GS} onClick={(e) => e.stopPropagation()}>
          {showChrome ? (
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
      {showTaskActionsCol ? (
        <td className={`row-actions cell-actions ${GS}`} onClick={(e) => e.stopPropagation()}>
          {showChrome ? (
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
        {showProcessingUnitCol ? <th className="cell-nowrap">件号</th> : null}
        <th className="cell-nowrap">订单编号</th>
        <th>客户</th>
        <th className="cell-nowrap">下单时间</th>
        <th>订单状态</th>
        <th>订单备注</th>
        <th className={GS}>来料编号</th>
        <th>生产编号</th>
        <th>材质</th>
        <th>来料规格</th>
        <th>来料重量</th>
        <th>个数</th>
        <th className={GS}>发回重量</th>
        <th>成型尺寸</th>
        <th className={GS}>锻造过程要求</th>
        <th>生产过程</th>
        <th>备注</th>
        <th className={GS}>来料日期</th>
        {showCuttingReturnDateCols ? <th>下料日期</th> : null}
        {showCuttingReturnDateCols ? <th>发回日期</th> : null}
        {showProductionStatusCol ? <th className={GS}>生产状态</th> : null}
        {showTaskActionsCol ? <th className={GS}>操作</th> : null}
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
            <select value={cid} onChange={(e) => setCid(e.target.value)}>
              <option value="">全部客户</option>
              {customers.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
                </option>
              ))}
            </select>
            <input
              type="search"
              placeholder="客户名称（模糊）"
              value={customerNameQ}
              onChange={(e) => setCustomerNameQ(e.target.value)}
            />
            <input
              type="date"
              aria-label="下单时间起"
              value={createdFrom}
              onChange={(e) => setCreatedFrom(e.target.value)}
            />
            <input
              type="date"
              aria-label="下单时间止"
              value={createdTo}
              onChange={(e) => setCreatedTo(e.target.value)}
            />
            {showProductionStatusFilter ? (
              <select
                className="select-production-status"
                aria-label="按生产状态筛选"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">全部生产状态</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s === '待发回' ? '待发回（待出库）' : s}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              type="search"
              placeholder="订单号 / 生产编号 / 来料编号"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            {showNewWorkOrder ? (
              <button type="button" className="btn btn-primary" onClick={() => setWorkOrderModal(true)}>
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
                      selectedIds.filter(
                        (id) => rows.find((r) => r.id === id)?.production_status === '未入库',
                      ).length === 0
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={
                      batchSubmitting ||
                      selectedIds.filter((id) =>
                        restProcessingRows.some((r) => r.id === id),
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
                    {s === '待发回' ? '待发回（待出库）' : s}
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
            disabled={loading || page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <button
            type="button"
            className="btn"
            disabled={loading || page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            下一页
          </button>
        </div>
      ) : null}

      {view === 'list' ? (
        loading ? (
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
                      className={`tasks-processing-piece-cell ${count === 0 ? 'is-muted' : ''}`}
                      title={`${letter}：${count}件`}
                    >
                      <span className="tasks-processing-piece-letter">{letter}</span>
                      <span className="tasks-processing-piece-num">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
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
                  今日处理 · {todayQueueRows.length} 条 · 合计 {todayQueueQtySum} 件 · 当前{' '}
                  {todayQueueVisibleRowCount} 行
                  {todayMultiFoldStats.multi > 0 ? (
                    <>
                      {' '}
                      · 多件明细：已展开 {todayMultiFoldStats.expanded} · 已折叠{' '}
                      {todayMultiFoldStats.collapsed}
                    </>
                  ) : null}
                </h3>
                <div className="task-queue-panel-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    disabled={todayQueueRows.length === 0}
                    onClick={() => openWorkshopProductionPreview(todayQueueRows)}
                  >
                    加工生产单预览
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost task-queue-panel-toggle"
                    aria-expanded={todayPanelOpen}
                    onClick={() => setTodayPanelOpen((v) => !v)}
                  >
                    {todayPanelOpen ? '折叠' : '展开'}
                  </button>
                </div>
              </div>
              {todayPanelOpen ? (
              <div className="data-table-wrap task-queue-panel-inner">
                <table className="data-table task-mega-table">
                  {renderMegaThead(true)}
                  <tbody>
                    {todayQueueRows.length === 0 ? (
                      <tr>
                        <td colSpan={listColSpan} className="muted task-queue-empty-hint">
                          暂无；勾选「今日」列可将订单移入本节
                        </td>
                      </tr>
                    ) : (
                      todayQueueClusters.flatMap((cluster) => {
                        const it0 = cluster[0].it
                        const multi = cluster.length > 1
                        const collapsed = multi && collapsedTodayItemIds.has(it0.id)
                        const summaryLabelShort = todayClusterPieceLabelShort(cluster)
                        if (multi && collapsed) {
                          return [
                            renderTaskRow(it0, {
                              orderBand: cluster[0].orderBand,
                              todayExpand: {
                                groupSummary: true,
                                summaryPieceCount: cluster.length,
                                summaryLabelShort,
                                orderStatusOverride: `折叠 · ${cluster.length}件`,
                              },
                            }),
                          ]
                        }
                        return cluster.map((row) =>
                          renderTaskRow(row.it, {
                            orderBand: row.orderBand,
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
              ) : (
                <p className="muted task-panel-collapsed-hint">列表已折叠</p>
              )}
            </div>
            <div
              role="region"
              aria-labelledby="task-queue-rest-heading"
              className="task-queue-panel card"
              style={{ width: '100%', minWidth: 0, flexShrink: 0 }}
            >
              <div className="task-queue-panel-head">
                <h3 id="task-queue-rest-heading" className="task-queue-panel-title">
                  待完成 · {restProcessingRows.length} 条
                </h3>
                <button
                  type="button"
                  className="btn btn-ghost task-queue-panel-toggle"
                  aria-expanded={restPanelOpen}
                  onClick={() => setRestPanelOpen((v) => !v)}
                >
                  {restPanelOpen ? '折叠' : '展开'}
                </button>
              </div>
              {restPanelOpen ? (
              <div className="data-table-wrap task-queue-panel-inner">
                <table className="data-table task-mega-table">
                  {renderMegaThead(false)}
                  <tbody>
                    {restProcessingRows.length === 0 ? (
                      <tr>
                        <td colSpan={listColSpan} className="muted">
                          暂无待完成明细
                        </td>
                      </tr>
                    ) : (
                      restProcessingSortedBands.map(({ it, orderBand }) =>
                        renderTaskRow(it, { orderBand }),
                      )
                    )}
                  </tbody>
                </table>
              </div>
              ) : (
                <p className="muted task-panel-collapsed-hint">列表已折叠</p>
              )}
            </div>
          </div>
          </>
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
                    <button type="button" className="btn btn-danger" onClick={deleteWorkOrder}>
                      删除订单
                    </button>
                  </div>
                </div>
              </section>

              {detail.items?.[0]?.in_today_queue ? (
                <>
                  <section className="card order-section">
                    <h2 className="order-section-title">来料信息</h2>
                    <div className="data-table-wrap order-items-wide">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>生产编号</th>
                            <th>来料编号</th>
                            <th>材质</th>
                            <th>来料规格</th>
                            <th>来料重</th>
                            <th>个数</th>
                            <th>成型尺寸</th>
                            <th>状态</th>
                            <th style={{ minWidth: '6rem' }}>操作</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(detail.items ?? []).map((it) => (
                            <tr key={it.id}>
                              <td>{it.production_no}</td>
                              <td>{it.incoming_no}</td>
                              <td>{it.material_grade}</td>
                              <td className="text-cell">{it.spec_incoming ?? '—'}</td>
                              <td>{it.weight_incoming ?? '—'}</td>
                              <td>{it.quantity}</td>
                              <td className="text-cell">{it.formed_size ?? '—'}</td>
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

                  <section className="card order-section">
                    <h2 className="order-section-title">操作记录</h2>
                    <p className="muted order-section-desc">修磨等环节登记</p>
                    <div className="data-table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>时间</th>
                            <th>生产编号</th>
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
                                <td>{log.production_no ?? '—'}</td>
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
                        it.production_status !== '未入库' && it.production_status !== '已发回'
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
                                  <th scope="row">生产编号</th>
                                  <td>{it.production_no ?? '—'}</td>
                                  <th scope="row">来料编号</th>
                                  <td>{it.incoming_no ?? '—'}</td>
                                </tr>
                                <tr>
                                  <th scope="row">材质</th>
                                  <td>{it.material_grade ?? '—'}</td>
                                  <th scope="row">状态</th>
                                  <td>
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

      {workOrderModal ? (
        <div className="modal-backdrop" onClick={() => setWorkOrderModal(false)} role="presentation">
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()} role="dialog">
            <h2>新建来料订单</h2>
            <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
              一单一条来料；订单号由服务端按 hj + 该客户的「客户缩写」+ 日期 + 流水 自动生成。
            </p>
            <form className="form-grid item-form-grid" onSubmit={submitWorkOrder}>
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
                来料编号
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
                生产编号
                <input
                  value={newWork.production_no}
                  onChange={(e) => setNewWork((o) => ({ ...o, production_no: e.target.value }))}
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
                  value={newWork.quantity}
                  onChange={(e) => setNewWork((o) => ({ ...o, quantity: e.target.value }))}
                />
              </label>
              <label>
                发回重量
                <input
                  value={newWork.weight_return}
                  onChange={(e) => setNewWork((o) => ({ ...o, weight_return: e.target.value }))}
                />
              </label>
              <label>
                成型尺寸
                <input
                  value={newWork.formed_size}
                  onChange={(e) => setNewWork((o) => ({ ...o, formed_size: e.target.value }))}
                />
              </label>
              <label className="full">
                锻造过程要求
                <textarea
                  value={newWork.forging_requirements}
                  onChange={(e) =>
                    setNewWork((o) => ({ ...o, forging_requirements: e.target.value }))
                  }
                />
              </label>
              <label className="full">
                生产过程
                <textarea
                  value={newWork.production_process}
                  onChange={(e) =>
                    setNewWork((o) => ({ ...o, production_process: e.target.value }))
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
                下料时间
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
                <button type="button" className="btn" onClick={() => setWorkOrderModal(false)}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  创建
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {itemModal ? (
        <div className="modal-backdrop" onClick={() => setItemModal(null)} role="presentation">
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()} role="dialog">
            <h2>编辑来料</h2>
            <form className="form-grid item-form-grid" onSubmit={submitItem}>
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
                生产编号
                <input
                  value={itemForm.production_no}
                  onChange={(e) => setItemForm((f) => ({ ...f, production_no: e.target.value }))}
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
                  value={itemForm.quantity}
                  onChange={(e) => setItemForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </label>
              <label>
                发回重量
                <input
                  value={itemForm.weight_return}
                  onChange={(e) => setItemForm((f) => ({ ...f, weight_return: e.target.value }))}
                />
              </label>
              <label>
                成型尺寸
                <input
                  value={itemForm.formed_size}
                  onChange={(e) => setItemForm((f) => ({ ...f, formed_size: e.target.value }))}
                />
              </label>
              <label className="full">
                锻造过程要求
                <textarea
                  value={itemForm.forging_requirements}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, forging_requirements: e.target.value }))
                  }
                />
              </label>
              <label className="full">
                生产过程
                <textarea
                  value={itemForm.production_process}
                  onChange={(e) =>
                    setItemForm((f) => ({ ...f, production_process: e.target.value }))
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
                下料时间
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
                <button type="button" className="btn" onClick={() => setItemModal(null)}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {caseModal ? (
        <div className="modal-backdrop" onClick={() => setCaseModal(null)} role="presentation">
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()} role="dialog">
            <h2>添加生产案例</h2>
            <p className="muted">
              明细 {caseModal.it.id} · {caseModal.it.order_no}
              {caseModal.unitLabel ? ` · ${caseModal.unitLabel}` : ''}
            </p>
            <form className="form-grid" onSubmit={submitCaseStudy}>
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
                <button type="button" className="btn" onClick={() => setCaseModal(null)}>
                  取消
                </button>
                <button type="submit" className="btn btn-primary" disabled={caseSubmitting}>
                  {caseSubmitting ? '提交中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {grindItem ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setGrindItem(null)
            setGrindUnitIndex(null)
          }}
          role="presentation"
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
            <h2>修磨记录</h2>
            <p className="muted">
              订单 {grindItem.order_no} · 生产编号 {grindItem.production_no ?? '—'}
              {grindUnitIndex !== null && grindUnitIndex !== undefined
                ? ` · 第 ${grindUnitIndex + 1} 件`
                : ''}
            </p>
            <form className="form-grid" onSubmit={submitGrind}>
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
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setGrindItem(null)
                    setGrindUnitIndex(null)
                  }}
                >
                  取消
                </button>
                <button type="submit" className="btn btn-primary">
                  保存记录
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  )
}
