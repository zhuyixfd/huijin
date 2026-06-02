/** 模态框内：回车不触发表单提交（避免误关/误提交） */
export function preventModalFormEnterSubmit(e) {
  if (e.key !== 'Enter') return
  const t = e.target
  if (!(t instanceof HTMLElement)) return
  if (t instanceof HTMLTextAreaElement) return
  if (t instanceof HTMLButtonElement) return
  if (t instanceof HTMLInputElement) {
    const tp = String(t.type || '').toLowerCase()
    if (tp === 'submit' || tp === 'button' || tp === 'file' || tp === 'checkbox' || tp === 'radio') {
      return
    }
  }
  e.preventDefault()
}
