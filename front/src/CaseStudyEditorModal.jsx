import Modal from './Modal.jsx'
import { apiUrl } from './config.js'

function preventEditorSubmitOnEnter(e) {
  if (e.key !== 'Enter') return
  const tag = String(e.target?.tagName || '').toUpperCase()
  if (tag === 'TEXTAREA' || tag === 'BUTTON') return
  e.preventDefault()
}

export default function CaseStudyEditorModal({
  open,
  title,
  subtitle,
  note,
  onNoteChange,
  onSubmit,
  onClose,
  onFilesPicked,
  existingImages = [],
  onRemoveExistingImage,
  filePreviews = [],
  onRemoveFile,
  error = null,
  submitting = false,
  submitLabel = '保存',
}) {
  return (
    <Modal open={open} wide title={title} onClose={onClose}>
      {subtitle ? <p className="muted">{subtitle}</p> : null}
      <form className="form-grid" onSubmit={onSubmit} onKeyDown={preventEditorSubmitOnEnter}>
        <label className="full">
          文字备注
          <textarea
            value={note}
            onChange={(e) => onNoteChange?.(e.target.value)}
            placeholder="可与图片同时填写；若不上传图片则需填写备注"
          />
        </label>
        <label className="full">
          图片（可多选）
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              onFilesPicked?.(Array.from(e.target.files || []))
              e.target.value = ''
            }}
          />
        </label>
        {existingImages.length > 0 ? (
          <div className="full">
            <p className="muted" style={{ marginBottom: '0.5rem' }}>
              已有图片 {existingImages.length} 张
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginTop: '-0.25rem',
              }}
            >
              {existingImages.map((src) => (
                <div key={src} style={{ width: '7.25rem' }}>
                  <a href={apiUrl(src)} target="_blank" rel="noopener noreferrer">
                    <img
                      src={apiUrl(src)}
                      alt=""
                      style={{
                        width: '100%',
                        height: '7.25rem',
                        objectFit: 'cover',
                        borderRadius: '0.5rem',
                        border: '1px solid rgba(0,0,0,0.12)',
                        display: 'block',
                      }}
                    />
                  </a>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.25rem' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '0 0.35rem' }}
                      onClick={() => onRemoveExistingImage?.(src)}
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {filePreviews.length > 0 ? (
          <div className="full">
            <p className="muted" style={{ marginBottom: '0.5rem' }}>
              新选图片 {filePreviews.length} 张
            </p>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                marginTop: '-0.25rem',
              }}
            >
              {filePreviews.map((p) => (
                <div key={p.key} style={{ width: '7.25rem' }}>
                  <a href={p.url} target="_blank" rel="noopener noreferrer">
                    <img
                      src={p.url}
                      alt={p.name}
                      style={{
                        width: '100%',
                        height: '7.25rem',
                        objectFit: 'cover',
                        borderRadius: '0.5rem',
                        border: '1px solid rgba(0,0,0,0.12)',
                        display: 'block',
                      }}
                    />
                  </a>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span
                      className="muted"
                      title={p.name}
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: '1 1 auto',
                      }}
                    >
                      {p.name}
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: '0 0.35rem' }}
                      onClick={() => onRemoveFile?.(p.key)}
                    >
                      移除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
        {error ? <p className="err full">{error}</p> : null}
        <div className="form-actions full">
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? '提交中…' : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  )
}
