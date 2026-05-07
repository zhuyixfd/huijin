import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const publicOrigin = (env.VITE_DEV_PUBLIC_ORIGIN || '').replace(/\/$/, '')

  /** @type {import('vite').UserConfig['server']} */
  const server = {
    host: true,
    strictPort: true,
    // 通过域名访问开发机时需放行 Host（否则 Vite 会 Blocked request）
    allowedHosts: ['huijin.ikun.center'],
    // 与生产环境 nginx 一致：仅转发 /api，前端请求形如 /api/auth/login
    proxy: {
      '/api': 'http://127.0.0.1:8000',
    },
  }

  // 反代 + HTTPS 终止在网关时：让模块与 HMR 使用对外域名（避免错链到内网地址）
  if (publicOrigin) {
    try {
      const u = new URL(publicOrigin)
      server.origin = publicOrigin
      const clientPort = u.port
        ? Number(u.port)
        : u.protocol === 'https:'
          ? 443
          : 80
      server.hmr = {
        protocol: u.protocol === 'https:' ? 'wss' : 'ws',
        host: u.hostname,
        clientPort,
      }
    } catch {
      // 无效 URL 则忽略，保持默认本地行为
    }
  }

  return {
    plugins: [react()],
    server,
  }
})
