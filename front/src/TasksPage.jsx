import { useCallback, useEffect, useState } from 'react'
import './Pages.css'
import { getJson, patchJson, postJson } from './api.js'

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

const GS = 'task-col-group-start'

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
          列顺序：订单与主键 → 来料与规格 → 重量尺寸 → 工艺说明 → 日期 → 状态 →
          操作。竖线为分组示意。
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

      <div className="data-table-wrap task-table-wrap">
        <table className="data-table task-mega-table">
          <thead>
            <tr>
              <th className="cell-nowrap">明细ID</th>
              <th className="cell-nowrap">订单编号</th>
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
              <th>下料日期</th>
              <th>发回日期</th>
              <th className={GS}>生产状态</th>
              <th className={GS}>操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={19} className="muted">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={19} className="muted">
                  暂无任务
                </td>
              </tr>
            ) : (
              rows.map((it) => (
                <tr key={it.id}>
                  <td className="cell-nowrap">{it.id}</td>
                  <td className="cell-nowrap">{it.order_no}</td>
                  <td className="text-cell">{fmtNum(it.order_remark)}</td>
                  <td className={GS}>{fmtNum(it.incoming_no)}</td>
                  <td>{fmtNum(it.production_no)}</td>
                  <td>{fmtNum(it.material_grade)}</td>
                  <td className="text-cell">{fmtNum(it.spec_incoming)}</td>
                  <td>{fmtNum(it.weight_incoming)}</td>
                  <td>{it.quantity}</td>
                  <td className={GS}>{fmtNum(it.weight_return)}</td>
                  <td className="text-cell">{fmtNum(it.formed_size)}</td>
                  <td className={`text-cell ${GS}`}>{fmtNum(it.forging_requirements)}</td>
                  <td className="text-cell">{fmtNum(it.production_process)}</td>
                  <td className="text-cell">{fmtNum(it.remark)}</td>
                  <td className={GS}>{fmtDate(it.incoming_date)}</td>
                  <td>{fmtCuttingDate(it.cutting_time)}</td>
                  <td>{fmtDate(it.return_date)}</td>
                  <td className={GS}>
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
                  <td className={`row-actions cell-actions ${GS}`}>
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
                    ) : null}
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
