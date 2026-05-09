import { useEffect, useState } from 'react'
import './Pages.css'
import { getJson } from './api.js'
import { apiUrl } from './config.js'

const CASE_PAGE = 20

function fmtDateTime(iso) {
  if (!iso) return '—'
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return String(iso)
  return t.toLocaleString('zh-CN', { hour12: false })
}

export default function HomePage() {
  const [summary, setSummary] = useState(null)
  const [err, setErr] = useState(null)

  const [cases, setCases] = useState([])
  const [caseTotal, setCaseTotal] = useState(0)
  const [casePage, setCasePage] = useState(1)
  const [casesLoading, setCasesLoading] = useState(true)
  const [casesErr, setCasesErr] = useState(null)

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

  useEffect(() => {
    let cancelled = false
    const skip = (casePage - 1) * CASE_PAGE
    setCasesLoading(true)
    setCasesErr(null)
    getJson(`/api/case-studies?skip=${skip}&limit=${CASE_PAGE}`)
      .then((d) => {
        if (cancelled) return
        setCases(Array.isArray(d.items) ? d.items : [])
        setCaseTotal(typeof d.total === 'number' ? d.total : 0)
      })
      .catch((e) => {
        if (!cancelled) setCasesErr(e instanceof Error ? e.message : '案例加载失败')
      })
      .finally(() => {
        if (!cancelled) setCasesLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [casePage])

  const casePages = Math.max(1, Math.ceil(caseTotal / CASE_PAGE))

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
          <div className="stat-card card">
            <span className="stat-label">生产案例</span>
            <strong className="stat-value">{summary.case_study_count ?? 0}</strong>
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

      <section className="card home-case-studies">
        <div className="home-case-studies-head">
          <h2>案例展示</h2>
          <span className="muted home-case-studies-meta">
            共 {caseTotal} 条 · 按添加时间倒序 · 每页 {CASE_PAGE} 条
          </span>
        </div>
        {casesErr ? <p className="err">{casesErr}</p> : null}
        {casesLoading ? (
          <p className="muted">加载案例…</p>
        ) : cases.length === 0 ? (
          <p className="muted">暂无案例</p>
        ) : (
          <ul className="home-case-list">
            {cases.map((c) => (
              <li key={c.id} className="home-case-card">
                <div className="home-case-card-head">
                  <span className="home-case-card-title">
                    {c.order_no} · {c.customer_name}
                  </span>
                  <time className="home-case-card-time" dateTime={c.created_at}>
                    {fmtDateTime(c.created_at)}
                  </time>
                </div>
                <p className="muted home-case-card-sub">
                  明细ID {c.order_item_id}
                  {c.unit_index !== null && c.unit_index !== undefined
                    ? ` · 支点（件）#${c.unit_index}`
                    : ''}
                </p>
                {c.note ? <p className="home-case-note">{c.note}</p> : null}
                {Array.isArray(c.images) && c.images.length > 0 ? (
                  <div className="home-case-images">
                    {c.images.map((src) => (
                      <a
                        key={src}
                        href={apiUrl(src)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="home-case-img-link"
                      >
                        <img src={apiUrl(src)} alt="" loading="lazy" />
                      </a>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {!casesLoading && caseTotal > 0 ? (
          <div className="toolbar home-case-pagination">
            <button
              type="button"
              className="btn"
              disabled={casePage <= 1}
              onClick={() => setCasePage((p) => Math.max(1, p - 1))}
            >
              上一页
            </button>
            <span className="muted">
              第 {casePage} / {casePages} 页
            </span>
            <button
              type="button"
              className="btn"
              disabled={casePage >= casePages}
              onClick={() => setCasePage((p) => p + 1)}
            >
              下一页
            </button>
          </div>
        ) : null}
      </section>
    </div>
  )
}
