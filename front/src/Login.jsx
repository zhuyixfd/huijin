import { useState } from 'react'
import './Login.css'
import { clearToken, formatApiError, setToken } from './auth.js'

export default function Login({ onLoggedIn }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(formatApiError(data) || `登录失败 (${r.status})`)
      }
      if (!data.access_token) {
        throw new Error('未返回令牌')
      }
      setToken(data.access_token)
      onLoggedIn()
    } catch (err) {
      clearToken()
      setError(err instanceof Error ? err.message : '请求失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <h1 className="login-title">汇金特材</h1>
        <p className="login-sub">登录</p>
        <p className="login-hint">
          初始管理员账号：<code>admin</code> / <code>admin123</code>
        </p>
        <form className="login-form" onSubmit={handleSubmit}>
          <label className="login-label">
            用户名
            <input
              className="login-input"
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={1}
            />
          </label>
          <label className="login-label">
            密码
            <input
              className="login-input"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={1}
            />
          </label>
          {error ? <p className="login-error">{error}</p> : null}
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? '请稍候…' : '登录'}
          </button>
        </form>
      </div>
    </div>
  )
}
