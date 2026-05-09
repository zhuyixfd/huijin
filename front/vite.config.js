import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': 'http://127.0.0.1:8000',
  '/uploads': 'http://127.0.0.1:8000',
}

// https://vite.dev/config/
export default defineConfig({
  // 站点挂在域名根路径时用 "/"（默认）。若将来部署在子路径（如 /hj/），改为 "/hj/"
  // 与 nginx base 不一致时，/assets/*.js 会 404 并被 SPA 回退成 index.html → MIME 报错
  base: '/',
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,
    /** 本机 curl /@vite/client 正常但域名报错 → 网关未把 / 反代到 Vite，参见 front/vite-dev.nginx.conf */
    proxy: apiProxy,
  },
  /** `npm run build && npm run preview`：无 /@vite 虚拟路径，适合域名下先看能否正常打开（仍需反代到 preview 端口或托管 dist） */
  preview: {
    host: true,
    allowedHosts: true,
    proxy: apiProxy,
  },
})
