import { useCallback, useEffect, useState } from 'react'
import './EmployeeAdmin.css'
import { authFetch, formatApiError } from './auth.js'

export default function EmployeeAdmin() {
  const [users, setUsers] = useState([])
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [listLoading, setListLoading] = useState(true)

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
      const r = await authFetch('/api/users/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(formatApiError(data) || `创建失败 (${r.status})`)
      }
      setUsername('')
      setPassword('')
      loadUsers()
    } catch (err) {
      setError(err instanceof Error ? err.message : '请求失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="employee-admin card">
      <header className="employee-admin-header">
        <h2>帐号管理</h2>
        <p className="employee-admin-desc">添加用户（员工账号），创建后可使用用户名与初始密码登录。</p>
      </header>
      <form className="employee-form" onSubmit={handleCreate}>
        <div className="employee-form-row">
          <label className="employee-label">
            用户名
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
        {error ? <p className="employee-error">{error}</p> : null}
      </form>
      <div className="employee-list-wrap">
        <h3 className="employee-list-title">用户列表</h3>
        {listLoading ? (
          <p className="employee-list-empty">加载中…</p>
        ) : users.length === 0 ? (
          <p className="employee-list-empty">暂无用户</p>
        ) : (
          <ul className="employee-list">
            {users.map((u) => (
              <li key={u.id} className="employee-item">
                <span className="employee-name">{u.username}</span>
                <span className={`employee-badge employee-badge--${u.role}`}>
                  {u.role === 'admin' ? '管理员' : '员工'}
                </span>
                <span className="employee-id">#{u.id}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
