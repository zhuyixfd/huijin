import { useCallback, useEffect, useState } from 'react'
import './App.css'
import CustomersPage from './CustomersPage.jsx'
import DashboardShell from './DashboardShell.jsx'
import EmployeeAdmin from './EmployeeAdmin.jsx'
import HomePage from './HomePage.jsx'
import Login from './Login.jsx'
import TasksPage from './TasksPage.jsx'
import { authFetch, clearToken, getToken } from './auth.js'

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [activeNav, setActiveNav] = useState('home')

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

  const resolvedNav =
    activeNav === 'orders'
      ? 'tasks'
      : user.role !== 'admin' && activeNav === 'accounts'
        ? 'home'
        : activeNav
  const showAccounts = user.role === 'admin' && resolvedNav === 'accounts'

  function renderMain() {
    if (showAccounts) return <EmployeeAdmin />
    switch (resolvedNav) {
      case 'customers':
        return <CustomersPage />
      case 'tasks':
        return <TasksPage />
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
    >
      {renderMain()}
    </DashboardShell>
  )
}
