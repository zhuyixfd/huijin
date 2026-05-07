import { useCallback, useEffect, useState } from 'react'
import './App.css'
import DashboardShell from './DashboardShell.jsx'
import EmployeeAdmin from './EmployeeAdmin.jsx'
import Login from './Login.jsx'
import { authFetch, clearToken, getToken } from './auth.js'

export default function App() {
  const [sessionChecked, setSessionChecked] = useState(false)
  const [user, setUser] = useState(null)
  const [activeNav, setActiveNav] = useState('home')
  const [hello, setHello] = useState(null)
  const [helloErr, setHelloErr] = useState(null)

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

  useEffect(() => {
    if (!user) return
    let cancelled = false
    fetch('/api/hello')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => {
        if (!cancelled) {
          setHello(data.message ?? JSON.stringify(data))
          setHelloErr(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setHelloErr(e instanceof Error ? e.message : '请求失败')
      })
    return () => {
      cancelled = true
    }
  }, [user])

  function handleLogout() {
    clearToken()
    setUser(null)
    setHello(null)
    setHelloErr(null)
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
    user.role !== 'admin' && activeNav === 'accounts' ? 'home' : activeNav
  const showAccounts = user.role === 'admin' && resolvedNav === 'accounts'

  return (
    <DashboardShell
      user={user}
      activeNav={resolvedNav}
      onNavChange={handleNavChange}
      onLogout={handleLogout}
    >
      {showAccounts ? (
        <EmployeeAdmin />
      ) : (
        <div className="dashboard-home">
          <header className="dashboard-page-title">
            <h1>首页</h1>
            <p className="dashboard-page-desc">欢迎使用汇金特材后台。</p>
          </header>
          <section className="card">
            <h2>接口示例</h2>
            {helloErr ? (
              <p className="err">无法获取示例接口：{helloErr}</p>
            ) : (
              <p className="ok">{hello ?? '加载中…'}</p>
            )}
          </section>
        </div>
      )}
    </DashboardShell>
  )
}
