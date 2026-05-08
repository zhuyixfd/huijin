import './DashboardShell.css'

const NAV = [
  { key: 'home', label: '首页' },
  { key: 'customers', label: '客户管理' },
  { key: 'tasks', label: '来料订单' },
]

export default function DashboardShell({
  user,
  activeNav,
  onNavChange,
  onLogout,
  children,
}) {
  const isAdmin = user.role === 'admin'

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">汇金特材</div>
        <nav className="dashboard-nav" aria-label="主导航">
          {NAV.map((n) => (
            <button
              key={n.key}
              type="button"
              className={`dashboard-nav-item ${activeNav === n.key ? 'is-active' : ''}`}
              onClick={() => onNavChange(n.key)}
            >
              {n.label}
            </button>
          ))}
          {isAdmin ? (
            <button
              type="button"
              className={`dashboard-nav-item ${activeNav === 'accounts' ? 'is-active' : ''}`}
              onClick={() => onNavChange('accounts')}
            >
              帐号管理
            </button>
          ) : null}
        </nav>
        <div className="dashboard-sidebar-footer">
          <div className="dashboard-user-block">
            <span className="dashboard-user-name" title={user.username}>
              {user.username}
            </span>
            <span className="dashboard-user-meta">
              #{user.id} · {isAdmin ? '管理员' : '员工'}
            </span>
          </div>
          <button type="button" className="dashboard-logout" onClick={onLogout}>
            退出登录
          </button>
        </div>
      </aside>
      <main className="dashboard-main">{children}</main>
    </div>
  )
}
