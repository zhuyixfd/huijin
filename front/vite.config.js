import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // 通过域名访问开发机时需放行 Host（否则 Vite 会 Blocked request）
    allowedHosts: ['huijin.ikun.center'],
    // 与生产环境 nginx 一致：仅转发 /api，前端请求形如 /api/auth/login
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
