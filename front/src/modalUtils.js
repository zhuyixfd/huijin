export function preventModalFormEnterSubmit(e) {
  if (e.key !== 'Enter') return
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return
  const tag = e.target?.tagName
  if (tag === 'TEXTAREA') return
  e.preventDefault()
}

