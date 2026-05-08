import { useCallback, useEffect, useState } from 'react'
import './Pages.css'
import { deleteReq, getJson, patchJson, postJson } from './api.js'

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
        <div className="modal-backdrop" role="presentation" onClick={() => setModal(null)}>
          <div
            className="modal-card"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>新建客户</h2>
            <form className="form-grid" onSubmit={submitCreate}>
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
              {err ? <p className="err">{err}</p> : null}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setModal(null)}>
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

      {modal?.editId ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setModal(null)}>
          <div
            className="modal-card"
            role="dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>编辑客户</h2>
            <form className="form-grid" onSubmit={submitEdit}>
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
              {err ? <p className="err">{err}</p> : null}
              <div className="form-actions">
                <button type="button" className="btn" onClick={() => setModal(null)}>
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
