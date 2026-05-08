import { useEffect, useState } from 'react'
import './Pages.css'
import { getJson } from './api.js'

export default function HomePage() {
  const [summary, setSummary] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let cancelled = false
    getJson('/api/dashboard/summary')
      .then((d) => {
        if (!cancelled) setSummary(d)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : '加载失败')
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="page-wrap">
      <header className="dashboard-page-title">
        <h1>首页</h1>
      </header>
      {err ? <p className="err">{err}</p> : null}
      {summary ? (
        <div className="stat-grid">
          <div className="stat-card card">
            <span className="stat-label">客户数</span>
            <strong className="stat-value">{summary.customer_count}</strong>
          </div>
          <div className="stat-card card">
            <span className="stat-label">来料订单（一单一条）</span>
            <strong className="stat-value">{summary.item_count}</strong>
          </div>
        </div>
      ) : !err ? (
        <p className="muted">加载中…</p>
      ) : null}
      {summary?.status_counts ? (
        <section className="card status-breakdown">
          <h2>生产状态分布</h2>
          <ul className="status-list">
            {Object.entries(summary.status_counts).map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <span className="status-count">{v}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
