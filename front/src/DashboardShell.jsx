import { useMemo } from 'react'
import './DashboardShell.css'
import {
  canAnyOrderNav,
  canNavDone,
  canNavPending,
  canNavProcessing,
  canNavReadyOutbound,
} from './permissions.js'

function navCountLabel(counts, key) {
  if (!counts || typeof counts[key] !== 'number') return '…'
  return String(counts[key])
}

function NavCountBadge({ counts, k }) {
  const raw = navCountLabel(counts, k)
  return <span className="nav-count-badge">{raw}</span>
}

function buildNavItems(user) {
  const items = [
    { key: 'home', label: '首页' },
    { key: 'customers', label: '客户管理' },
  ]
  if (!user) return items
  const isAdmin = user.role === 'admin'
  if (isAdmin || canAnyOrderNav(user)) {
    const children = []
    if (isAdmin || canNavPending(user)) {
      children.push({ key: 'tasks-pending', label: '未处理' })
    }
    if (isAdmin || canNavProcessing(user)) {
      children.push({ key: 'tasks-processing', label: '处理中' })
    }
    if (isAdmin || canNavReadyOutbound(user)) {
      children.push({ key: 'tasks-ready-outbound', label: '待出库' })
    }
    if (isAdmin || canNavDone(user)) {
      children.push({ key: 'tasks-done', label: '已完成' })
    }
    items.push({
      key: 'orders-section',
      primaryNav: { key: 'tasks-all', label: '全部订单' },
      children,
    })
  }
  return items
}

function ordersSectionActive(activeNav, navItems) {
  const section = navItems.find((n) => n.primaryNav)
  if (!section?.primaryNav) return false
  if (section.primaryNav.key === activeNav) return true
  return section.children?.some((c) => c.key === activeNav) ?? false
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
  const navItems = useMemo(() => buildNavItems(user), [user])

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">汇金特材</div>
        <nav className="dashboard-nav" aria-label="主导航">
          {navItems.map((n) => {
            if (n.primaryNav) {
              const groupActive = ordersSectionActive(activeNav, navItems)
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
                  <div className="dashboard-nav-sub">
                    {(n.children ?? []).map((c) => {
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
