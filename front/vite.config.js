import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // 开发机用域名/内网 IP 访问时放行任意 Host，无需逐个写域名
    allowedHosts: true,
    // 与生产环境 nginx 一致：仅转发 /api，前端请求形如 /api/auth/login
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  },
})
