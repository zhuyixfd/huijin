import './DashboardShell.css'

const NAV = [
  { key: 'home', label: '首页' },
  { key: 'customers', label: '客户管理' },
  {
    key: 'orders-section',
    primaryNav: { key: 'tasks-all', label: '全部订单' },
    children: [
      { key: 'tasks-pending', label: '未处理' },
      { key: 'tasks-processing', label: '处理中 · 待完成' },
      { key: 'tasks-ready-outbound', label: '待出库' },
      { key: 'tasks-done', label: '已完成' },
    ],
  },
]

function ordersSectionActive(activeNav) {
  const section = NAV.find((n) => n.primaryNav)
  if (!section?.primaryNav) return false
  if (section.primaryNav.key === activeNav) return true
  return section.children?.some((c) => c.key === activeNav) ?? false
}

function navCountLabel(counts, key) {
  if (!counts || typeof counts[key] !== 'number') return '…'
  return String(counts[key])
}

function NavCountBadge({ counts, k }) {
  const raw = navCountLabel(counts, k)
  return <span className="nav-count-badge">{raw}</span>
}

export default function DashboardShell({
  user,
  activeNav,
  onNavChange,
  onLogout,
  taskNavCounts,
  children,
}) {
  const isAdmin = user.role === 'admin'

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">汇金特材</div>
        <nav className="dashboard-nav" aria-label="主导航">
          {NAV.map((n) => {
            if (n.primaryNav) {
              const groupActive = ordersSectionActive(activeNav)
              return (
                <div
                  key={n.key}
                  className={`dashboard-nav-section ${groupActive ? 'is-active-group' : ''}`}
                >
                  <button
                    type="button"
                    className={`dashboard-nav-item ${activeNav === n.primaryNav.key ? 'is-active' : ''}`}
                    onClick={() => onNavChange(n.primaryNav.key)}
                  >
                    {n.primaryNav.label}
                    <NavCountBadge counts={taskNavCounts} k="all" />
                  </button>
                  {Array.isArray(taskNavCounts?.processing_piece_strip) &&
                  taskNavCounts.processing_piece_strip.length > 0 ? (
                    <div
                      className="dashboard-nav-piece-strip"
                      aria-label="处理中件号首字母件数"
                    >
                      {taskNavCounts.processing_piece_strip.map(({ letter, count }) => (
                        <span
                          key={letter}
                          className={`dashboard-nav-piece-cell ${count === 0 ? 'is-muted' : ''}`}
                          title={`${letter}：${count}件`}
                        >
                          <span className="dashboard-nav-piece-letter">{letter}</span>
                          <span className="dashboard-nav-piece-num">{count}</span>
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <div className="dashboard-nav-sub">
                    {n.children.map((c) => {
                      const ck =
                        c.key === 'tasks-pending'
                          ? 'pending'
                          : c.key === 'tasks-processing'
                            ? 'processing'
                            : c.key === 'tasks-ready-outbound'
                              ? 'ready_outbound'
                              : c.key === 'tasks-done'
                                ? 'done'
                                : null
                      return (
                        <button
                          key={c.key}
                          type="button"
                          className={`dashboard-nav-item dashboard-nav-sub-item ${activeNav === c.key ? 'is-active' : ''}`}
                          onClick={() => onNavChange(c.key)}
                        >
                          {c.label}
                          {ck ? <NavCountBadge counts={taskNavCounts} k={ck} /> : null}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            }
            return (
              <button
                key={n.key}
                type="button"
                className={`dashboard-nav-item ${activeNav === n.key ? 'is-active' : ''}`}
                onClick={() => onNavChange(n.key)}
              >
                {n.label}
              </button>
            )
          })}
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
