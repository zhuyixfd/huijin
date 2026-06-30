import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

export default function Modal({
  open,
  title,
  onClose,
  wide = false,
  className = '',
  children,
  windowed = false,
  draggable = false,
  resizable = false,
  closeOnBackdrop = true,
  initialWidth,
  initialHeight,
}) {
  const cardRef = useRef(null)
  const [win, setWin] = useState(() => {
    if (typeof window === 'undefined') return { left: 0, top: 0, width: 720, height: 640 }
    const vw = window.innerWidth || 1024
    const vh = window.innerHeight || 768
    const w = Math.max(360, Math.min(typeof initialWidth === 'number' ? initialWidth : 980, vw - 48))
    const h = Math.max(320, Math.min(typeof initialHeight === 'number' ? initialHeight : 760, vh - 48))
    const left = Math.max(12, Math.floor((vw - w) / 2))
    const top = Math.max(12, Math.floor((vh - h) / 2))
    return { left, top, width: w, height: h }
  })

  const clampWin = useCallback((next) => {
    if (typeof window === 'undefined') return next
    const vw = window.innerWidth || 1024
    const vh = window.innerHeight || 768
    const minW = 360
    const minH = 320
    const margin = 12
    const width = Math.max(minW, Math.min(Number(next.width) || minW, vw - margin * 2))
    const height = Math.max(minH, Math.min(Number(next.height) || minH, vh - margin * 2))
    const maxLeft = Math.max(margin, vw - width - margin)
    const maxTop = Math.max(margin, vh - height - margin)
    const left = Math.max(margin, Math.min(Number(next.left) || margin, maxLeft))
    const top = Math.max(margin, Math.min(Number(next.top) || margin, maxTop))
    return { left, top, width, height }
  }, [])

  useEffect(() => {
    if (!open || !windowed) return
    function onResize() {
      setWin((prev) => clampWin(prev))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [open, windowed, clampWin])

  const safeWin = useMemo(() => {
    if (!windowed) return win
    return clampWin(win)
  }, [windowed, win, clampWin])

  const windowStyle = useMemo(() => {
    if (!windowed) return null
    return {
      left: `${safeWin.left}px`,
      top: `${safeWin.top}px`,
      width: `${safeWin.width}px`,
      height: `${safeWin.height}px`,
    }
  }, [windowed, safeWin])

  const startDrag = useCallback(
    (e) => {
      if (!windowed || !draggable) return
      if (e.button !== 0) return
      const startX = e.clientX
      const startY = e.clientY
      const snap = { ...safeWin }
      const onMove = (ev) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        setWin((prev) =>
          clampWin({
            ...prev,
            left: snap.left + dx,
            top: snap.top + dy,
          }),
        )
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [windowed, draggable, safeWin, clampWin],
  )

  const startResize = useCallback(
    (e) => {
      if (!windowed || !resizable) return
      if (e.button !== 0) return
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      const snap = { ...safeWin }
      const onMove = (ev) => {
        const dx = ev.clientX - startX
        const dy = ev.clientY - startY
        setWin((prev) =>
          clampWin({
            ...prev,
            width: snap.width + dx,
            height: snap.height + dy,
          }),
        )
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [windowed, resizable, safeWin, clampWin],
  )

  useEffect(() => {
    if (!open) return
    function onKeyDown(e) {
      if (e.key === 'Escape') onClose?.()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title || '对话框'}
      onMouseDown={(e) => {
        if (!closeOnBackdrop) return
        if (e.target === e.currentTarget) onClose?.()
      }}
    >
      <div
        ref={cardRef}
        className={[
          'modal-card',
          wide ? 'wide' : '',
          windowed ? 'is-windowed' : '',
          draggable ? 'is-draggable' : '',
          resizable ? 'is-resizable' : '',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        style={windowStyle || undefined}
      >
        <div className="modal-card-head" onMouseDown={startDrag}>
          <h2 className="modal-card-title">{title || '—'}</h2>
          <button type="button" className="modal-close-x" onClick={() => onClose?.()}>
            ×
          </button>
        </div>
        <div className="modal-card-body">{children}</div>
        {windowed && resizable ? (
          <div className="modal-resizer" role="presentation" onMouseDown={startResize} />
        ) : null}
      </div>
    </div>
  )
}
