import { useCallback, useEffect, useState } from 'react'
import './App.css'
import CustomersPage from './CustomersPage.jsx'
import DashboardShell from './DashboardShell.jsx'
import EmployeeAdmin from './EmployeeAdmin.jsx'
import HomePage from './HomePage.jsx'
import Login from './Login.jsx'
import TasksPage from './TasksPage.jsx'
import { authFetch, clearToken, getToken } from './auth.js'
import { getJson } from './api.js'
import {
  canAnyOrderNav,
  canNavDone,
  canNavPending,
  canNavProcessing,
  canNavReadyOutbound,
} from './permissions.js'

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [activeNav, setActiveNav] = useState('home')
  const [taskNavCounts, setTaskNavCounts] = useState(null)

  const refreshUser = useCallback(() => {
    const token = getToken()
    if (!token) {
      setUser(null)
      setSessionChecked(true)
      return
    }
    authFetch('/api/auth/me')
      .then((r) => {
        if (r.status === 401) {
          clearToken()
          setUser(null)
          return null
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (data) setUser(data)
      })
      .catch(() => {
        clearToken()
        setUser(null)
      })
      .finally(() => setSessionChecked(true))
  }, [])

  useEffect(() => {
    queueMicrotask(() => refreshUser())
  }, [refreshUser])

  const refreshTaskNavCounts = useCallback(() => {
    getJson('/api/tasks/nav-counts')
      .then(setTaskNavCounts)
      .catch(() => setTaskNavCounts(null))
  }, [])

  useEffect(() => {
    if (!user) return
    refreshTaskNavCounts()
  }, [user, refreshTaskNavCounts])

  function handleLogout() {
    clearToken()
    setUser(null)
    setActiveNav('home')
  }

  function handleNavChange(key) {
    setActiveNav(key)
  }

  if (!sessionChecked) {
    return (
      <div className="app app--centered">
        <p className="loading-text">加载中…</p>
      </div>
    )
  }

  if (!user) {
    return <Login onLoggedIn={refreshUser} />
  }

  const TASKS_PAGE_KEYS = new Set([
    'tasks',
    'tasks-all',
    'tasks-pending',
    'tasks-processing',
    'tasks-ready-outbound',
    'tasks-done',
  ])

  function tasksPresetFromNav(key) {
    const map = {
      tasks: 'all',
      'tasks-all': 'all',
      'tasks-pending': 'pending',
      'tasks-processing': 'processing',
      'tasks-ready-outbound': 'ready_outbound',
      'tasks-done': 'done',
    }
    return map[key] ?? 'all'
  }

  const resolvedNav =
    activeNav === 'orders'
      ? 'tasks-all'
      : user.role !== 'admin' && activeNav === 'accounts'
        ? 'home'
        : activeNav
  const showAccounts = user.role === 'admin' && resolvedNav === 'accounts'

  useEffect(() => {
    if (!user) return
    if (user.role === 'admin') return
    let deny = false
    if ((resolvedNav === 'tasks' || resolvedNav === 'tasks-all') && !canAnyOrderNav(user)) {
      deny = true
    }
    if (resolvedNav === 'tasks-pending' && !canNavPending(user)) deny = true
    if (resolvedNav === 'tasks-processing' && !canNavProcessing(user)) deny = true
    if (resolvedNav === 'tasks-ready-outbound' && !canNavReadyOutbound(user)) deny = true
    if (resolvedNav === 'tasks-done' && !canNavDone(user)) deny = true
    if (deny) setActiveNav('home')
  }, [user, resolvedNav])

  function renderMain() {
    if (showAccounts) return <EmployeeAdmin />
    if (TASKS_PAGE_KEYS.has(resolvedNav)) {
      return (
        <TasksPage
          tasksPreset={tasksPresetFromNav(resolvedNav)}
          onTasksMutated={refreshTaskNavCounts}
          taskNavCounts={taskNavCounts}
          user={user}
        />
      )
    }
    switch (resolvedNav) {
      case 'customers':
        return <CustomersPage />
      case 'home':
      default:
        return <HomePage />
    }
  }

  return (
    <DashboardShell
      user={user}
      activeNav={resolvedNav}
      onNavChange={handleNavChange}
      onLogout={handleLogout}
      taskNavCounts={taskNavCounts}
    >
      {renderMain()}
    </DashboardShell>
  )
}
