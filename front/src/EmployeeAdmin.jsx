import { useCallback, useEffect, useState } from 'react'
import './EmployeeAdmin.css'
import './Pages.css'
import { getJson, patchJson, postJson } from './api.js'
import { authFetch, formatApiError } from './auth.js'
import { fmtDateTime } from './datetime.js'
import Modal from './Modal.jsx'
import { preventModalFormEnterSubmit } from './modalUtils.js'
import { PERM_OPTIONS } from './permissions.js'

function fmtSize(n) {
  const x = Number(n)
  if (!Number.isFinite(x) || x < 0) return '—'
  if (x < 1024) return `${x} B`
  if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`
  return `${(x / 1024 / 1024).toFixed(2)} MB`
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

  const [backupStatus, setBackupStatus] = useState(null)
  const [backupLoading, setBackupLoading] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [backupMsg, setBackupMsg] = useState(null)
  const [backupErr, setBackupErr] = useState(null)

  const [auditItems, setAuditItems] = useState([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [auditPage, setAuditPage] = useState(1)
  const [auditLoading, setAuditLoading] = useState(false)
  const [auditErr, setAuditErr] = useState(null)
  const [auditFilterUser, setAuditFilterUser] = useState('')
  const [auditFilterAction, setAuditFilterAction] = useState('')
  const [auditDetail, setAuditDetail] = useState(null)

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

  const loadBackupStatus = useCallback(() => {
    setBackupLoading(true)
    setBackupErr(null)
    getJson('/api/backups/status')
      .then(setBackupStatus)
      .catch((e) => {
        setBackupStatus(null)
        setBackupErr(e instanceof Error ? e.message : '加载备份信息失败')
      })
      .finally(() => setBackupLoading(false))
  }, [])

  const loadAuditLogs = useCallback((page = 1) => {
    setAuditLoading(true)
    setAuditErr(null)
    const qs = new URLSearchParams({
      page: String(page),
      page_size: '50',
    })
    if (auditFilterUser.trim()) qs.set('username', auditFilterUser.trim())
    if (auditFilterAction.trim()) qs.set('action', auditFilterAction.trim())
    getJson(`/api/audit-logs?${qs}`)
      .then((data) => {
        setAuditItems(data.items || [])
        setAuditTotal(Number(data.total) || 0)
        setAuditPage(Number(data.page) || page)
      })
      .catch((e) => {
        setAuditItems([])
        setAuditTotal(0)
        setAuditErr(e instanceof Error ? e.message : '加载操作日志失败')
      })
      .finally(() => setAuditLoading(false))
  }, [auditFilterUser, auditFilterAction])

  useEffect(() => {
    queueMicrotask(() => {
      loadUsers()
      loadBackupStatus()
      loadAuditLogs(1)
    })
  }, [loadUsers, loadBackupStatus, loadAuditLogs])

  async function runBackupNow() {
    setBackupErr(null)
    setBackupMsg(null)
    setBackupBusy(true)
    try {
      const info = await postJson('/api/backups/run', {})
      setBackupMsg(`备份完成：${info.label || info.filename}`)
      await loadBackupStatus()
    } catch (e) {
      setBackupErr(e instanceof Error ? e.message : '备份失败')
    } finally {
      setBackupBusy(false)
    }
  }

  async function restorePreviousEvening() {
    const prev = backupStatus?.previous_evening
    const tip = prev
      ? `确定恢复到「${prev.label}」？\n当前数据库会被覆盖，恢复后请刷新页面。`
      : '确定恢复到头一天晚上 20:00 的备份？\n当前数据库会被覆盖，恢复后请刷新页面。'
    if (!window.confirm(tip)) return
    setBackupErr(null)
    setBackupMsg(null)
    setBackupBusy(true)
    try {
      const resp = await postJson('/api/backups/restore-previous-evening', {})
      setBackupMsg(resp?.message || '恢复完成')
      window.alert(`${resp?.message || '恢复完成'}\n请刷新页面。`)
      await loadBackupStatus()
    } catch (e) {
      setBackupErr(e instanceof Error ? e.message : '恢复失败')
    } finally {
      setBackupBusy(false)
    }
  }

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

      <div className="employee-list-wrap" style={{ marginTop: '2rem' }}>
        <h3 className="employee-list-title">数据备份</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          系统每天晚上 20:00 自动备份数据库。可将数据恢复到「头一天晚上 20:00」那一份（会覆盖当前库）。
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.75rem' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={backupBusy || backupLoading}
            onClick={runBackupNow}
          >
            {backupBusy ? '处理中…' : '立即备份'}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={backupBusy || backupLoading || !backupStatus?.previous_evening}
            onClick={restorePreviousEvening}
          >
            恢复到头一天晚上 20:00
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={backupBusy || backupLoading}
            onClick={loadBackupStatus}
          >
            刷新
          </button>
        </div>
        {backupStatus?.previous_evening ? (
          <p className="muted" style={{ marginTop: 0 }}>
            可恢复目标：{backupStatus.previous_evening.label}
            （{fmtSize(backupStatus.previous_evening.size_bytes)}）
          </p>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            暂无「头一天晚上 20:00」备份（需至少跑过一次晚间定时备份）。
          </p>
        )}
        {backupMsg ? <p style={{ color: 'var(--ok, #0a7)' }}>{backupMsg}</p> : null}
        {backupErr ? <p className="err">{backupErr}</p> : null}
        <div className="data-table-wrap account-table-wrap">
          <table className="data-table account-table">
            <thead>
              <tr>
                <th>备份</th>
                <th>时间</th>
                <th>大小</th>
                <th>类型</th>
              </tr>
            </thead>
            <tbody>
              {backupLoading ? (
                <tr>
                  <td colSpan={4} className="muted">
                    加载中…
                  </td>
                </tr>
              ) : !backupStatus?.backups?.length ? (
                <tr>
                  <td colSpan={4} className="muted">
                    暂无备份文件
                  </td>
                </tr>
              ) : (
                backupStatus.backups.map((b) => (
                  <tr key={b.filename}>
                    <td className="cell-mono">{b.filename}</td>
                    <td className="cell-nowrap">{fmtDateTime(b.created_at)}</td>
                    <td className="cell-nowrap">{fmtSize(b.size_bytes)}</td>
                    <td>{b.is_evening ? '晚 20:00 定时' : '手动'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="employee-list-wrap" style={{ marginTop: '2rem' }}>
        <h3 className="employee-list-title">操作日志</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          记录写操作（登录、改状态、件号重排、备份恢复等）：时间、操作人、IP、操作内容。保留约 90 天。
        </p>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginBottom: '0.75rem',
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            placeholder="用户名"
            value={auditFilterUser}
            onChange={(e) => setAuditFilterUser(e.target.value)}
            style={{ width: '7rem' }}
          />
          <input
            type="text"
            placeholder="操作（如：件号重排）"
            value={auditFilterAction}
            onChange={(e) => setAuditFilterAction(e.target.value)}
            style={{ width: '10rem' }}
          />
          <button
            type="button"
            className="btn btn-primary"
            disabled={auditLoading}
            onClick={() => loadAuditLogs(1)}
          >
            查询
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={auditLoading}
            onClick={() => loadAuditLogs(auditPage)}
          >
            刷新
          </button>
          <span className="muted" style={{ fontSize: '0.86rem' }}>
            共 {auditTotal} 条
          </span>
        </div>
        {auditErr ? <p className="err">{auditErr}</p> : null}
        <div className="data-table-wrap account-table-wrap">
          <table className="data-table account-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>操作人</th>
                <th>IP</th>
                <th>操作</th>
                <th>结果</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {auditLoading ? (
                <tr>
                  <td colSpan={6} className="muted">
                    加载中…
                  </td>
                </tr>
              ) : !auditItems.length ? (
                <tr>
                  <td colSpan={6} className="muted">
                    暂无日志（部署并重启后端后开始记录）
                  </td>
                </tr>
              ) : (
                auditItems.map((row) => (
                  <tr key={row.id}>
                    <td className="cell-nowrap">{fmtDateTime(row.created_at)}</td>
                    <td>
                      {row.display_name || row.username || '—'}
                      {row.username && row.display_name ? (
                        <span className="muted"> ({row.username})</span>
                      ) : null}
                    </td>
                    <td className="cell-mono cell-nowrap">{row.ip || '—'}</td>
                    <td>{row.action}</td>
                    <td className="cell-nowrap">{row.status_code ?? '—'}</td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ padding: '0.15rem 0.4rem', fontSize: '0.85rem' }}
                        onClick={() => setAuditDetail(row)}
                      >
                        详情
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {auditTotal > 50 ? (
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.75rem' }}>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={auditLoading || auditPage <= 1}
              onClick={() => loadAuditLogs(auditPage - 1)}
            >
              上一页
            </button>
            <span className="muted" style={{ alignSelf: 'center' }}>
              第 {auditPage} / {Math.max(1, Math.ceil(auditTotal / 50))} 页
            </span>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={auditLoading || auditPage * 50 >= auditTotal}
              onClick={() => loadAuditLogs(auditPage + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}
      </div>

      {auditDetail ? (
        <Modal open title={`操作详情 #${auditDetail.id}`} titleAs="h3" onClose={() => setAuditDetail(null)}>
          <dl className="form-grid" style={{ margin: 0 }}>
            <div>
              <dt className="muted">时间</dt>
              <dd>{fmtDateTime(auditDetail.created_at)}</dd>
            </div>
            <div>
              <dt className="muted">操作人</dt>
              <dd>
                {auditDetail.display_name || auditDetail.username || '—'}
                {auditDetail.user_id != null ? ` · id=${auditDetail.user_id}` : ''}
              </dd>
            </div>
            <div>
              <dt className="muted">IP</dt>
              <dd className="cell-mono">{auditDetail.ip || '—'}</dd>
            </div>
            <div className="full">
              <dt className="muted">浏览器 / 设备（User-Agent）</dt>
              <dd style={{ wordBreak: 'break-all', fontSize: '0.85rem' }}>
                {auditDetail.user_agent || '—'}
              </dd>
            </div>
            <div>
              <dt className="muted">操作</dt>
              <dd>{auditDetail.action}</dd>
            </div>
            <div className="full">
              <dt className="muted">请求</dt>
              <dd className="cell-mono">
                {auditDetail.method} {auditDetail.path}
                {auditDetail.query_string ? `?${auditDetail.query_string}` : ''}
              </dd>
            </div>
            <div>
              <dt className="muted">状态码 / 耗时</dt>
              <dd>
                {auditDetail.status_code ?? '—'} / {auditDetail.duration_ms ?? '—'} ms
              </dd>
            </div>
            <div className="full">
              <dt className="muted">请求内容</dt>
              <dd>
                <pre
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    maxHeight: '16rem',
                    overflow: 'auto',
                    margin: 0,
                    fontSize: '0.85rem',
                  }}
                >
                  {auditDetail.request_body || '—'}
                </pre>
              </dd>
            </div>
          </dl>
        </Modal>
      ) : null}

      {pwdTarget ? (
        <Modal
          open
          title={`修改密码 · ${pwdTarget.username}`}
          titleAs="h3"
          onClose={() => setPwdTarget(null)}
        >
            <p className="muted" style={{ marginBottom: '1rem' }}>
              为员工设置新的登录密码（至少 6 位）。
            </p>
            <form className="form-grid" onSubmit={submitPwd} onKeyDown={preventModalFormEnterSubmit}>
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
              </div>
            </form>
        </Modal>
      ) : null}

      {permTarget ? (
        <Modal
          open
          wide
          title={`业务权限 · ${permTarget.username}`}
          titleAs="h3"
          onClose={() => !permLoading && setPermTarget(null)}
        >
            <p className="muted" style={{ marginBottom: '1rem' }}>
              未在数据库中单独配置过权限的帐号，仍视为拥有全部四项权限。保存后将以当前勾选为准；若全部不勾选并保存，该帐号将不能进行任何订单相关操作。
            </p>
            <form className="form-grid" onSubmit={submitPerm} onKeyDown={preventModalFormEnterSubmit}>
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
              </div>
            </form>
        </Modal>
      ) : null}
    </section>
  )
}
