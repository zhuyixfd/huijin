import { useCallback, useEffect, useRef, useState } from 'react'
import './Pages.css'
import { deleteReq, getJson, putFormData } from './api.js'
import { apiUrl } from './config.js'
import CaseStudyEditorModal from './CaseStudyEditorModal.jsx'

const CASE_PAGE = 20

/** 首页柱状图不含此处；单独展示「已完成」 */
const STATUS_DONE_KEY = '已发回'

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
  const [caseEditor, setCaseEditor] = useState(null)
  const [caseEditorNote, setCaseEditorNote] = useState('')
  const [caseEditorFiles, setCaseEditorFiles] = useState([])
  const [caseEditorFilePreviews, setCaseEditorFilePreviews] = useState([])
  const [caseEditorExistingImages, setCaseEditorExistingImages] = useState([])
  const [caseEditorSubmitting, setCaseEditorSubmitting] = useState(false)
  const [caseEditorErr, setCaseEditorErr] = useState(null)
  const restoreScrollYRef = useRef(null)

  const loadSummary = useCallback(async () => {
    setErr(null)
    try {
      const d = await getJson('/api/dashboard/summary')
      setSummary(d)
    } catch (e) {
      setErr(e instanceof Error ? e.message : '加载失败')
    }
  }, [])

  const loadCases = useCallback(async (page) => {
    const nextPage = Math.max(1, Number(page) || 1)
    const skip = (nextPage - 1) * CASE_PAGE
    setCasesLoading(true)
    setCasesErr(null)
    try {
      const d = await getJson(`/api/case-studies?skip=${skip}&limit=${CASE_PAGE}`)
      setCases(Array.isArray(d.items) ? d.items : [])
      setCaseTotal(typeof d.total === 'number' ? d.total : 0)
    } catch (e) {
      setCasesErr(e instanceof Error ? e.message : '案例加载失败')
    } finally {
      setCasesLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadCases(casePage)
  }, [casePage, loadCases])

  useEffect(() => {
    const y = restoreScrollYRef.current
    if (y === null || y === undefined) return
    if (casesLoading) return
    restoreScrollYRef.current = null
    requestAnimationFrame(() => window.scrollTo({ top: y }))
  }, [casesLoading, cases])

  const caseFileKey = useCallback((f) => `${f?.name ?? ''}::${f?.size ?? ''}::${f?.lastModified ?? ''}`, [])

  useEffect(() => {
    const previews = caseEditorFiles
      .filter((f) => String(f?.type ?? '').startsWith('image/'))
      .map((f) => ({ key: caseFileKey(f), name: f.name, url: URL.createObjectURL(f) }))
    setCaseEditorFilePreviews(previews)
    return () => {
      for (const p of previews) URL.revokeObjectURL(p.url)
    }
  }, [caseEditorFiles, caseFileKey])

  const closeCaseEditor = useCallback(() => {
    setCaseEditor(null)
    setCaseEditorNote('')
    setCaseEditorFiles([])
    setCaseEditorExistingImages([])
    setCaseEditorErr(null)
  }, [])

  const openCaseEditor = useCallback((row) => {
    setCaseEditor(row)
    setCaseEditorNote(row?.note ?? '')
    setCaseEditorFiles([])
    setCaseEditorExistingImages(Array.isArray(row?.images) ? row.images : [])
    setCaseEditorErr(null)
  }, [])

  const appendCaseEditorFiles = useCallback(
    (picked) => {
      const arr = Array.isArray(picked) ? picked : []
      if (arr.length === 0) return
      setCaseEditorFiles((prev) => {
        const m = new Map()
        for (const f of prev) m.set(caseFileKey(f), f)
        for (const f of arr) m.set(caseFileKey(f), f)
        return [...m.values()]
      })
    },
    [caseFileKey],
  )

  const removeCaseEditorFile = useCallback(
    (key) => {
      setCaseEditorFiles((prev) => prev.filter((f) => caseFileKey(f) !== key))
    },
    [caseFileKey],
  )

  const removeExistingCaseEditorImage = useCallback((src) => {
    setCaseEditorExistingImages((prev) => prev.filter((it) => it !== src))
  }, [])

  async function submitCaseEditor(e) {
    e.preventDefault()
    if (!caseEditor) return
    setCaseEditorErr(null)
    setCaseEditorSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('note', caseEditorNote)
      fd.append('keep_images', JSON.stringify(caseEditorExistingImages))
      for (const f of caseEditorFiles) {
        fd.append('files', f)
      }
      await putFormData(`/api/case-studies/${caseEditor.id}`, fd)
      closeCaseEditor()
      await loadCases(casePage)
      await loadSummary()
    } catch (e) {
      setCaseEditorErr(e instanceof Error ? e.message : '保存失败')
    } finally {
      setCaseEditorSubmitting(false)
    }
  }

  async function removeCaseStudy(row) {
    if (!row) return
    if (!window.confirm(`删除案例「${row.order_no} / 明细 ${row.order_item_id}」？`)) return
    setCaseEditorErr(null)
    try {
      restoreScrollYRef.current = window.scrollY
      await deleteReq(`/api/case-studies/${row.id}`)
      if (cases.length === 1 && casePage > 1) {
        setCasePage((p) => Math.max(1, p - 1))
      } else {
        await loadCases(casePage)
      }
      await loadSummary()
    } catch (e) {
      const msg = e instanceof Error ? e.message : '删除失败'
      setCaseEditorErr(msg)
      setCasesErr(msg)
    }
  }

  useEffect(() => {
    void loadSummary()
  }, [loadSummary])

  const casePages = Math.max(1, Math.ceil(caseTotal / CASE_PAGE))

  const statusCounts = summary?.status_counts
  const doneCount =
    statusCounts && typeof statusCounts[STATUS_DONE_KEY] === 'number'
      ? statusCounts[STATUS_DONE_KEY]
      : 0
  const barChartEntries = statusCounts
    ? Object.entries(statusCounts)
        .filter(([k]) => k !== STATUS_DONE_KEY)
        .sort((a, b) => b[1] - a[1])
    : []
  const barMax = Math.max(1, ...barChartEntries.map(([, n]) => n))

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
        <section className="card status-breakdown" aria-label="生产状态分布">
          <h2>生产状态分布</h2>
          <p className="home-status-done-line">
            已完成：<strong>{doneCount}</strong>
          </p>
          {barChartEntries.length === 0 ? (
            <p className="muted home-status-chart-empty">除已完成外暂无其他生产状态</p>
          ) : (
            <div className="status-bar-chart" role="img" aria-label="各生产状态数量（不含已完成）">
              {barChartEntries.map(([label, count]) => (
                <div key={label} className="status-bar-row">
                  <span className="status-bar-label" title={label}>
                    {label}
                  </span>
                  <div className="status-bar-track">
                    <div
                      className="status-bar-fill"
                      style={{ width: `${Math.round((count / barMax) * 100)}%` }}
                    />
                  </div>
                  <span className="status-bar-num">{count}</span>
                </div>
              ))}
            </div>
          )}
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
                  <div className="home-case-card-head-main">
                    <span className="home-case-card-title">
                      {c.order_no} · {c.customer_name}
                    </span>
                    <time className="home-case-card-time" dateTime={c.created_at}>
                      {fmtDateTime(c.created_at)}
                    </time>
                  </div>
                  <div className="home-case-card-actions">
                    <button
                      type="button"
                      className="case-action-icon"
                      title="编辑案例"
                      aria-label="编辑案例"
                      onClick={() => openCaseEditor(c)}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="case-action-icon danger"
                      title="删除案例"
                      aria-label="删除案例"
                      onClick={() => void removeCaseStudy(c)}
                    >
                      🗑
                    </button>
                  </div>
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
      <CaseStudyEditorModal
        open={Boolean(caseEditor)}
        title="编辑生产案例"
        subtitle={
          caseEditor
            ? `订单 ${caseEditor.order_no} · 明细 ${caseEditor.order_item_id}${
                caseEditor.unit_index !== null && caseEditor.unit_index !== undefined
                  ? ` · 支点（件）#${caseEditor.unit_index}`
                  : ''
              }`
            : ''
        }
        note={caseEditorNote}
        onNoteChange={setCaseEditorNote}
        onSubmit={submitCaseEditor}
        onClose={closeCaseEditor}
        onFilesPicked={appendCaseEditorFiles}
        existingImages={caseEditorExistingImages}
        onRemoveExistingImage={removeExistingCaseEditorImage}
        filePreviews={caseEditorFilePreviews}
        onRemoveFile={removeCaseEditorFile}
        error={caseEditorErr}
        submitting={caseEditorSubmitting}
        submitLabel="保存修改"
      />
    </div>
  )
}
