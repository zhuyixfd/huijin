import { preventModalFormEnterSubmit } from './modalUtils.js'

export { preventModalFormEnterSubmit }

/**
 * 模态框：仅右上角 × 关闭；点击遮罩、按回车均不关闭。
 */
export default function Modal({
  open,
  onClose,
  title,
  wide = false,
  className = '',
  zIndex,
  titleAs: TitleTag = 'h2',
  children,
}) {
  if (!open) return null
  const backdropStyle = zIndex != null ? { zIndex } : undefined
  return (
    <div className="modal-backdrop" role="presentation" style={backdropStyle}>
      <div
        className={`modal-card ${wide ? 'wide' : ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? 'app-modal-title' : undefined}
      >
        <div className="modal-card-head">
          {title ? (
            <TitleTag id="app-modal-title" className="modal-card-title">
              {title}
            </TitleTag>
          ) : (
            <span className="modal-card-title" aria-hidden />
          )}
          <button type="button" className="modal-close-x" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>
        <div className="modal-card-body">{children}</div>
      </div>
    </div>
  )
}
