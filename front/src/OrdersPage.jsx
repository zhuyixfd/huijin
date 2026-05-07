import { useCallback, useEffect, useState } from 'react'
import './Pages.css'
import { deleteReq, getJson, patchJson, postJson } from './api.js'
import { openPrint } from './printSlip.js'

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

function fmtDateTime(iso) {
  if (!iso) return '—'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return String(iso)
  return t.toLocaleString('zh-CN', { hour12: false })
}

const FALLBACK_ORDER_STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'placed', label: '已下单' },
  { value: 'waiting_inbound', label: '待入库' },
  { value: 'in_progress', label: '待完成' },
  { value: 'completed', label: '已完成' },
]

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

export default function OrdersPage() {
  const [customers, setCustomers] = useState([])
  const [orders, setOrders] = useState([])
  const [statuses, setStatuses] = useState([])
  const [q, setQ] = useState('')
  const [cid, setCid] = useState('')
  const [statusCategory, setStatusCategory] = useState('all')
  const [customerNameQ, setCustomerNameQ] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [orderStatusFilters, setOrderStatusFilters] = useState([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState(null)
  const [err, setErr] = useState(null)

  const [orderModal, setOrderModal] = useState(false)
  const [newOrder, setNewOrder] = useState({
    customer_id: '',
    remark: '',
  })

  const [itemModal, setItemModal] = useState(null)
  const [itemForm, setItemForm] = useState(emptyItemForm)

  const [printOpen, setPrintOpen] = useState(null)

  const loadMeta = useCallback(() => {
    getJson('/api/meta/production-statuses').then((d) => setStatuses(d.statuses ?? []))
    getJson('/api/meta/order-status-filters')
      .then((d) => setOrderStatusFilters(d.filters ?? []))
      .catch(() => setOrderStatusFilters(FALLBACK_ORDER_STATUS_FILTERS))
    getJson('/api/customers').then(setCustomers)
  }, [])

  const loadOrders = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (q.trim()) p.set('q', q.trim())
    if (cid) p.set('customer_id', cid)
    if (statusCategory && statusCategory !== 'all') p.set('status_category', statusCategory)
    if (customerNameQ.trim()) p.set('customer_q', customerNameQ.trim())
    if (createdFrom) p.set('created_from', createdFrom)
    if (createdTo) p.set('created_to', createdTo)
    const qs = p.toString()
    getJson(`/api/orders${qs ? `?${qs}` : ''}`)
      .then(setOrders)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [q, cid, statusCategory, customerNameQ, createdFrom, createdTo])

  useEffect(() => {
    queueMicrotask(() => loadMeta())
  }, [loadMeta])

  useEffect(() => {
    queueMicrotask(() => loadOrders())
  }, [loadOrders])

  async function refreshDetail(orderId) {
    const d = await getJson(`/api/orders/${orderId}`)
    setDetail(d)
  }

  async function selectOrder(row) {
    setErr(null)
    try {
      await refreshDetail(row.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载订单失败')
    }
  }

  async function submitNewOrder(e) {
    e.preventDefault()
    setErr(null)
    try {
      const created = await postJson('/api/orders', {
        customer_id: Number(newOrder.customer_id),
        remark: newOrder.remark || null,
        items: [],
      })
      setOrderModal(false)
      setNewOrder({ customer_id: '', remark: '' })
      loadOrders()
      await refreshDetail(created.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '创建失败')
    }
  }

  function openNewItem() {
    if (!detail) return
    setItemForm(emptyItemForm())
    setItemModal({ mode: 'create', orderId: detail.id })
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
    setItemModal({ mode: 'edit', itemId: it.id })
  }

  async function submitItem(e) {
    e.preventDefault()
    if (!detail || !itemModal) return
    setErr(null)
    const payload = normalizeItemPayload(itemForm)
    try {
      if (itemModal.mode === 'create') {
        await postJson(`/api/orders/${detail.id}/items`, payload)
      } else {
        await patchJson(`/api/order-items/${itemModal.itemId}`, payload)
      }
      setItemModal(null)
      await refreshDetail(detail.id)
      loadOrders()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    }
  }

  async function deleteItem(it) {
    if (!detail) return
    if (!window.confirm('删除该条来料明细？')) return
    setErr(null)
    try {
      await deleteReq(`/api/order-items/${it.id}`)
      await refreshDetail(detail.id)
      loadOrders()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败')
    }
  }

  async function deleteOrder() {
    if (!detail) return
    if (!window.confirm(`删除订单 ${detail.order_no} 及其全部明细？`)) return
    setErr(null)
    try {
      await deleteReq(`/api/orders/${detail.id}`)
      setDetail(null)
      loadOrders()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败')
    }
  }

  function dtLocal(val) {
    if (!val) return ''
    const s = String(val)
    if (s.includes('T')) return s.slice(0, 16)
    return s
  }

  return (
    <div className="page-wrap orders-page">
      <header className="dashboard-page-title">
        <h1>订单管理</h1>
        <p className="dashboard-page-desc">
          一个订单对应多条来料锻造任务（一对多）。左侧列表展示聚合进度；右侧维护每条来料的明细与打印。
        </p>
      </header>

      <div className="toolbar orders-toolbar">
        <select
          aria-label="订单状态"
          value={statusCategory}
          onChange={(e) => setStatusCategory(e.target.value)}
        >
          {(orderStatusFilters.length ? orderStatusFilters : FALLBACK_ORDER_STATUS_FILTERS).map(
            (f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ),
          )}
        </select>
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
          title="下单时间起"
          value={createdFrom}
          onChange={(e) => setCreatedFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label="下单时间止"
          title="下单时间止"
          value={createdTo}
          onChange={(e) => setCreatedTo(e.target.value)}
        />
        <input
          type="search"
          placeholder="订单编号"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={() => setOrderModal(true)}>
          新建订单
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}

      <div className="orders-split">
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>订单编号</th>
                <th>客户</th>
                <th>下单时间</th>
                <th>订单状态</th>
                <th>备注</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="muted">
                    加载中…
                  </td>
                </tr>
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    暂无订单
                  </td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr
                    key={o.id}
                    className={`clickable ${detail?.id === o.id ? 'is-active-row' : ''}`}
                    onClick={() => selectOrder(o)}
                  >
                    <td>{o.order_no}</td>
                    <td>{o.customer_name}</td>
                    <td className="cell-nowrap">{fmtDateTime(o.created_at)}</td>
                    <td>
                      <span className="tag tag-status">{o.order_status}</span>
                    </td>
                    <td>{o.remark ?? '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <section className="order-detail card">
          {!detail ? (
            <p className="muted">请选择左侧订单查看明细。</p>
          ) : (
            <>
              <div className="order-detail-head">
                <div>
                  <h2>{detail.order_no}</h2>
                  <p className="muted">
                    客户：{detail.customer?.name} · 下单备注：{detail.remark || '—'}
                  </p>
                </div>
                <div className="row-actions">
                  <button type="button" className="btn btn-primary" onClick={openNewItem}>
                    添加来料明细
                  </button>
                  <button type="button" className="btn btn-danger" onClick={deleteOrder}>
                    删除订单
                  </button>
                </div>
              </div>

              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>生产编号</th>
                      <th>来料编号</th>
                      <th>材质</th>
                      <th>状态</th>
                      <th style={{ minWidth: '12rem' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.items ?? []).map((it) => (
                      <tr key={it.id}>
                        <td>{it.production_no}</td>
                        <td>{it.incoming_no}</td>
                        <td>{it.material_grade}</td>
                        <td>
                          <span className="tag">{it.production_status}</span>
                        </td>
                        <td className="row-actions">
                          <button type="button" className="btn btn-ghost" onClick={() => openEditItem(it)}>
                            编辑
                          </button>
                          <button type="button" className="btn btn-danger" onClick={() => deleteItem(it)}>
                            删除
                          </button>
                          <div className="print-menu">
                            <button
                              type="button"
                              className="btn"
                              onClick={() =>
                                setPrintOpen(printOpen === it.id ? null : it.id)
                              }
                            >
                              打印 ▾
                            </button>
                            {printOpen === it.id ? (
                              <div className="print-menu-list">
                                <button
                                  type="button"
                                  onClick={() => {
                                    openPrint('incoming', {
                                      order: detail,
                                      customer: detail.customer,
                                      item: it,
                                    })
                                    setPrintOpen(null)
                                  }}
                                >
                                  来料单
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    openPrint('production', {
                                      order: detail,
                                      customer: detail.customer,
                                      item: it,
                                    })
                                    setPrintOpen(null)
                                  }}
                                >
                                  生产单
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    openPrint('outbound', {
                                      order: detail,
                                      customer: detail.customer,
                                      item: it,
                                    })
                                    setPrintOpen(null)
                                  }}
                                >
                                  出库单
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    openPrint('return', {
                                      order: detail,
                                      customer: detail.customer,
                                      item: it,
                                    })
                                    setPrintOpen(null)
                                  }}
                                >
                                  发回单
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      {orderModal ? (
        <div className="modal-backdrop" onClick={() => setOrderModal(false)} role="presentation">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
            <h2>新建订单</h2>
            <p className="muted" style={{ marginTop: '-0.5rem', marginBottom: '0.5rem' }}>
              订单编号由系统自动生成（格式：HJ + 日期 + 当日流水号）。
            </p>
            <form className="form-grid" onSubmit={submitNewOrder}>
              <label>
                客户 *
                <select
                  value={newOrder.customer_id}
                  onChange={(e) => setNewOrder((o) => ({ ...o, customer_id: e.target.value }))}
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
              <label>
                订单备注
                <textarea
                  value={newOrder.remark}
                  onChange={(e) => setNewOrder((o) => ({ ...o, remark: e.target.value }))}
                />
              </label>
              {err ? <p className="err">{err}</p> : null}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setOrderModal(false)}>
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
            <h2>{itemModal.mode === 'create' ? '添加来料明细' : '编辑来料明细'}</h2>
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
    </div>
  )
}
