import { useCallback, useEffect, useState } from 'react'
import './Pages.css'
import { getJson, patchJson, postJson } from './api.js'

export default function TasksPage() {
  const [statuses, setStatuses] = useState([])
  const [statusFilter, setStatusFilter] = useState('')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const [grindItem, setGrindItem] = useState(null)
  const [grindNote, setGrindNote] = useState('')

  const loadMeta = useCallback(() => {
    getJson('/api/meta/production-statuses').then((d) => setStatuses(d.statuses ?? []))
  }, [])

  const loadTasks = useCallback(() => {
    setLoading(true)
    const p = new URLSearchParams()
    if (statusFilter) p.set('status', statusFilter)
    if (q.trim()) p.set('q', q.trim())
    const qs = p.toString()
    getJson(`/api/tasks/items${qs ? `?${qs}` : ''}`)
      .then(setRows)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [statusFilter, q])

  useEffect(() => {
    queueMicrotask(() => loadMeta())
  }, [loadMeta])

  useEffect(() => {
    queueMicrotask(() => loadTasks())
  }, [loadTasks])

  async function patchStatus(it, status) {
    setErr(null)
    try {
      await patchJson(`/api/order-items/${it.id}`, { production_status: status })
      loadTasks()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '更新失败')
    }
  }

  async function submitGrind(e) {
    e.preventDefault()
    if (!grindItem) return
    setErr(null)
    try {
      await postJson(`/api/order-items/${grindItem.id}/grind-logs`, {
        note: grindNote || null,
      })
      setGrindItem(null)
      setGrindNote('')
      loadTasks()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '记录失败')
    }
  }

  return (
    <div className="page-wrap">
      <header className="dashboard-page-title">
        <h1>任务管理</h1>
        <p className="dashboard-page-desc">
          按生产状态跟踪每条来料明细；「修磨中」可多次记录修磨（日志）。
        </p>
      </header>

      <div className="toolbar">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">全部状态</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="search"
          placeholder="订单号 / 生产编号 / 来料编号"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      {err ? <p className="err">{err}</p> : null}

      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>订单号</th>
              <th>客户</th>
              <th>生产编号</th>
              <th>来料编号</th>
              <th>材质</th>
              <th>状态</th>
              <th>快速流转</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="muted">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  暂无任务
                </td>
              </tr>
            ) : (
              rows.map((it) => (
                <tr key={it.id}>
                  <td>{it.order_no}</td>
                  <td>{it.customer_name}</td>
                  <td>{it.production_no}</td>
                  <td>{it.incoming_no}</td>
                  <td>{it.material_grade}</td>
                  <td>
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
                  </td>
                  <td className="row-actions">
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => patchStatus(it, '锻造中')}
                    >
                      →锻造
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => patchStatus(it, '待发回')}
                    >
                      →待发回
                    </button>
                  </td>
                  <td>
                    {it.production_status === '修磨中' ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          setGrindItem(it)
                          setGrindNote('')
                        }}
                      >
                        修磨记录
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {grindItem ? (
        <div className="modal-backdrop" onClick={() => setGrindItem(null)} role="presentation">
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
            <h2>修磨记录</h2>
            <p className="muted">
              订单 {grindItem.order_no} · 生产编号 {grindItem.production_no ?? '—'}
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
                <button type="button" className="btn" onClick={() => setGrindItem(null)}>
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
