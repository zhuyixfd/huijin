/**
 * API 请求路径与 nginx 转发一致：浏览器访问 `/api/*`，由 nginx 转到后端（如 :8000）。
 * 本地开发由 Vite `server.proxy['/api']` 转发到同一后端。
 *
 * 若前后端不同域部署，可在构建前设置环境变量 `VITE_API_BASE`（不含末尾 `/`，无 `/api` 后缀），
 * 例如 `VITE_API_BASE=https://your-domain.com`，最终请求为 `https://your-domain.com/api/...`。
 */
export function apiUrl(path) {
  const normalized = path.startsWith('/') ? path : `/${path}`
  const base = (import.meta.env.VITE_API_BASE ?? '').trim().replace(/\/$/, '')
  return base ? `${base}${normalized}` : normalized
}
