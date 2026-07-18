import { useCallback, useEffect, useState } from 'react'
import './Pages.css'
import { deleteReq, getJson, patchJson, postJson } from './api.js'
import { exportIoDetailExcel } from './exportIoDetailExcel.js'
import Modal from './Modal.jsx'
import { preventModalFormEnterSubmit } from './modalUtils.js'

function currentMonthValue() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  return `${y}-${m}`
}

export default function CustomersPage() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)
  const [form, setForm] = useState({
    name: '',
    abbr: '',
    contact_name: '',
    phone: '',
    address: '',
    remark: '',
  })
  const [err, setErr] = useState(null)
  const [exportModal, setExportModal] = useState(null)
  const [exportMonth, setExportMonth] = useState(currentMonthValue)
  const [exportErr, setExportErr] = useState(null)
  const [exportSubmitting, setExportSubmitting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ''
    getJson(`/api/customers${qs}`)
      .then(setRows)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false))
  }, [q])

  useEffect(() => {
    queueMicrotask(() => load())
  }, [load])

  function openCreate() {
    setErr(null)
    setForm({
      name: '',
      abbr: '',
      contact_name: '',
      phone: '',
      address: '',
      remark: '',
    })
    setModal('create')
  }

  function openEdit(row) {
    setErr(null)
    setForm({
      name: row.name,
      abbr: row.abbr ?? '',
      contact_name: row.contact_name ?? '',
      phone: row.phone ?? '',
      address: row.address ?? '',
      remark: row.remark ?? '',
    })
    setModal({ editId: row.id })
  }

  function openMonthlyExport(row) {
    setExportErr(null)
    setExportMonth(currentMonthValue())
    setExportModal({ id: row.id, name: row.name })
  }

  async function submitMonthlyExport(e) {
    e.preventDefault()
    if (!exportModal) return
    setExportErr(null)
    const m = String(exportMonth ?? '').trim()
    const match = m.match(/^(\d{4})-(\d{2})$/)
    if (!match) {
      setExportErr('请选择有效月份')
      return
    }
    const year = Number(match[1])
    const month = Number(match[2])
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      setExportErr('请选择有效月份')
      return
    }
    setExportSubmitting(true)
    try {
      const resp = await getJson(
        `/api/customers/${exportModal.id}/monthly-io-items?year=${year}&month=${month}`,
      )
      const items = Array.isArray(resp?.items) ? resp.items : []
      if (items.length === 0) {
        setExportErr('该月暂无出入明细')
        return
      }
      const ym = `${year}${String(month).padStart(2, '0')}`
      exportIoDetailExcel({
        customerName: exportModal.name,
        items,
        fileName: `${exportModal.name}-出入明细-${ym}.xls`,
        headerYear: year,
      })
      setExportModal(null)
    } catch (ex) {
      setExportErr(ex instanceof Error ? ex.message : '导出失败')
    } finally {
      setExportSubmitting(false)
    }
  }

  async function submitCreate(e) {
    e.preventDefault()
    setErr(null)
    try {
      await postJson('/api/customers', {
        name: form.name.trim(),
        abbr: form.abbr.trim(),
        contact_name: form.contact_name || null,
        phone: form.phone || null,
        address: form.address || null,
        remark: form.remark || null,
      })
      setModal(null)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    }
  }

  async function submitEdit(e) {
    e.preventDefault()
    setErr(null)
    try {
      await patchJson(`/api/customers/${modal.editId}`, {
        name: form.name.trim(),
        abbr: form.abbr.trim(),
        contact_name: form.contact_name || null,
        phone: form.phone || null,
        address: form.address || null,
        remark: form.remark || null,
      })
      setModal(null)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '保存失败')
    }
  }

  async function remove(row) {
    if (!window.confirm(`删除客户「${row.name}」？`)) return
    setErr(null)
    try {
      await deleteReq(`/api/customers/${row.id}`)
      load()
    } catch (e) {
      setErr(e instanceof Error ? e.message : '删除失败')
    }
  }

  return (
    <div className="page-wrap">
      <header className="dashboard-page-title">
        <h1>客户管理</h1>
      </header>
      <div className="toolbar">
        <input
          type="search"
          placeholder="搜索客户名称"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button type="button" className="btn btn-primary" onClick={openCreate}>
          新建客户
        </button>
      </div>
      {err ? <p className="err">{err}</p> : null}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>名称</th>
              <th className="cell-nowrap">客户缩写</th>
              <th>联系人</th>
              <th>电话</th>
              <th>地址</th>
              <th>备注</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="muted">
                  加载中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="muted">
                  暂无客户
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.name}</td>
                  <td className="cell-mono">{r.abbr}</td>
                  <td>{r.contact_name}</td>
                  <td>{r.phone}</td>
                  <td>{r.address}</td>
                  <td>{r.remark}</td>
                  <td className="row-actions">
                    <button type="button" className="btn btn-ghost" onClick={() => openMonthlyExport(r)}>
                      按月导出
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => openEdit(r)}>
                      编辑
                    </button>
                    <button type="button" className="btn btn-danger" onClick={() => remove(r)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modal === 'create' ? (
        <Modal open title="新建客户" onClose={() => setModal(null)}>
            <form className="form-grid" onSubmit={submitCreate} onKeyDown={preventModalFormEnterSubmit}>
              <label>
                客户名称 *
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                客户缩写 *（订单号用，全库唯一，字母或数字）
                <input
                  value={form.abbr}
                  onChange={(e) => setForm((f) => ({ ...f, abbr: e.target.value }))}
                  required
                  maxLength={32}
                  autoComplete="off"
                  placeholder="如 ABC"
                />
              </label>
              <label>
                联系人
                <input
                  value={form.contact_name}
                  onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                />
              </label>
              <label>
                电话
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
              <label>
                地址
                <input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </label>
              <label>
                备注
                <textarea
                  value={form.remark}
                  onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                />
              </label>
              {err ? <p className="err full">{err}</p> : null}
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
            </form>
        </Modal>
      ) : null}

      {modal?.editId ? (
        <Modal open title="编辑客户" onClose={() => setModal(null)}>
            <form className="form-grid" onSubmit={submitEdit} onKeyDown={preventModalFormEnterSubmit}>
              <label>
                客户名称 *
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                客户缩写 *（订单号用，全库唯一）
                <input
                  value={form.abbr}
                  onChange={(e) => setForm((f) => ({ ...f, abbr: e.target.value }))}
                  required
                  maxLength={32}
                  autoComplete="off"
                />
              </label>
              <label>
                联系人
                <input
                  value={form.contact_name}
                  onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                />
              </label>
              <label>
                电话
                <input
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </label>
              <label>
                地址
                <input
                  value={form.address}
                  onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                />
              </label>
              <label>
                备注
                <textarea
                  value={form.remark}
                  onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
                />
              </label>
              {err ? <p className="err full">{err}</p> : null}
              <div className="form-actions">
                <button type="submit" className="btn btn-primary">
                  保存
                </button>
              </div>
            </form>
        </Modal>
      ) : null}

      {exportModal ? (
        <Modal
          open
          title={`按月导出出入明细 · ${exportModal.name}`}
          onClose={() => {
            if (exportSubmitting) return
            setExportModal(null)
          }}
        >
          <form className="form-grid" onSubmit={submitMonthlyExport} onKeyDown={preventModalFormEnterSubmit}>
            <p className="muted full" style={{ marginTop: '-0.25rem' }}>
              导出该客户「来料日期」或「送回日期」落在所选月份的明细（格式与处理中数据导出一致）。
            </p>
            <label>
              月份
              <input
                type="month"
                value={exportMonth}
                onChange={(e) => setExportMonth(e.target.value)}
                required
              />
            </label>
            {exportErr ? <p className="err full">{exportErr}</p> : null}
            <div className="form-actions full">
              <button type="submit" className="btn btn-primary" disabled={exportSubmitting}>
                {exportSubmitting ? '导出中…' : '导出'}
              </button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  )
}
