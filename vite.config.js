import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import { createApiHandler } from './server/api.js'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of ['GOOGLE_CLIENT_ID', 'SESSION_SECRET', 'ADMIN_EMAILS']) {
    if (env[key]) process.env[key] = env[key]
  }

  return {
    plugins: [
      react(),
      {
        name: 'jip-api',
        configureServer(server) {
          server.middlewares.use(createApiHandler())
        },
      },
    ],
  }
})
