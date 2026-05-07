import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const apiProxy = {
  '/api': 'http://127.0.0.1:8000',
}

// https://vite.dev/config/
export default defineConfig({
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
