import { useCallback, useEffect, useState } from 'react'
import './EmployeeAdmin.css'
import './Pages.css'
import { patchJson } from './api.js'
import { authFetch, formatApiError } from './auth.js'
import { PERM_OPTIONS } from './permissions.js'

function fmtDateTime(iso) {
  if (!iso) return '—'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return String(iso)
  return t.toLocaleString('zh-CN', { hour12: false })
}

export default function EmployeeAdmin() {
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)

  const [pwdTarget, setPwdTarget] = useState(null)
  const [newPwd, setNewPwd] = useState('')
  const [pwdErr, setPwdErr] = useState(null)
  const [pwdLoading, setPwdLoading] = useState(false)

  const [permTarget, setPermTarget] = useState(null)
  const [permDraft, setPermDraft] = useState(() => new Set())
  const [permErr, setPermErr] = useState(null)
  const [permLoading, setPermLoading] = useState(false)

  const [createPermSet, setCreatePermSet] = useState(
    () => new Set(PERM_OPTIONS.map(([code]) => code)),
  )

  const loadUsers = useCallback(() => {
    setListLoading(true)
    authFetch('/api/users')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(setUsers)
      .catch(() => setUsers([]))
      .finally(() => setListLoading(false))
  }, [])

  useEffect(() => {
    queueMicrotask(() => loadUsers())
  }, [loadUsers])

  async function handleCreate(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const body = {
        username,
        password,
        display_name: displayName.trim() || null,
        permission_codes: [...createPermSet],
      }
      const r = await authFetch('/api/users/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(formatApiError(data) || `创建失败 (${r.status})`)
      }
      setUsername('')
      setDisplayName('')
      setPassword('')
      setCreatePermSet(new Set(PERM_OPTIONS.map(([c]) => c)))
      loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败')
    } finally {
      setLoading(false)
    }
  }

  async function submitPwd(e) {
    e.preventDefault()
    if (!pwdTarget) return
    setPwdErr(null)
    setPwdLoading(true)
    try {
      await patchJson(`/api/users/${pwdTarget.id}/password`, { password: newPwd })
      setPwdTarget(null)
      setNewPwd('')
      loadUsers()
    } catch (err) {
      setPwdErr(err instanceof Error ? err.message : '修改失败')
    } finally {
      setPwdLoading(false)
    }
  }

  async function submitPerm(e) {
    e.preventDefault()
    if (!permTarget) return
    setPermErr(null)
    setPermLoading(true)
    try {
      await patchJson(`/api/users/${permTarget.id}/permissions`, {
        permission_codes: [...permDraft],
      })
      setPermTarget(null)
      loadUsers()
    } catch (err) {
      setPermErr(err instanceof Error ? err.message : '保存失败')
    } finally {
      setPermLoading(false)
    }
  }

  function togglePermDraft(code) {
    setPermDraft((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  function toggleCreatePerm(code) {
    setCreatePermSet((prev) => {
      const next = new Set(prev)
      if (next.has(code)) next.delete(code)
      else next.add(code)
      return next
    })
  }

  return (
    <section className="employee-admin card">
      <header className="employee-admin-header">
        <h2>帐号管理</h2>
      </header>
      <form className="employee-form" onSubmit={handleCreate}>
        <div className="employee-form-row">
          <label className="employee-label">
            帐号
            <input
              className="employee-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
              autoComplete="off"
            />
          </label>
          <label className="employee-label">
            员工名字
            <input
              className="employee-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="可选"
              autoComplete="off"
            />
          </label>
          <label className="employee-label">
            初始密码
            <input
              className="employee-input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete="new-password"
            />
          </label>
          <button className="employee-submit" type="submit" disabled={loading}>
            {loading ? '提交中…' : '添加用户'}
          </button>
        </div>
        <div className="employee-form-row" style={{ marginTop: '0.35rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <span style={{ width: '100%', fontSize: '0.9rem', color: '#555' }}>业务权限（新账号）</span>
          {PERM_OPTIONS.map(([code, label]) => (
            <label key={code} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <input
                type="checkbox"
                checked={createPermSet.has(code)}
                onChange={() => toggleCreatePerm(code)}
              />
              {label}
            </label>
          ))}
        </div>
        {error ? <p className="employee-error">{error}</p> : null}
      </form>
      <div className="employee-list-wrap">
        <h3 className="employee-list-title">帐号列表</h3>
        <div className="data-table-wrap account-table-wrap">
          <table className="data-table account-table">
            <thead>
              <tr>
                <th>帐号</th>
                <th>员工名字</th>
                <th>创建时间</th>
                <th>最后一次登录时间</th>
                <th>密码</th>
                <th>权限</th>
                <th style={{ minWidth: '10rem' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {listLoading ? (
                <tr>
                  <td colSpan={7} className="muted">
                    加载中…
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    暂无用户
                  </td>
                </tr>
              ) : (
                users.map((u) => (
                  <tr key={u.id}>
                    <td className="cell-nowrap">{u.username}</td>
                    <td>{u.display_name || '—'}</td>
                    <td className="cell-nowrap">{fmtDateTime(u.created_at)}</td>
                    <td className="cell-nowrap">{fmtDateTime(u.last_login_at)}</td>
                    <td className="cell-mono">{u.password ?? '******'}</td>
                    <td className="text-cell muted">
                      {u.permission_codes == null
                        ? '全部（未单独配置）'
                        : !Array.isArray(u.permission_codes)
                          ? '—'
                          : u.permission_codes.length === 0
                            ? '无业务权限'
                            : u.permission_codes
                                .map(
                                  (c) => PERM_OPTIONS.find(([x]) => x === c)?.[1] ?? c,
                                )
                                .join('、')}
                    </td>
                    <td>
                      {u.role === 'employee' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setPermTarget(u)
                              const raw = u.permission_codes
                              setPermDraft(
                                new Set(
                                  Array.isArray(raw)
                                    ? raw
                                    : PERM_OPTIONS.map(([c]) => c),
                                ),
                              )
                              setPermErr(null)
                            }}
                          >
                            权限
                          </button>
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => {
                              setPwdTarget(u)
                              setNewPwd('')
                              setPwdErr(null)
                            }}
                          >
                            改密码
                          </button>
                        </div>
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
      </div>

      {pwdTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => setPwdTarget(null)}
          role="presentation"
        >
          <div className="modal-card" onClick={(e) => e.stopPropagation()} role="dialog">
            <h3 style={{ marginTop: 0 }}>修改密码 · {pwdTarget.username}</h3>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              为员工设置新的登录密码（至少 6 位）。
            </p>
            <form className="form-grid" onSubmit={submitPwd}>
              <label>
                新密码
                <input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  autoFocus
                />
              </label>
              {pwdErr ? <p className="err">{pwdErr}</p> : null}
              <div className="form-actions" style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn btn-primary" disabled={pwdLoading}>
                  {pwdLoading ? '保存中…' : '保存'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPwdTarget(null)}
                  disabled={pwdLoading}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {permTarget ? (
        <div
          className="modal-backdrop"
          onClick={() => !permLoading && setPermTarget(null)}
          role="presentation"
        >
          <div
            className="modal-card wide"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <h3 style={{ marginTop: 0 }}>业务权限 · {permTarget.username}</h3>
            <p className="muted" style={{ marginBottom: '1rem' }}>
              未在数据库中单独配置过权限的帐号，仍视为拥有全部四项权限。保存后将以当前勾选为准；若全部不勾选并保存，该帐号将不能进行任何订单相关操作。
            </p>
            <form className="form-grid" onSubmit={submitPerm}>
              {PERM_OPTIONS.map(([code, label]) => (
                <label
                  key={code}
                  className="full"
                  style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}
                >
                  <input
                    type="checkbox"
                    checked={permDraft.has(code)}
                    onChange={() => togglePermDraft(code)}
                  />
                  {label}
                </label>
              ))}
              {permErr ? <p className="err full">{permErr}</p> : null}
              <div className="form-actions full" style={{ display: 'flex', gap: '0.5rem' }}>
                <button type="submit" className="btn btn-primary" disabled={permLoading}>
                  {permLoading ? '保存中…' : '保存'}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setPermTarget(null)}
                  disabled={permLoading}
                >
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  )
}
